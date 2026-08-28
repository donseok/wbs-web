// 대시보드 이슈 현황 도메인 — 순수 함수만(I/O 없음). 카드 3종(현황·추이·조치 대기)이 소비한다.
// 기준일(today)은 호출부가 **실제 오늘**(seoulToday)을 내려준다 — 공정율 base_date 가 아니다.
// 이슈 기한은 실제 달력이라 회의·근태 카드와 같은 시계를 쓴다(DashboardView 섹션 D 주석).
import type { Issue, IssueSeverity, IssueStatus } from './issues'
import { ISSUE_STATUSES, isOverdue } from './issues'
import { ISSUE_MEGA_AREAS, type IssueMegaCode } from './issueAnalysis'
import { addDaysIso, seoulYmd } from './dates'
import { diffDaysCal } from './dashboard'

/** 대시보드가 쓰는 이슈 슬라이스 — getIssuesForDashboard(1쿼리)와 getIssues(전체) 둘 다 만족한다. */
export type DashboardIssue = Pick<
  Issue,
  'id' | 'issueNo' | 'piIssueCode' | 'megaCode' | 'title' | 'status' | 'severity' | 'dueDate' | 'resolvedAt' | 'createdAt'
>

/** 임박 = 오늘(D-0)부터 D-7까지 마감(RiskWorklist dueSoonLeaves 와 같은 창 — 달력일 8일). */
export const DUE_SOON_DAYS = 7
/** '최근 7일 해결' 창 — 오늘 포함 7일(today-6 ~ today). */
export const RESOLVED_WINDOW_DAYS = 7
/** 추이 차트 기본 창(주). */
export const TREND_WEEKS = 12
/** 조치 대기 카드 표시 상한. 넘치는 건수는 hiddenCount 로 알린다(조용한 절단 금지). */
export const QUEUE_LIMIT = 5

const SEVERITY_ORDER: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2 }
const isUnresolved = (i: Pick<DashboardIssue, 'status'>) => i.status !== 'resolved'
/** ISO 타임스탬프 → 서울 'YYYY-MM-DD'. 이미 날짜 문자열이면 그대로. */
const seoulDate = (iso: string) => (iso.length === 10 ? iso : seoulYmd(new Date(iso)))
/** 해결일 — status 가 resolved 일 때만 인정(재오픈 시 resolvedAt 이 남아 있어도 해결로 세지 않는다). */
const resolvedDate = (i: Pick<DashboardIssue, 'status' | 'resolvedAt'>) =>
  i.status === 'resolved' && i.resolvedAt ? seoulDate(i.resolvedAt) : null

export interface IssueKpis {
  total: number
  /** 열림 + 진행중 + 보류 */
  unresolved: number
  /** 기한 경과(당일 제외) + 미해결 — domain/issues.isOverdue */
  overdue: number
  /** 심각도 높음 + 미해결 */
  highUnresolved: number
  /** 최근 RESOLVED_WINDOW_DAYS 일(오늘 포함) 안에 해결된 건수 */
  resolved7d: number
}

export function issueKpis(issues: DashboardIssue[], today: string): IssueKpis {
  const windowStart = addDaysIso(today, -(RESOLVED_WINDOW_DAYS - 1))
  let unresolved = 0, overdue = 0, highUnresolved = 0, resolved7d = 0
  for (const i of issues) {
    if (isUnresolved(i)) {
      unresolved += 1
      if (i.severity === 'high') highUnresolved += 1
    }
    if (isOverdue(i, today)) overdue += 1
    const rd = resolvedDate(i)
    if (rd && rd >= windowStart && rd <= today) resolved7d += 1
  }
  return { total: issues.length, unresolved, overdue, highUnresolved, resolved7d }
}

export type IssueStatusCounts = Record<IssueStatus, number>

export function issueStatusCounts(issues: Pick<DashboardIssue, 'status'>[]): IssueStatusCounts {
  const counts = Object.fromEntries(ISSUE_STATUSES.map(s => [s, 0])) as IssueStatusCounts
  for (const i of issues) counts[i.status] += 1
  return counts
}

export interface IssueMegaRow {
  /** null = 미분류(megaCode 없음). 미분류 행은 해당 이슈가 있을 때만 마지막에 붙는다. */
  code: IssueMegaCode | null
  total: number
  counts: IssueStatusCounts
  /** 해결 비율(정수 %). total 0 이면 null — 0% 와 구분한다. */
  resolvedPct: number | null
}

