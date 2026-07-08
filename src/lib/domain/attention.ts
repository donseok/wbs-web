import { attentionLeaves, delayedLeaves, diffDaysCal } from './dashboard'
import { leafWeightShares } from './rollup'
import { collectLeaves } from './tree'
import type { ComputedItem } from './types'

export type ActionKind = 'delayed' | 'dueSoon'

export interface ActionRow {
  item: ComputedItem
  kind: ActionKind
  /** plannedEnd < today 인 경우의 초과 일수. 아니면 0. plannedEnd null → 0. */
  overdueDays: number
  /** max(0, plannedPct - rolledActualPct) */
  gapPp: number
  /** today → plannedEnd 캘린더 일수. 지난 항목은 음수. plannedEnd null → null. */
  dday: number | null
  /** 이 리프가 프로젝트 전체 100% 중 차지하는 몫 (0~1) */
  weightShare: number
}

const KIND_RANK: Record<ActionKind, number> = { delayed: 0, dueSoon: 1 }

/**
 * 전순서. 불안정 정렬에 기대지 않도록 마지막에 sortOrder로 결정적 타이브레이크.
 * 1) 지연 먼저  2) 초과일 많은 순  3) 격차 큰 순  4) 가중치 큰 순  5) sortOrder
 */
export function compareActionRows(a: ActionRow, b: ActionRow): number {
  return (
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    b.overdueDays - a.overdueDays ||
    b.gapPp - a.gapPp ||
    b.weightShare - a.weightShare ||
    a.item.sortOrder - b.item.sortOrder
  )
}

export function buildActionRows(roots: ComputedItem[], today: string): ActionRow[] {
  const leaves = collectLeaves(roots)
  const shares = leafWeightShares(roots)
  const delayedIds = new Set(delayedLeaves(leaves).map(l => l.id))

  return attentionLeaves(leaves, today)
    .map<ActionRow>(item => ({
      item,
      kind: delayedIds.has(item.id) ? 'delayed' : 'dueSoon',
      overdueDays: item.plannedEnd ? Math.max(0, diffDaysCal(item.plannedEnd, today)) : 0,
      gapPp: Math.max(0, item.plannedPct - item.rolledActualPct),
      dday: item.plannedEnd ? diffDaysCal(today, item.plannedEnd) : null,
      weightShare: shares.get(item.id) ?? 0,
    }))
    .sort(compareActionRows)
}
