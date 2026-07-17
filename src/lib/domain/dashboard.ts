import type { ComputedItem, TeamCode } from './types'
import { round1 } from './format'
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
    return { totalDays: 0, elapsed: 0, remaining: 0, elapsedPct: 0, projectedEnd: null, slipDays: null, signal: 'neutral', label: 'none' }
  }
  const totalDays = Math.max(1, diffDaysCal(s, e) + 1)
  const elapsed = clampN(diffDaysCal(s, today) + 1, 0, totalDays)
  const remaining = totalDays - elapsed
  const elapsedPct = Math.round((elapsed / totalDays) * 100)
  const base = { totalDays, elapsed, remaining, elapsedPct }

  // 완료 예외 — 종료일 경과여도 done이면 정상
  if (overallActual >= 100) return { ...base, projectedEnd: null, slipDays: null, signal: 'green', label: 'done' }
  // 조기 가드 — SPI 불안정 구간은 정직하게 회색(초록 아님)
  const earlyFloor = Math.max(14, Math.round(totalDays * 0.15))
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

export function detectMilestones(items: ComputedItem[], today: string): MilestoneModel {
  const cands = collectLeaves(items).filter(
    l => isMilestoneLeaf(l) && l.plannedEnd != null && l.status !== 'done',
  )
  const overdue = cands.filter(l => l.plannedEnd! < today).sort(byEndThenOrder)
  if (overdue.length > 0) {
    const od = overdue[0]
    return { name: od.name, date: od.plannedEnd, dday: diffDaysCal(today, od.plannedEnd!), overdue: true, signal: 'red' }
  }
  const next = cands.filter(l => l.plannedEnd! >= today).sort(byEndThenOrder)[0]
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

export interface RiskModel { delayed: number; dueSoon: number; topWeightDelayed: boolean; signal: Signal }

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
  const topWeightDelayed = topWeightPhaseDelayed(roots)
  let signal: Signal = delayed >= 4 ? 'red' : delayed >= 1 ? 'amber' : 'green'
  if (topWeightDelayed) signal = escalate(signal)
  return { delayed, dueSoon, topWeightDelayed, signal }
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
  // round1 없이 빼면 FP 노이즈(예: 6.3-8.3 = -2.000000000000001)가 progressSignal의
  // -2/-10 경계를 넘어 표시(-2.0%p)와 신호가 어긋난다.
  const variance = round1(actual - planned)
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

/* ═══════════════ 본문 재구성(2026-07-09) 신규 모델 ═══════════════ */

/* ── Phase × 팀 진척 매트릭스 ── */
export interface MatrixCell { pct: number; planned: number; count: number }
export interface MatrixRow {
  id: string; name: string
  cells: (MatrixCell | null)[]
  overall: number; planned: number; variance: number
}

/** 셀 = 해당 팀이 담당(primary·support 모두)인 leaf들의 단순 평균. 무배정이면 null. */
export function progressMatrix(roots: ComputedItem[], teams: readonly TeamCode[]): MatrixRow[] {
  const avg = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) / ns.length)
  return roots.map(phase => {
    const leaves = collectLeaves([phase])
    const cells = teams.map(team => {
      const owned = leaves.filter(l => l.owners.some(o => o.team === team))
      if (!owned.length) return null
      return { pct: avg(owned.map(l => l.rolledActualPct)), planned: avg(owned.map(l => l.plannedPct)), count: owned.length }
    })
    return {
      id: phase.id, name: phase.name, cells,
      overall: phase.rolledActualPct, planned: phase.plannedPct,
      variance: phase.rolledActualPct - phase.plannedPct,
    }
  })
}

/* ── 팀별 진척 — 대시보드 카드와 주간 보고서 모달(By owner)이 공유하는 단일 정의 ── */
export const ALL_TEAMS: readonly TeamCode[] = ['PMO', 'ERP', 'MES', '가공']
export interface TeamProgressEntry { team: TeamCode; count: number; pct: number | null }

/** 팀이 담당(primary·support 모두)인 leaf들의 rolledActual 단순 평균(정수). 무배정 팀은 pct null. */
export function teamProgress(leaves: ComputedItem[], teams: readonly TeamCode[] = ALL_TEAMS): TeamProgressEntry[] {
  const avg = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) / ns.length)
  return teams.map(team => {
    const assigned = leaves.filter(l => l.owners.some(o => o.team === team))
    return { team, count: assigned.length, pct: assigned.length ? avg(assigned.map(l => l.rolledActualPct)) : null }
  })
}

