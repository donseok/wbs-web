import { buildTree, type TreeNode } from './tree'
import { plannedPct, achievementOf, statusOf } from './progress'
import type { ComputedItem, WbsRow } from './types'

export function computeTree(rows: WbsRow[], today: string, holidays: Set<string>): ComputedItem[] {
  const tree = buildTree(rows)
  return tree.map(node => computeNode(node, today, holidays))
}

/**
 * 프로젝트 전체 공정율 — 루트(Phase) 가중 평균. weight가 모두 null이면 균등.
 * 대시보드·현황 보고서·기타 요약이 같은 값을 쓰도록 단일 출처로 공유한다.
 */
export function overallProgress(roots: ComputedItem[]): { actual: number; planned: number } {
  const allNull = roots.every(r => r.weight == null)
  const eff = (r: ComputedItem) => (allNull ? 1 : r.weight ?? 0)
  const totalEff = roots.reduce((s, r) => s + eff(r), 0) || 1
  return {
    actual: Math.round(roots.reduce((s, r) => s + eff(r) * r.rolledActualPct, 0) / totalEff),
    planned: Math.round(roots.reduce((s, r) => s + eff(r) * r.plannedPct, 0) / totalEff),
  }
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
