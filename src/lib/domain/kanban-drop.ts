// 칸반 드롭 규칙 — 순수(I/O 없음). 컬럼은 진척 버킷(kanban.ts ProgressBucket)이고,
// WBS 상태는 파생값이라 '진행중'으로의 진입은 % 를 물어야 한다(prompt). 데이터 되돌림(진척>0→0%)은 확인(confirm-reset).
import type { ComputedItem } from '@/lib/domain/types'
import type { ProgressBucket } from '@/lib/domain/kanban'

export type DropResult =
  | { kind: 'noop' }
  | { kind: 'set'; pct: number }
  | { kind: 'confirm-reset' }
  | { kind: 'prompt'; suggested: number }

/** 카드를 target 버킷에 드롭했을 때의 결과. cur=현재 실적%(rolledActualPct). 편집 권한은 호출부가 선판정. */
export function resolveDrop(card: ComputedItem, target: ProgressBucket): DropResult {
  const cur = card.rolledActualPct ?? 0
  if (target === 'not_started') return cur <= 0 ? { kind: 'noop' } : { kind: 'confirm-reset' }
  if (target === 'done') return cur >= 100 ? { kind: 'noop' } : { kind: 'set', pct: 100 }
  // in_progress
  if (cur > 0 && cur < 100) return { kind: 'noop' }
  return { kind: 'prompt', suggested: cur >= 100 ? 90 : 30 }
}
