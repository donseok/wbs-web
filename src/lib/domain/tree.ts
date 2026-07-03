import type { TeamCode, WbsRow } from './types'

export type TreeNode = WbsRow & { children: TreeNode[] }

/* sub-act(act 하위 팀별 분리 항목) 고정 표시 순서 — 임포트 시 저장된 sortOrder와 무관하게 항상 이 순서 */
const SUB_ACT_TEAM_ORDER: Record<TeamCode, number> = { PMO: 0, ERP: 1, MES: 2, 가공: 3 }

function subActTeamRank(n: TreeNode): number {
  const team = n.owners.find(o => o.kind === 'primary')?.team ?? n.owners[0]?.team
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
