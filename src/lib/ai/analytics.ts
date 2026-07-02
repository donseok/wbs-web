// ============================================================================
// DK Bot 분석 (순수 모듈) — 로드된 WBS 트리/멤버로부터 의도별 사실(facts)·답변 문장을
// 생성한다. 화면/Supabase 비의존 → 단위 테스트 용이. 주차/KPI 계산은 보고서와 동일하게
// buildWeeklyReportModel 을 재사용해 일관성을 보장한다.
// ============================================================================

import { buildWeeklyReportModel, type WeeklyReportModel } from '@/lib/report/weekly'
import { overallProgress } from '@/lib/domain/rollup'
import type { ComputedItem, ProjectMember, Status, TeamCode } from '@/lib/domain/types'

const STATUS_KO: Record<Status, string> = {
  not_started: '시작 전',
  in_progress: '진행중',
  delayed: '지연',
  done: '완료',
}
const LEVEL_KO = { phase: 'Phase', task: 'Task', activity: 'Activity' } as const
const TEAMS: TeamCode[] = ['PMO', 'DT', 'ERP', 'MES']

export interface LeafCtx {
  node: ComputedItem
  phaseName: string
  parentName: string | null
}

export interface ProjectSummary {
  name: string
  taskCount: number
  done: number
  donePct: number
  planned: number
  delayed: number
  statusCount: Record<Status, number>
}

export interface ProjectAnalysis extends ProjectSummary {
  today: string
  weekStart: string
  weekEnd: string
  weekRange: string
  weekly: WeeklyReportModel
  leaves: LeafCtx[]
  delayed_: LeafCtx[]
  completed_: LeafCtx[]
  startingThisWeek: LeafCtx[]
  activeThisWeek: LeafCtx[]
}

/* ── 날짜 유틸 (UTC, 타임존 무관) ── */
function parseUTC(d: string): number {
  const [y, m, day] = d.split('-').map(Number)
  return Date.UTC(y, m - 1, day)
}
function addDaysIso(iso: string, n: number): string {
  const dt = new Date(parseUTC(iso) + n * 86_400_000)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}
function diffDays(fromIso: string, toIso: string): number {
  return Math.round((parseUTC(toIso) - parseUTC(fromIso)) / 86_400_000)
}
function overlaps(aStart: string | null, aEnd: string | null, bStart: string, bEnd: string): boolean {
  const s = aStart ?? aEnd
  const e = aEnd ?? aStart
  if (!s || !e) return false
  return s <= bEnd && e >= bStart
}
const dd = (s: string | null): string => s ?? '미정'

function ownersText(owners: ComputedItem['owners']): string {
  if (!owners.length) return '미배정'
  const primary = owners.filter(o => o.kind === 'primary').map(o => o.team)
  const support = owners.filter(o => o.kind === 'support').map(o => `(${o.team})`)
  return [...primary, ...support].join(' ') || '미배정'
}

function collectLeaves(items: ComputedItem[]): LeafCtx[] {
  const out: LeafCtx[] = []
  const walk = (node: ComputedItem, phaseName: string, parentName: string | null) => {
    if (!node.children.length) {
      out.push({ node, phaseName, parentName })
      return
    }
    for (const c of node.children) walk(c, phaseName, node.name)
  }
  for (const root of items) walk(root, root.name, null)
  return out
}

function emptyStatusCount(): Record<Status, number> {
  return { not_started: 0, in_progress: 0, delayed: 0, done: 0 }
}

/** 단일 프로젝트 트리 분석 → 의도별 포매터가 쓰는 구조화 사실. */
export function analyzeProject(
  items: ComputedItem[],
  projectName: string,
  today: string,
  members: ProjectMember[] = [],
): ProjectAnalysis {
  const weekly = buildWeeklyReportModel(items, { name: projectName }, today, { members })
  const leaves = collectLeaves(items)
  const statusCount = emptyStatusCount()
  for (const l of leaves) statusCount[l.node.status]++

  const { actual, planned } = overallProgress(items)
  const { weekStart, weekRange } = weekly.meta
  const weekEnd = addDaysIso(weekStart, 6) // 일요일(주 종료). WeeklyMeta 는 weekStart/weekDays(월~금)만 노출

  const delayed_ = leaves.filter(l => l.node.status === 'delayed')
  const completed_ = leaves.filter(l => l.node.status === 'done')
  const startingThisWeek = leaves.filter(
    l => l.node.plannedStart && l.node.plannedStart >= weekStart && l.node.plannedStart <= weekEnd,
  )
  const activeThisWeek = leaves.filter(
    l => l.node.status !== 'done' && overlaps(l.node.plannedStart, l.node.plannedEnd, weekStart, weekEnd),
  )

  return {
    name: projectName,
    taskCount: leaves.length,
    done: statusCount.done,
    donePct: actual,
    planned,
    delayed: statusCount.delayed,
    statusCount,
    today,
    weekStart,
    weekEnd,
    weekRange,
    weekly,
    leaves,
    delayed_,
    completed_,
    startingThisWeek,
    activeThisWeek,
  }
}

