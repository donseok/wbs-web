import type { ComputedItem } from './types'
import { collectLeaves } from './tree'
import { overallProgress } from './rollup'

export type Signal = 'green' | 'amber' | 'red' | 'neutral'

/* ── 캘린더 일수(UTC, DST 무관) — DashboardView 로컬 헬퍼와 동일 관례 ── */
const DAY = 86_400_000
const ms = (s: string) => Date.parse(`${s}T00:00:00Z`)
export const diffDaysCal = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY)
export const addDaysCal = (s: string, n: number) =>
  new Date(ms(s) + n * DAY).toISOString().slice(0, 10)

/** 진척 신호 — 편차(실적−계획, %p) 기준. 경계는 green/amber가 소유. */
export function progressSignal(variance: number): Signal {
  if (variance >= -2) return 'green'
  if (variance >= -10) return 'amber'
  return 'red'
}

export interface ScheduleModel {
  totalDays: number; elapsed: number; remaining: number; elapsedPct: number
  earlyFloor: number
  projectedEnd: string | null; slipDays: number | null
  signal: Signal; label: 'onTrack' | 'early' | 'done' | 'none'
}

const clampN = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function scheduleModel(input: {
  startDate: string | null; endDate: string | null; today: string
  overallActual: number; overallPlanned: number
}): ScheduleModel {
  const { startDate: s, endDate: e, today, overallActual, overallPlanned } = input
  if (!s || !e) {
    return { totalDays: 0, elapsed: 0, remaining: 0, elapsedPct: 0, earlyFloor: 0,
             projectedEnd: null, slipDays: null, signal: 'neutral', label: 'none' }
  }
  const totalDays = Math.max(1, diffDaysCal(s, e) + 1)
  const elapsed = clampN(diffDaysCal(s, today) + 1, 0, totalDays)
  const remaining = totalDays - elapsed
  const elapsedPct = Math.round((elapsed / totalDays) * 100)
  const earlyFloor = Math.max(14, Math.round(totalDays * 0.15))   // 매직넘버는 여기 한 곳에만
  const base = { totalDays, elapsed, remaining, elapsedPct, earlyFloor }

  // 완료 예외 — 종료일 경과여도 done이면 정상
  if (overallActual >= 100) return { ...base, projectedEnd: null, slipDays: null, signal: 'green', label: 'done' }
  // 조기 가드 — SPI 불안정 구간은 정직하게 회색(초록 아님)
  if (overallPlanned < 5 || elapsed < earlyFloor) {
    return { ...base, projectedEnd: null, slipDays: null, signal: 'neutral', label: 'early' }
  }
  const spi = overallActual / overallPlanned            // planned ≥ 5 → 안전
  const projectedDuration = Math.min(totalDays / spi, totalDays * 3) // clamp: 최대 3×
  const slipDays = Math.round(projectedDuration - totalDays)
  const projectedEnd = addDaysCal(s, Math.round(projectedDuration) - 1)
  const overdueUnfinished = today > e                   // done 가드 통과 = 미완료
  const signal: Signal = slipDays > 14 || overdueUnfinished ? 'red' : slipDays > 3 ? 'amber' : 'green'
  return { ...base, projectedEnd, slipDays, signal, label: 'onTrack' }
}

// 마일스톤 키워드(소문자, WBS 도메인 데이터 기준). 이름에 부분문자열(대소문자 무시) 매칭.
const MILESTONE_KEYWORDS = ['착수보고', '중간보고', '보고회', '마스터 플랜', 'bmt', '최종 선정', '승인', '준공', 'kick-off', '킥오프']

export interface MilestoneModel {
  name: string | null; date: string | null; dday: number | null; overdue: boolean; signal: Signal
}

function isMilestoneLeaf(l: ComputedItem): boolean {
  const name = l.name.toLowerCase()
  const kw = MILESTONE_KEYWORDS.some(k => name.includes(k))
  const singleDay =
    l.plannedStart != null && l.plannedStart === l.plannedEnd && !!(l.deliverable && l.deliverable.trim())
  return kw || singleDay
}
const byEndThenOrder = (a: ComputedItem, b: ComputedItem) =>
  a.plannedEnd! < b.plannedEnd! ? -1 : a.plannedEnd! > b.plannedEnd! ? 1 : a.sortOrder - b.sortOrder

/** 마일스톤 리프 전체 — 완료 포함, plannedEnd 오름차순. 타임라인용. today에 의존하지 않는다. */
export function milestoneLeaves(items: ComputedItem[]): ComputedItem[] {
  return collectLeaves(items)
    .filter(l => isMilestoneLeaf(l) && l.plannedEnd != null)
    .sort(byEndThenOrder)
}

