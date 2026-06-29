import { buildTree, type TreeNode } from './tree'
import { plannedPct, achievementOf, statusOf } from './progress'
import type { ComputedItem, WbsRow } from './types'

export function computeTree(rows: WbsRow[], today: string, holidays: Set<string>): ComputedItem[] {
  const tree = buildTree(rows)
  return tree.map(node => computeNode(node, today, holidays))
}

function siblingWeight(w: number | null): number {
  return w == null ? 1 : w
}

function computeNode(node: TreeNode, today: string, holidays: Set<string>): ComputedItem {
  const children = node.children.map(c => computeNode(c, today, holidays))
  const planned = plannedPct(node.plannedStart, node.plannedEnd, today, holidays)

  let rolledActual: number
  let rolledPlanned = planned
  if (children.length === 0) {
    rolledActual = node.actualPct ?? 0
  } else {
    const totalW = children.reduce((s, c) => s + siblingWeight(c.weight), 0) || 1
    rolledActual = Math.round(
      children.reduce((s, c) => s + siblingWeight(c.weight) * c.rolledActualPct, 0) / totalW,
    )
    rolledPlanned = Math.round(
      children.reduce((s, c) => s + siblingWeight(c.weight) * c.plannedPct, 0) / totalW,
    )
  }

  return {
    ...node,
    plannedPct: rolledPlanned,
    rolledActualPct: rolledActual,
    achievement: achievementOf(rolledActual, rolledPlanned),
    status: statusOf(rolledActual, rolledPlanned, node.plannedStart, today),
    children,
  }
}