export function summarizeProject(analysis: ProjectAnalysis): ProjectSummary {
  const { name, taskCount, done, donePct, planned, delayed, statusCount } = analysis
  return { name, taskCount, done, donePct, planned, delayed, statusCount }
}

/* ── 포매터 (의도별 답변/사실 문장) ── */

function statusBreakdown(c: Record<Status, number>): string {
  return `완료 ${c.done} · 진행중 ${c.in_progress} · 지연 ${c.delayed} · 시작 전 ${c.not_started}`
}

function bulletLeaf(l: LeafCtx, extra?: (n: ComputedItem) => string): string {
  const n = l.node
  const tail = extra ? ` · ${extra(n)}` : ''
  return `• [${l.phaseName}] ${n.name} — 담당 ${ownersText(n.owners)}${tail}`
}

function listWithCap(rows: string[], max: number): string {
  if (rows.length <= max) return rows.join('\n')
  return [...rows.slice(0, max), `…외 ${rows.length - max}건 더`].join('\n')
}

export function answerProjectStatus(a: ProjectAnalysis): string {
  const gap = a.planned - a.donePct
  const gapText = gap > 0 ? ` (계획 ${a.planned}%, ${gap}%p 미달)` : gap < 0 ? ` (계획 ${a.planned}%, ${-gap}%p 초과 달성)` : ` (계획과 동일)`
  return [
    `"${a.name}" 현황입니다.`,
    `• 전체 작업: ${a.taskCount}건 (${statusBreakdown(a.statusCount)})`,
    `• 공정률(실적): ${a.donePct}%${gapText}`,
    // 주차 라벨 아래에는 주차-스코프 수치만 둔다(지연/완료 누계는 위 '전체 작업'에 표기).
    `• 이번 주(${a.weekRange}) 시작 예정 ${a.startingThisWeek.length}건 · 이번 주 완료 ${a.weekly.kpi.doneThisWeek}건`,
  ].join('\n')
}

export function answerDelayed(a: ProjectAnalysis): string {
  if (a.delayed_.length === 0) return `"${a.name}"에 지연된 작업이 없습니다. 👍 계획대로 진행 중이에요.`
  const rows = a.delayed_
    .slice()
    .sort((x, y) => diffDays(y.node.plannedEnd ?? a.today, a.today) - diffDays(x.node.plannedEnd ?? a.today, a.today))
    .map(l =>
      bulletLeaf(l, n => {
        const late = n.plannedEnd && a.today > n.plannedEnd ? `${diffDays(n.plannedEnd, a.today)}일 지연` : '지연'
        return `마감 ${dd(n.plannedEnd)} (${late}) · 실적 ${n.rolledActualPct}%/계획 ${n.plannedPct}%`
      }),
    )
  return [`"${a.name}" 지연 작업 ${a.delayed_.length}건입니다.`, listWithCap(rows, 12)].join('\n')
}

export function answerCompleted(a: ProjectAnalysis): string {
  if (a.completed_.length === 0) return `"${a.name}"에 아직 완료된 작업이 없습니다.`
  const rows = a.completed_.map(l => bulletLeaf(l, n => `기간 ${dd(n.plannedStart)}~${dd(n.plannedEnd)}`))
  return [`"${a.name}" 완료 작업 ${a.completed_.length}건입니다.`, listWithCap(rows, 15)].join('\n')
}

export function answerThisWeekStart(a: ProjectAnalysis): string {
  if (a.startingThisWeek.length === 0) return `이번 주(${a.weekRange})에 시작 예정인 작업이 없습니다.`
  const rows = a.startingThisWeek
    .slice()
    .sort((x, y) => (x.node.plannedStart ?? '').localeCompare(y.node.plannedStart ?? ''))
    .map(l => bulletLeaf(l, n => `시작 ${dd(n.plannedStart)} · 마감 ${dd(n.plannedEnd)}`))
  return [`이번 주(${a.weekRange}) 시작 예정 작업 ${a.startingThisWeek.length}건입니다.`, listWithCap(rows, 12)].join('\n')
}

