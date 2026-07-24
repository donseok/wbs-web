import type { ComputedItem, Status, TeamCode } from '@/lib/domain/types'
import { DEFAULT_TEAM_CODES } from '@/lib/domain/teams'

/** 칸반 컬럼 — leaf(말단) 작업 카드 묶음. */
export type KanbanColumn = {
  key: string
  title: string
  count: number
  cards: ComputedItem[]
  accentDot?: string
}

const STATUS_ORDER: Status[] = ['not_started', 'in_progress', 'delayed', 'done']

// 순수 도메인 모듈 — JSX(shared.tsx)에 의존하지 않도록 표현 메타를 로컬로 둔다.
const STATUS_LABEL: Record<Status, string> = {
  not_started: '시작전', in_progress: '진행중', delayed: '지연', done: '완료',
}
const STATUS_DOT: Record<Status, string> = {
  not_started: 'bg-pending', in_progress: 'bg-progress', delayed: 'bg-delayed', done: 'bg-done',
}
const TEAM_DOT: Record<TeamCode, string> = {
  PMO: 'bg-team-pmo', 가공: 'bg-team-dt', ERP: 'bg-team-erp', MES: 'bg-team-mes', MDM: 'bg-team-mdm',
}
/** 팀별 CSS 토큰은 기존 5팀만 정의 — 신규 팀은 중립 점(미배정과 동일)으로. */
const teamDot = (team: TeamCode): string => TEAM_DOT[team] ?? 'bg-pending'

/** 말단(자식 없는) 노드 수집 — pure. */
function leavesOf(items: ComputedItem[]): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach(n => { if (!n.children.length) out.push(n); walk(n.children) })
  walk(items)
  return out
}

/** Phase별 — 최상위 phase(root) 1개당 컬럼 1개, 카드 = 해당 phase의 말단 작업들. */
export function groupByPhase(items: ComputedItem[]): KanbanColumn[] {
  return items.map(root => {
    const cards = leavesOf([root])
    return { key: root.id, title: root.name, count: cards.length, cards, accentDot: STATUS_DOT[root.status] }
  })
}

/** 담당자별 — 활성 팀 컬럼 + 미배정. leaf는 primary 담당팀마다 들어가고,
 *  primary가 없거나 전부 컬럼 밖 팀(비활성 등)이면 미배정으로 흡수한다(카드 유실 금지). */
export function groupByOwner(items: ComputedItem[], teams: readonly TeamCode[] = DEFAULT_TEAM_CODES): KanbanColumn[] {
  const leaves = leavesOf(items)
  const buckets: Record<string, ComputedItem[]> = { 미배정: [] }
  for (const team of teams) buckets[team] = []
  for (const leaf of leaves) {
    const primaries = [...new Set(leaf.owners.filter(o => o.kind === 'primary').map(o => o.team))]
    const known = primaries.filter(t => t in buckets)
    if (known.length === 0) buckets['미배정'].push(leaf)
    else known.forEach(team => buckets[team].push(leaf))
  }
  const cols: KanbanColumn[] = teams.map(team => ({
    key: team, title: team, count: buckets[team].length, cards: buckets[team], accentDot: teamDot(team),
  }))
  cols.push({ key: '미배정', title: '미배정', count: buckets['미배정'].length, cards: buckets['미배정'], accentDot: 'bg-pending' })
  return cols
}

/** 상태별 — 시작전/진행중/지연/완료. leaf.status 기준. (상태는 계산값) */
export function groupByStatus(items: ComputedItem[]): KanbanColumn[] {
  const leaves = leavesOf(items)
  return STATUS_ORDER.map(status => {
    const cards = leaves.filter(leaf => leaf.status === status)
    return { key: status, title: STATUS_LABEL[status], count: cards.length, cards, accentDot: STATUS_DOT[status] }
  })
}

/** 진척 버킷 키(파생 status 아님 — 원시 실적% 기준). */
export type ProgressBucket = 'not_started' | 'in_progress' | 'done'

/** 실적% → 버킷. 0·null·음수=시작전, 100 이상=완료, 그 사이=진행중. */
export function bucketOf(pct: number | null): ProgressBucket {
  const v = pct ?? 0
  if (v <= 0) return 'not_started'
  if (v >= 100) return 'done'
  return 'in_progress'
}

