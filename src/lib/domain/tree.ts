import type { WbsRow } from './types'

export type TreeNode = WbsRow & { children: TreeNode[] }

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
  const sort = (ns: TreeNode[]) => {
    ns.sort((a, b) => a.sortOrder - b.sortOrder)
    ns.forEach(n => sort(n.children))
  }
  sort(roots)
  return roots
}
