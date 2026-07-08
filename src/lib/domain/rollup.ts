import { buildTree, type TreeNode } from './tree'
import { plannedPct, achievementOf, statusOf } from './progress'
import { effectiveWeights } from './weight'
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
  const eff = effectiveWeights(roots)
  const totalEff = eff.reduce((s, w) => s + w, 0) || 1
  return {
    actual: Math.round(roots.reduce((s, r, i) => s + eff[i] * r.rolledActualPct, 0) / totalEff),
    planned: Math.round(roots.reduce((s, r, i) => s + eff[i] * r.plannedPct, 0) / totalEff),
  }
}

function computeNode(node: TreeNode, today: string, holidays: Set<string>): ComputedItem {
  const children = node.children.map(c => computeNode(c, today, holidays))
  const planned = plannedPct(node.plannedStart, node.plannedEnd, today, holidays)

  let rolledActual: number
  let rolledPlanned = planned
  if (children.length === 0) {
    rolledActual = node.actualPct ?? 0
  } else {
    const eff = effectiveWeights(children)
    const totalW = eff.reduce((s, w) => s + w, 0) || 1
    rolledActual = Math.round(
      children.reduce((s, c, i) => s + eff[i] * c.rolledActualPct, 0) / totalW,
    )
    rolledPlanned = Math.round(
      children.reduce((s, c, i) => s + eff[i] * c.plannedPct, 0) / totalW,
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