export function answerThisWeek(a: ProjectAnalysis): string {
  if (a.activeThisWeek.length === 0) return `이번 주(${a.weekRange})에 진행/예정인 작업이 없습니다.`
  const rows = a.activeThisWeek
    .slice()
    .sort((x, y) => (x.node.plannedStart ?? '').localeCompare(y.node.plannedStart ?? ''))
    .map(l => bulletLeaf(l, n => `${dd(n.plannedStart)}~${dd(n.plannedEnd)} · ${STATUS_KO[n.status]} · 실적 ${n.rolledActualPct}%`))
  return [`이번 주(${a.weekRange}) 진행·예정 작업 ${a.activeThisWeek.length}건입니다.`, listWithCap(rows, 12)].join('\n')
}

export function answerByTeam(a: ProjectAnalysis, members: ProjectMember[]): string {
  const memberByTeam = new Map<string, string[]>()
  for (const m of members) {
    const key = m.teamCode ?? '미배정'
    const arr = memberByTeam.get(key) ?? []
    arr.push(m.name)
    memberByTeam.set(key, arr)
  }

  const buckets = new Map<string, ComputedItem[]>()
  for (const t of TEAMS) buckets.set(t, [])
  buckets.set('미배정', [])
  for (const l of a.leaves) {
    const primaries = [...new Set(l.node.owners.filter(o => o.kind === 'primary').map(o => o.team))]
    if (primaries.length === 0) buckets.get('미배정')!.push(l.node)
    else for (const team of primaries) buckets.get(team)!.push(l.node)
  }

  const rows: string[] = []
  for (const team of [...TEAMS, '미배정']) {
    const cards = buckets.get(team) ?? []
    if (cards.length === 0 && team === '미배정') continue
    const c = emptyStatusCount()
    for (const n of cards) c[n.status]++
    const memberNames = memberByTeam.get(team)
    const memberText = memberNames && memberNames.length ? ` · 멤버 ${memberNames.join(', ')}` : ''
    rows.push(`• ${team} — 작업 ${cards.length}건 (완료 ${c.done} · 진행 ${c.in_progress} · 지연 ${c.delayed})${memberText}`)
  }
  return [`"${a.name}" 담당(팀)별 업무 현황입니다.`, ...rows].join('\n')
}

export function answerWeeklySummary(a: ProjectAnalysis): string {
  const k = a.weekly.kpi
  const gap = k.planned - k.actual
  const gapText = gap > 0 ? `${gap}%p 미달` : gap < 0 ? `${-gap}%p 초과` : '계획과 동일'
  const topIssue = a.weekly.issues[0]
  return [
    `${a.weekly.meta.weekLabel} 주간 요약입니다.`,
    `• 공정률: 실적 ${k.actual}% / 계획 ${k.planned}% (${gapText})`,
    `• 작업: 총 ${k.total}건 — 완료 ${k.done} · 진행 ${k.inProgress} · 지연 ${k.delayed} · 시작 전 ${k.notStarted}`,
    `• 이번 주 완료 ${k.doneThisWeek}건 · 차주 예정 ${k.nextWeekPlanCount}건` + (k.maxDelayDays > 0 ? ` · 최대 지연 ${k.maxDelayDays}일` : ''),
    `• 주요 이슈: ${topIssue ? topIssue.content : '특이 이슈 없음'}`,
  ].join('\n')
}

export function answerOverview(summaries: ProjectSummary[], excludedCount = 0): string {
  if (summaries.length === 0) {
    return excludedCount > 0
      ? `프로젝트 ${excludedCount}개가 일시적 오류로 집계되지 않았습니다. 잠시 후 다시 시도해 주세요.`
      : '등록된 프로젝트가 없습니다.'
  }
  const rows = summaries.map(
    s => `• "${s.name}" — 공정률 ${s.donePct}% (계획 ${s.planned}%) · 작업 ${s.taskCount}건(완료 ${s.done}) · 지연 ${s.delayed}`,
  )
  const totals = summaries.reduce(
    (acc, s) => ({ tasks: acc.tasks + s.taskCount, done: acc.done + s.done, delayed: acc.delayed + s.delayed }),
    { tasks: 0, done: 0, delayed: 0 },
  )
  const donePct = totals.tasks ? Math.round((totals.done / totals.tasks) * 100) : 0
  const lines = [
    `전체 ${summaries.length}개 프로젝트 현황입니다.`,
    ...rows,
    `합계: 작업 ${totals.tasks}건 · 완료 ${totals.done}건(${donePct}%) · 지연 ${totals.delayed}건`,
  ]
  // 일부 프로젝트가 일시적 오류로 빠졌으면 합계가 과소집계임을 명시(조용한 누락 방지).
  if (excludedCount > 0) lines.push(`※ 프로젝트 ${excludedCount}개는 일시적 오류로 합계에서 제외됐습니다.`)
  return lines.join('\n')
}

const clipText = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s)