const PROGRESS_ORDER: ProgressBucket[] = ['not_started', 'in_progress', 'done']
const PROGRESS_LABEL: Record<ProgressBucket, string> = {
  not_started: '시작전', in_progress: '진행중', done: '완료',
}
const PROGRESS_DOT: Record<ProgressBucket, string> = {
  not_started: 'bg-pending', in_progress: 'bg-progress', done: 'bg-done',
}

/** 진척 3단 — 시작전(0%)/진행중(1~99%)/완료(100%). leaf.rolledActualPct 기준. */
export function groupByProgress(items: ComputedItem[]): KanbanColumn[] {
  const leaves = leavesOf(items)
  return PROGRESS_ORDER.map(bucket => {
    const cards = leaves.filter(leaf => bucketOf(leaf.rolledActualPct) === bucket)
    return { key: bucket, title: PROGRESS_LABEL[bucket], count: cards.length, cards, accentDot: PROGRESS_DOT[bucket] }
  })
}

/** 리프 id → 조상 이름 배열(루트→부모 순, 카드 breadcrumb 용). */
export function leafPaths(items: ComputedItem[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const walk = (ns: ComputedItem[], path: string[]) => {
    for (const n of ns) {
      if (!n.children.length) map.set(n.id, path)
      else walk(n.children, [...path, n.name])
    }
  }
  walk(items, [])
  return map
}

/** 두 'YYYY-MM-DD' 사이 캘린더 일수(to - from). 칸반 마감신호 전용(자기완결). */
function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86400000)
}

export type DueSignal =
  | { kind: 'overdue'; days: number }
  | { kind: 'due'; days: number }
  | null

/** 마감 신호(순수). 완료면 없음, 기한 경과+미완=overdue, 그 외=due(남은 일수). today·plannedEnd는 'YYYY-MM-DD'. */
export function dueSignal(plannedEnd: string | null, cur: number, today: string): DueSignal {
  if (!plannedEnd || cur >= 100) return null
  const d = dayDiff(today, plannedEnd)
  return d < 0 ? { kind: 'overdue', days: -d } : { kind: 'due', days: d }
}

/** 렌즈: 'myTeam'=내 팀이 담당(primary/support)인 리프만, 'all'=전체. myTeam 미상이면 전체. */
export function lensCards(leaves: ComputedItem[], lens: 'myTeam' | 'all', myTeam: string | null): ComputedItem[] {
  if (lens === 'all' || !myTeam) return leaves
  return leaves.filter(leaf => leaf.owners.some(o => o.team === myTeam))
}

export interface QuickFilters {
  overdue: boolean
  dueThisWeek: boolean
  inProgress: boolean
  notStarted: boolean
}

/** 빠른 필터(켜진 것만 AND). overdue=파생 지연, in/not=실적% 버킷, dueThisWeek=오늘~+6일 마감. */
export function applyQuickFilters(leaves: ComputedItem[], f: QuickFilters, today: string): ComputedItem[] {
  return leaves.filter(leaf => {
    if (f.overdue && leaf.status !== 'delayed') return false
    if (f.inProgress && bucketOf(leaf.rolledActualPct) !== 'in_progress') return false
    if (f.notStarted && bucketOf(leaf.rolledActualPct) !== 'not_started') return false
    if (f.dueThisWeek) {
      if (!leaf.plannedEnd) return false
      const d = dayDiff(today, leaf.plannedEnd)
      if (d < 0 || d > 6) return false
    }
    return true
  })
}

/** 정렬(원본 불변): 지연 우선 → 계획종료 오름차순(null 뒤) → 이름(ko). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- today는 시그니처 일관성용(현재 미사용)
export function sortCards(cards: ComputedItem[], _today: string): ComputedItem[] {
  return [...cards].sort((a, b) => {
    const ad = a.status === 'delayed' ? 0 : 1
    const bd = b.status === 'delayed' ? 0 : 1
    if (ad !== bd) return ad - bd
    if (a.plannedEnd !== b.plannedEnd) {
      if (!a.plannedEnd) return 1
      if (!b.plannedEnd) return -1
      return a.plannedEnd < b.plannedEnd ? -1 : 1
    }
    return a.name.localeCompare(b.name, 'ko')
  })
}