/** Mega 8영역을 코드순 고정으로 — 이슈 없는 영역도 행을 남긴다(TeamProgress 의 '-' 관례). */
export function issueMegaBreakdown(issues: DashboardIssue[]): IssueMegaRow[] {
  const row = (code: IssueMegaCode | null, list: DashboardIssue[]): IssueMegaRow => {
    const counts = issueStatusCounts(list)
    const total = list.length
    return { code, total, counts, resolvedPct: total ? Math.round(counts.resolved / total * 100) : null }
  }
  const rows = ISSUE_MEGA_AREAS.map(a => row(a.code, issues.filter(i => i.megaCode === a.code)))
  const unclassified = issues.filter(i => i.megaCode === null)
  if (unclassified.length) rows.push(row(null, unclassified))
  return rows
}

export interface IssueTrendPoint {
  weekStart: string   // 월요일
  weekEnd: string     // 일요일
  /** 주말(weekEnd)까지 등록 누적 — 창 이전 등록분 포함 */
  created: number
  /** 주말까지 해결 누적(현재 해결 상태의 해결일 기준) */
  resolved: number
  backlog: number
}

export interface IssueTrendModel {
  points: IssueTrendPoint[]
  /** 등록 누적 최댓값(축 스케일용). 이슈 0건이면 0. */
  max: number
  empty: boolean
}

/** 최근 N주 등록·해결 누적. 주는 월요일 시작, 마지막 주는 오늘이 속한 주. */
export function issueTrend(issues: DashboardIssue[], today: string, weeks = TREND_WEEKS): IssueTrendModel {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()       // 0=일
  const monday = addDaysIso(today, -((dow + 6) % 7))
  const created = issues.map(i => seoulDate(i.createdAt))
  const resolved = issues.map(resolvedDate).filter((d): d is string => d !== null)
  const points: IssueTrendPoint[] = []
  for (let w = weeks - 1; w >= 0; w -= 1) {
    const weekStart = addDaysIso(monday, -7 * w)
    const weekEnd = addDaysIso(weekStart, 6)
    const c = created.filter(d => d <= weekEnd).length
    const r = resolved.filter(d => d <= weekEnd).length
    points.push({ weekStart, weekEnd, created: c, resolved: r, backlog: c - r })
  }
  return { points, max: points.reduce((m, p) => Math.max(m, p.created), 0), empty: issues.length === 0 }
}

export type IssueQueueKind = 'overdue' | 'dueSoon'
export interface IssueQueueRow {
  issue: DashboardIssue
  kind: IssueQueueKind
  /** overdue = 경과 일수, dueSoon = 남은 일수(D-N, 오늘=0) */
  days: number
}
export interface IssueQueueModel {
  rows: IssueQueueRow[]
  overdueCount: number
  dueSoonCount: number
  /** 상한에 걸려 표시하지 못한 건수 */
  hiddenCount: number
}

/** 지연(경과 많은 순) → 임박(가까운 순). 같은 일수면 심각도 높음 먼저. 지연·임박은 기한 기준 상호배타. */
export function issueQueue(issues: DashboardIssue[], today: string, limit = QUEUE_LIMIT): IssueQueueModel {
  const bySeverity = (a: IssueQueueRow, b: IssueQueueRow) => SEVERITY_ORDER[a.issue.severity] - SEVERITY_ORDER[b.issue.severity]
  const overdue: IssueQueueRow[] = issues
    .filter(i => isOverdue(i, today))
    .map(i => ({ issue: i, kind: 'overdue' as const, days: diffDaysCal(i.dueDate!, today) }))
    .sort((a, b) => b.days - a.days || bySeverity(a, b))
  const dueSoon: IssueQueueRow[] = issues
    .filter(i => isUnresolved(i) && i.dueDate !== null && i.dueDate >= today && diffDaysCal(today, i.dueDate) <= DUE_SOON_DAYS)
    .map(i => ({ issue: i, kind: 'dueSoon' as const, days: diffDaysCal(today, i.dueDate!) }))
    .sort((a, b) => a.days - b.days || bySeverity(a, b))
  const all = [...overdue, ...dueSoon]
  return {
    rows: all.slice(0, limit),
    overdueCount: overdue.length,
    dueSoonCount: dueSoon.length,
    hiddenCount: Math.max(0, all.length - limit),
  }
}