/* ── 편차 랭킹 — 뒤처졌지만 아직 마감 전(따라잡기 후보). 기한 경과분은 delayAging 전담.
 *    statusOf 상 actual<planned ⟺ delayed 이므로 분리 기준은 상태가 아니라 마감 경과 여부다. ── */
export interface VarianceEntry { item: ComputedItem; gapPp: number }

export function varianceRanking(leaves: ComputedItem[], today: string, limit = 8): VarianceEntry[] {
  return leaves
    .filter(l => l.status !== 'done' && (l.plannedEnd == null || l.plannedEnd >= today))
    .map(l => ({ item: l, gapPp: l.plannedPct - l.rolledActualPct }))
    .filter(e => e.gapPp > 0)
    .sort((a, b) => b.gapPp - a.gapPp || a.item.sortOrder - b.item.sortOrder)
    .slice(0, limit)
}

/* ── 마일스톤 타임라인 — 완료 포함 전체 여정(detectMilestones는 '다음 1개' 전용으로 유지) ── */
export type MilestoneStatus = 'done' | 'overdue' | 'upcoming'
export interface MilestonePoint { id: string; name: string; date: string; status: MilestoneStatus; dday: number }

export function milestoneTimeline(items: ComputedItem[], today: string): MilestonePoint[] {
  return collectLeaves(items)
    .filter(l => isMilestoneLeaf(l) && l.plannedEnd != null)
    .map(l => ({
      id: l.id, name: l.name, date: l.plannedEnd!,
      status: (l.status === 'done' ? 'done' : l.plannedEnd! < today ? 'overdue' : 'upcoming') as MilestoneStatus,
      dday: diffDaysCal(today, l.plannedEnd!),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/* ── 지연 에이징 — 기한(plannedEnd) 경과 미완료 작업. 경과일은 항상 ≥ 1. ── */
export interface AgingEntry { item: ComputedItem; overdue: number; gap: number }
export interface AgingModel { d1_7: number; d8_14: number; d15plus: number; total: number; list: AgingEntry[] }

export function delayAging(leaves: ComputedItem[], today: string, limit = 8): AgingModel {
  const entries = leaves
    .filter(l => l.status !== 'done' && l.plannedEnd != null && l.plannedEnd < today)
    .map(l => ({ item: l, overdue: diffDaysCal(l.plannedEnd!, today), gap: Math.max(0, l.plannedPct - l.rolledActualPct) }))
    .sort((a, b) => b.overdue - a.overdue || b.gap - a.gap)
  return {
    d1_7: entries.filter(e => e.overdue <= 7).length,
    d8_14: entries.filter(e => e.overdue >= 8 && e.overdue <= 14).length,
    d15plus: entries.filter(e => e.overdue >= 15).length,
    total: entries.length,
    list: entries.slice(0, limit),
  }
}

/* ── 데이터 위생 — 계획 데이터 품질(PMO 거버넌스) ── */
export interface HygieneModel { noOwner: number; noDates: number; mixedWeight: number; clean: boolean }

/** mixedWeight: 형제 그룹에서 weight가 일부만 null이면 카운트.
 *  루트 그룹은 null→유효가중 0(overallProgress eff), 자식 그룹은 null→1(siblingWeight)로
 *  형제와 다른 의도치 않은 가중이 걸리는 실제 버그 소지다. */
export function dataHygiene(items: ComputedItem[]): HygieneModel {
  const leaves = collectLeaves(items)
  const noOwner = leaves.filter(l => l.owners.length === 0).length
  const noDates = leaves.filter(l => l.plannedStart == null && l.plannedEnd == null).length
  let mixedWeight = 0
  const checkGroup = (group: ComputedItem[]) => {
    if (group.length >= 2 && group.some(g => g.weight == null) && group.some(g => g.weight != null)) mixedWeight++
  }
  checkGroup(items)
  const walk = (ns: ComputedItem[]) =>
    ns.forEach(n => { if (n.children.length) { checkGroup(n.children); walk(n.children) } })
  walk(items)
  return { noOwner, noDates, mixedWeight, clean: noOwner === 0 && noDates === 0 && mixedWeight === 0 }
}