export function detectMilestones(items: ComputedItem[], today: string): MilestoneModel {
  const cands = milestoneLeaves(items).filter(l => l.status !== 'done')
  const overdue = cands.filter(l => l.plannedEnd! < today)
  if (overdue.length > 0) {
    const od = overdue[0]
    return { name: od.name, date: od.plannedEnd, dday: diffDaysCal(today, od.plannedEnd!), overdue: true, signal: 'red' }
  }
  const next = cands.filter(l => l.plannedEnd! >= today)[0]
  if (!next) return { name: null, date: null, dday: null, overdue: false, signal: 'neutral' }
  const dday = diffDaysCal(today, next.plannedEnd!)
  return { name: next.name, date: next.plannedEnd, dday, overdue: false, signal: dday >= 15 ? 'green' : 'amber' }
}

export const delayedLeaves = (leaves: ComputedItem[]): ComputedItem[] =>
  leaves.filter(l => l.status === 'delayed')

/** 미완료 & 오늘 이후 7일 내 마감 — DashboardView 인라인 정의와 동일(단일 출처). */
export function dueSoonLeaves(leaves: ComputedItem[], today: string): ComputedItem[] {
  return leaves
    .filter(l => l.status !== 'done' && l.plannedEnd != null && l.plannedEnd >= today && diffDaysCal(today, l.plannedEnd) <= 7)
    .sort((a, b) => (a.plannedEnd! < b.plannedEnd! ? -1 : a.plannedEnd! > b.plannedEnd! ? 1 : 0))
}

/**
 * 조치가 필요한 리프 — 지연 ∪ 마감임박, 중복 제거. delayed가 이긴다.
 * dueSoonLeaves가 delayed를 제외하지 않으므로 둘을 그냥 더하면 중복 계상된다.
 */
export function attentionLeaves(leaves: ComputedItem[], today: string): ComputedItem[] {
  const delayed = delayedLeaves(leaves)
  const seen = new Set(delayed.map(l => l.id))
  return [...delayed, ...dueSoonLeaves(leaves, today).filter(l => !seen.has(l.id))]
}

export interface RiskModel { delayed: number; dueSoon: number; attention: number; topWeightDelayed: boolean; signal: Signal }

const escalate = (s: Signal): Signal => (s === 'green' ? 'amber' : s === 'amber' ? 'red' : s)

/** 최상위 유효가중 루트 Phase가 지연인가. 전부 null이면 비교 불가 → false. */
function topWeightPhaseDelayed(roots: ComputedItem[]): boolean {
  if (roots.length === 0 || roots.every(r => r.weight == null)) return false
  const eff = (r: ComputedItem) => r.weight ?? 0
  const top = [...roots].sort((a, b) => eff(b) - eff(a) || a.sortOrder - b.sortOrder)[0]
  return top.status === 'delayed'
}

export function riskModel(roots: ComputedItem[], today: string): RiskModel {
  const leaves = collectLeaves(roots)
  const delayed = delayedLeaves(leaves).length
  const dueSoon = dueSoonLeaves(leaves, today).length
  const attention = attentionLeaves(leaves, today).length
  const topWeightDelayed = topWeightPhaseDelayed(roots)
  let signal: Signal = delayed >= 4 ? 'red' : delayed >= 1 ? 'amber' : 'green'
  if (topWeightDelayed) signal = escalate(signal)
  return { delayed, dueSoon, attention, topWeightDelayed, signal }
}

const RANK: Record<Signal, number> = { neutral: -1, green: 0, amber: 1, red: 2 }

/** 하위 신호 worst-of. neutral은 판정에서 제외(모두 neutral이면 green). */
export function overallSignal(signals: Signal[]): Signal {
  return signals
    .filter(s => s !== 'neutral')
    .reduce<Signal>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'green')
}

export interface ExecSummary {
  overall: { signal: Signal }
  progress: { actual: number; planned: number; variance: number; signal: Signal }
  schedule: ScheduleModel
  risk: RiskModel
  milestone: MilestoneModel
}

export function buildExecSummary(
  items: ComputedItem[],
  opts: { startDate: string | null; endDate: string | null; today: string },
): ExecSummary {
  const { actual, planned } = overallProgress(items)
  const variance = actual - planned
  const progress = { actual, planned, variance, signal: progressSignal(variance) }
  const schedule = scheduleModel({
    startDate: opts.startDate, endDate: opts.endDate, today: opts.today,
    overallActual: actual, overallPlanned: planned,
  })
  const risk = riskModel(items, opts.today)
  const milestone = detectMilestones(items, opts.today)
  const overall = { signal: overallSignal([progress.signal, schedule.signal, risk.signal, milestone.signal]) }
  return { overall, progress, schedule, risk, milestone }
}
