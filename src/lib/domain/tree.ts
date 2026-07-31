import type { ComputedItem, WbsRow } from './types'

export type TreeNode = WbsRow & { children: TreeNode[] }

/** tree.ts — 정렬 순서는 주입이 계약(스펙 §5.3). 인자 필수라 tsc 가 전 호출처를 드러낸다.
 *  순수 도메인 모듈은 팀 마스터를 읽지 않는다: 호출부가 팀 마스터의 sort_order 를 주입한다. */
export interface BuildTreeOpts {
  /** 팀코드→표시순위. teamOrderMap(activeCodes(teams)) 를 넘길 것. 미등재 팀은 뒤로. */
  subActTeamOrder: ReadonlyMap<string, number>
}

function subActTeamRank(n: TreeNode, order: ReadonlyMap<string, number>): number {
  const team = n.owners.find(o => o.kind === 'primary')?.team ?? n.owners[0]?.team
  if (team == null) return Number.MAX_SAFE_INTEGER
  return order.get(team) ?? Number.MAX_SAFE_INTEGER - 1
}

export function buildTree(rows: WbsRow[], opts: BuildTreeOpts): TreeNode[] {
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
  // 정렬 규칙(스펙 §5.3): 형제 집합에 isOwnerSplit 이 하나라도 있으면 팀 순위→sortOrder,
  // 아니면 sortOrder 만. 예전 parent?.level === 'activity' 분기를 대체 — 백필된 데이터에서 동치.
  const sort = (ns: TreeNode[]) => {
    if (ns.some(n => n.isOwnerSplit)) {
      ns.sort((a, b) => subActTeamRank(a, opts.subActTeamOrder) - subActTeamRank(b, opts.subActTeamOrder) || a.sortOrder - b.sortOrder)
    } else {
      ns.sort((a, b) => a.sortOrder - b.sortOrder)
    }
    ns.forEach(n => sort(n.children))
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
