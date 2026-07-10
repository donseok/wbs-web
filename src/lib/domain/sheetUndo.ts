/* ── 셀 값 undo/redo 스택(순수 리듀서) — 배치 단위, 셀 값만(D3). I/O 없음. ── */

import type { WeeklyCellEdit } from './weeklySheet'

/** 한 배치의 되돌리기 정보 — before/after는 같은 셀 집합에 대한 이전/이후 값. */
export interface UndoBatch { before: WeeklyCellEdit[]; after: WeeklyCellEdit[] }
export interface UndoState { past: UndoBatch[]; future: UndoBatch[] }

export const UNDO_LIMIT = 100 // 스택 상한 — 초과 시 오래된 것 폐기(메모리 방어, AC6.8)
export const emptyUndo: UndoState = { past: [], future: [] }

/** 새 배치 기록 — future 비우고 past에 push, UNDO_LIMIT 초과 시 오래된 것 폐기. */
export function pushUndo(state: UndoState, batch: UndoBatch): UndoState {
  const past = [...state.past, batch]
  if (past.length > UNDO_LIMIT) past.splice(0, past.length - UNDO_LIMIT)
  return { past, future: [] } // 새 편집 → redo 무효화
}

/** 되돌리기 — past 최상단을 future로 옮기고, 적용할 edits(=before 값) 반환. 없으면 null. */
export function undo(state: UndoState): { state: UndoState; apply: WeeklyCellEdit[] } | null {
  if (state.past.length === 0) return null
  const batch = state.past[state.past.length - 1]
  return {
    state: { past: state.past.slice(0, -1), future: [...state.future, batch] },
    apply: batch.before,
  }
}

/** 다시 실행 — future 최상단을 past로 옮기고, 적용할 edits(=after 값) 반환. 없으면 null. */
export function redo(state: UndoState): { state: UndoState; apply: WeeklyCellEdit[] } | null {
  if (state.future.length === 0) return null
  const batch = state.future[state.future.length - 1]
  return {
    state: { past: [...state.past, batch], future: state.future.slice(0, -1) },
    apply: batch.after,
  }
}
