import type { ComputedItem, OwnerKind, TeamCode, WbsRow } from './types'

export type TreeNode = WbsRow & { children: TreeNode[] }

/** 팀 표시 순서 — 도메인 단일 출처. sub-act 정렬·병목 열 순서·주간보고가 모두 이걸 쓴다. */
export const TEAMS: TeamCode[] = ['PMO', 'ERP', 'MES', '가공']

const SUB_ACT_TEAM_ORDER: Record<TeamCode, number> =
  Object.fromEntries(TEAMS.map((t, i) => [t, i])) as Record<TeamCode, number>

/** 항목의 대표 담당팀. 주관(primary) 우선, 없으면 첫 담당, 담당 없으면 null. */
export function primaryTeamOf(n: { owners: { team: TeamCode; kind: OwnerKind }[] }): TeamCode | null {
  return n.owners.find(o => o.kind === 'primary')?.team ?? n.owners[0]?.team ?? null
}

function subActTeamRank(n: TreeNode): number {
  const team = primaryTeamOf(n)
  return team != null ? SUB_ACT_TEAM_ORDER[team] : Number.MAX_SAFE_INTEGER
}

export function buildTree(rows: WbsRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  rows.forEach(r => byId.set(r.id, { ...r, children: [] }))
  const roots: TreeNode[] = []
  byId.forEach(node => {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  const sort = (ns: TreeNode[], parent?: TreeNode) => {
    if (parent?.level === 'activity') {
      ns.sort((a, b) => subActTeamRank(a) - subActTeamRank(b) || a.sortOrder - b.sortOrder)
    } else {
      ns.sort((a, b) => a.sortOrder - b.sortOrder)
    }
    ns.forEach(n => sort(n.children, n))
  }
  sort(roots)
  return roots
}

/** 리프(자식 없는 항목)를 트리 순회로 수집. 도메인 계층의 단일 출처. */
export function collectLeaves(items: ComputedItem[]): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) =>
    ns.forEach(n => {
      if (!n.children.length) out.push(n)
      walk(n.children)
    })
  walk(items)
  return out
}
