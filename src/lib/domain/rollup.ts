import { buildTree, type TreeNode } from './tree'
import { plannedPct, plannedPctWith, achievementOf, statusOf } from './progress'
import type { BizDayIndex } from './dates'
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

export function siblingWeight(w: number | null): number {
  return w == null ? 1 : w
}

/**
 * 형제 가중 평균 — computeNode와 plannedRollupAt이 공유하는 유일한 결합 규칙.
 * 반올림 위치가 두 곳에서 갈라지지 않도록 여기서만 Math.round 한다.
 */
function weightedMean<T extends { weight: number | null }>(children: T[], valueOf: (c: T) => number): number {
  const totalW = children.reduce((s, c) => s + siblingWeight(c.weight), 0) || 1
  return Math.round(children.reduce((s, c) => s + siblingWeight(c.weight) * valueOf(c), 0) / totalW)
}

/** 날짜 d 시점의 계획 진척(롤업). 리프는 자기 날짜, 상위는 자식 가중평균 — computeNode와 동일 규칙. */
export function plannedRollupAt(node: ComputedItem, d: string, idx: BizDayIndex): number {
  if (node.children.length === 0) {
    return plannedPctWith(node.plannedStart, node.plannedEnd, d, (a, b) => idx.between(a, b))
  }
  return weightedMean(node.children, c => plannedRollupAt(c, d, idx))
}

/** 날짜 d 시점의 전체 계획 진척. overallProgress(...).planned 와 d=today에서 일치해야 한다. */
export function overallPlannedAt(roots: ComputedItem[], d: string, idx: BizDayIndex): number {
  const allNull = roots.every(r => r.weight == null)
  const eff = (r: ComputedItem) => (allNull ? 1 : r.weight ?? 0)
  const totalEff = roots.reduce((s, r) => s + eff(r), 0) || 1
  return Math.round(roots.reduce((s, r) => s + eff(r) * plannedRollupAt(r, d, idx), 0) / totalEff)
}

/**
 * 리프가 프로젝트 전체 100% 중 차지하는 몫(0~1). 루트부터 곱해 내려간다.
 *
 * ⚠ 계획 곡선을 Σ(몫 × 리프 계획%)로 재구성하지 말 것 — overallPlannedAt과 어긋난다.
 *  (1) 롤업은 매 계층에서 Math.round 하므로 평탄합과 1%p 차이가 난다.
 *  (2) 루트 정규화 규칙이 다르다: 여기선 siblingWeight(null→1),
 *      overallPlannedAt/overallProgress는 eff(일부만 weight 있으면 null→0).
 * 곡선·게이지 값은 반드시 overallPlannedAt을 쓴다. 이 함수는 리프 단위 기여도 배분용이다.
 */
export function leafWeightShares(roots: ComputedItem[]): Map<string, number> {
  const out = new Map<string, number>()
  const totalRoot = roots.reduce((s, r) => s + siblingWeight(r.weight), 0) || 1
  const walk = (n: ComputedItem, acc: number) => {
    if (n.children.length === 0) { out.set(n.id, acc); return }
    const totalW = n.children.reduce((s, c) => s + siblingWeight(c.weight), 0) || 1
    n.children.forEach(c => walk(c, (acc * siblingWeight(c.weight)) / totalW))
  }
  roots.forEach(r => walk(r, siblingWeight(r.weight) / totalRoot))
  return out
}

function computeNode(node: TreeNode, today: string, holidays: Set<string>): ComputedItem {
  const children = node.children.map(c => computeNode(c, today, holidays))
  const planned = plannedPct(node.plannedStart, node.plannedEnd, today, holidays)

  let rolledActual: number
  let rolledPlanned = planned
  if (children.length === 0) {
    rolledActual = node.actualPct ?? 0
  } else {
    rolledActual = weightedMean(children, c => c.rolledActualPct)
    rolledPlanned = weightedMean(children, c => c.plannedPct)
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