/** 팩트시트 한 줄 포맷 — 전체 목록(buildFactSheet)과 키워드 일치(keywordMatchLines) 공용. */
function leafLine(l: LeafCtx): string {
  const n = l.node
  const seg = [
    `[${l.phaseName}] ${n.name}`,
    `담당 ${ownersText(n.owners)}`,
    `상태 ${STATUS_KO[n.status]}`,
    `기간 ${dd(n.plannedStart)}~${dd(n.plannedEnd)}`,
    `실적 ${n.rolledActualPct}%/계획 ${n.plannedPct}%`,
  ]
  if (n.deliverable) seg.push(`산출물 ${clipText(n.deliverable, 40)}`)
  if (n.biz) seg.push(`업무 ${clipText(n.biz, 60)}`)
  return `- ${seg.join(' · ')}`
}

/**
 * 이름/단계명/업무/산출물에 키워드(부분 문자열, 대소문자 무시)가 포함된 리프 작업을
 * 팩트시트 형식 줄로 반환. "X 가 들어간 항목" 류 검색 질문의 정확·완전한 근거가 된다
 * (임베딩 의미검색은 정확 문자열 일치를 보장하지 못한다).
 */
export function keywordMatchLines(
  a: ProjectAnalysis,
  keywords: string[],
  max = 30,
): { total: number; lines: string[] } {
  const kws = keywords.map(k => k.toLowerCase()).filter(Boolean)
  if (!kws.length) return { total: 0, lines: [] }
  const hit = a.leaves.filter(l => {
    const hay = `${l.phaseName} ${l.node.name} ${l.node.biz ?? ''} ${l.node.deliverable ?? ''}`.toLowerCase()
    return kws.some(k => hay.includes(k))
  })
  return { total: hit.length, lines: hit.slice(0, max).map(leafLine) }
}

/**
 * 자유질문(freeform) LLM 근거용 — 프로젝트의 모든 리프 작업을 한 줄씩 압축한 팩트시트.
 * 의미검색(RAG) 재현율에 의존하지 않고 "누가 X 담당?", "X 언제 끝나?", "MES 진행률" 같은
 * 구체 질문에 LLM 이 직접 답할 수 있게 전체 사실을 컨텍스트로 넣는다. 소규모 WBS 라 토큰상 안전하나,
 * 초대형 프로젝트를 대비해 상한(max)을 둔다(초과분은 명시 표기 → 조용한 누락 방지).
 */
export function buildFactSheet(a: ProjectAnalysis, max = 160): string {
  const rows = a.leaves.map(leafLine)
  const shown = rows.length <= max ? rows : rows.slice(0, max)
  const header = `"${a.name}" 전체 작업 목록 (${a.taskCount}건, ${statusBreakdown(a.statusCount)}):`
  const body = [header, ...shown]
  if (rows.length > max) body.push(`…외 ${rows.length - max}건 더(구체 항목은 프로젝트에서 확인)`)
  return body.join('\n')
}

/* ── 임베딩용 문서 빌더 ── */

export interface EmbedDoc {
  kind: 'wbs_item' | 'project' | 'member'
  refId: string | null
  content: string
}

/** 프로젝트의 WBS 리프·요약·멤버를 의미검색용 문서로 변환. */
export function buildDocuments(
  items: ComputedItem[],
  projectName: string,
  today: string,
  members: ProjectMember[] = [],
): EmbedDoc[] {
  const analysis = analyzeProject(items, projectName, today, members)
  const docs: EmbedDoc[] = []

  // 1) 프로젝트 요약 문서
  docs.push({ kind: 'project', refId: null, content: answerProjectStatus(analysis) })

  // 2) WBS 리프 작업 문서
  for (const l of analysis.leaves) {
    const n = l.node
    const lines = [
      `[${projectName}] ${l.phaseName} > ${n.name}`,
      `구분 ${LEVEL_KO[n.level]} · 담당 ${ownersText(n.owners)} · 상태 ${STATUS_KO[n.status]}`,
      `기간 ${dd(n.plannedStart)}~${dd(n.plannedEnd)} · 계획 ${n.plannedPct}% / 실적 ${n.rolledActualPct}%`,
    ]
    if (n.deliverable) lines.push(`산출물 ${n.deliverable}`)
    if (n.biz) lines.push(`업무내용 ${n.biz}`)
    docs.push({ kind: 'wbs_item', refId: n.id, content: lines.join('\n') })
  }

  // 3) 멤버 문서
  for (const m of members) {
    docs.push({
      kind: 'member',
      refId: m.id,
      content: `[${projectName}] 멤버 ${m.name}${m.teamCode ? ` · 팀 ${m.teamCode}` : ''}${m.title ? ` · ${m.title}` : ''}${m.role ? ` · 권한 ${m.role}` : ''}`,
    })
  }

  return docs
}
