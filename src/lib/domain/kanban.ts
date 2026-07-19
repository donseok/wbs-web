import type { ComputedItem, Status, TeamCode } from '@/lib/domain/types'

/** 칸반 컬럼 — leaf(말단) 작업 카드 묶음. */
export type KanbanColumn = {
  key: string
  title: string
  count: number
  cards: ComputedItem[]
  accentDot?: string
}

const TEAMS: TeamCode[] = ['PMO', 'ERP', 'MES', '가공', 'MDM']
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

/** 담당자별 — PMO/ERP/MES/가공/MDM + 미배정. leaf는 primary 담당팀마다 들어가고, primary가 없으면 미배정. */
export function groupByOwner(items: ComputedItem[]): KanbanColumn[] {
  const leaves = leavesOf(items)
  const buckets: Record<string, ComputedItem[]> = { PMO: [], ERP: [], MES: [], 가공: [], MDM: [], 미배정: [] }
  for (const leaf of leaves) {
    const primaries = [...new Set(leaf.owners.filter(o => o.kind === 'primary').map(o => o.team))]
    if (primaries.length === 0) buckets['미배정'].push(leaf)
    else primaries.forEach(team => buckets[team].push(leaf))
  }
  const cols: KanbanColumn[] = TEAMS.map(team => ({
    key: team, title: team, count: buckets[team].length, cards: buckets[team], accentDot: TEAM_DOT[team],
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
