/* ── 시트 선택 기하(순수) — 사각 범위·이동·붙여넣기/채우기/삭제 edit 계산. I/O 없음. ── */

import { WEEKLY_CELL_KEYS, CELL_FIELD, type WeeklyCellKey, type WeeklySheetRow, type WeeklyCellEdit } from './weeklySheet'

/** 선택/편집이 다루는 열 — 4개 내용 열만(D1). 순서 고정. */
export const CONTENT_COLS = WEEKLY_CELL_KEYS // ['this_content','this_issue','next_content','next_issue']

export interface CellAddr { rowId: string; col: WeeklyCellKey }
/** 정규화된 사각형 — 정렬된 rowIds 인덱스와 CONTENT_COLS 인덱스 기준(top≤bottom, left≤right). */
export interface GridRect { top: number; left: number; bottom: number; right: number }

export interface SelectionState {
  active: CellAddr  // 포커스 링 셀
  anchor: CellAddr  // 범위 확장 기준
  editing: boolean
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const colIndex = (col: WeeklyCellKey): number => CONTENT_COLS.indexOf(col)

/** anchor·focus(=active) 주소 → 정규화 rect. 주소가 현재 rowIds/열에 없으면 null. */
export function rectFromAddrs(rowIds: string[], anchor: CellAddr, focus: CellAddr): GridRect | null {
  const aRow = rowIds.indexOf(anchor.rowId)
  const fRow = rowIds.indexOf(focus.rowId)
  const aCol = colIndex(anchor.col)
  const fCol = colIndex(focus.col)
  if (aRow < 0 || fRow < 0 || aCol < 0 || fCol < 0) return null
  return {
    top: Math.min(aRow, fRow), bottom: Math.max(aRow, fRow),
    left: Math.min(aCol, fCol), right: Math.max(aCol, fCol),
  }
}

/** rect 안의 모든 셀 주소(행 우선). 범위를 벗어난 인덱스는 조용히 스킵. */
export function cellsInRect(rowIds: string[], rect: GridRect): CellAddr[] {
  const out: CellAddr[] = []
  for (let r = Math.max(0, rect.top); r <= Math.min(rowIds.length - 1, rect.bottom); r++) {
    for (let c = Math.max(0, rect.left); c <= Math.min(CONTENT_COLS.length - 1, rect.right); c++) {
      out.push({ rowId: rowIds[r], col: CONTENT_COLS[c] })
    }
  }
  return out
}

/** rect 안의 값 격자(복사용) — rows에서 CELL_FIELD로 추출. */
export function valuesInRect(rows: WeeklySheetRow[], rect: GridRect): string[][] {
  const out: string[][] = []
  for (let r = Math.max(0, rect.top); r <= Math.min(rows.length - 1, rect.bottom); r++) {
    const row = rows[r]
    const line: string[] = []
    for (let c = Math.max(0, rect.left); c <= Math.min(CONTENT_COLS.length - 1, rect.right); c++) {
      line.push(row[CELL_FIELD[CONTENT_COLS[c]]])
    }
    out.push(line)
  }
  return out
}

/** active를 (dRow,dCol)만큼 이동 + 경계 클램프. 방향키용. 주소가 그리드 밖이면 그대로. */
export function moveActive(rowIds: string[], active: CellAddr, dRow: number, dCol: number): CellAddr {
  const r = rowIds.indexOf(active.rowId)
  const c = colIndex(active.col)
  if (r < 0 || c < 0) return active
  const nr = clamp(r + dRow, 0, rowIds.length - 1)
  const nc = clamp(c + dCol, 0, CONTENT_COLS.length - 1)
  return { rowId: rowIds[nr], col: CONTENT_COLS[nc] }
}

/** Tab/Shift+Tab 이동 — 행 끝에서 다음/이전 행으로 래핑, 문서 경계에서 정지. */
export function advanceActive(rowIds: string[], active: CellAddr, dir: 'next' | 'prev'): CellAddr {
  const r = rowIds.indexOf(active.rowId)
  const c = colIndex(active.col)
  if (r < 0 || c < 0) return active
  const lastCol = CONTENT_COLS.length - 1
  const lastRow = rowIds.length - 1
  if (dir === 'next') {
    if (c < lastCol) return { rowId: rowIds[r], col: CONTENT_COLS[c + 1] }
    if (r < lastRow) return { rowId: rowIds[r + 1], col: CONTENT_COLS[0] } // 행 끝 → 다음 행 첫 열
    return active // 문서 끝 — 정지
  }
  if (c > 0) return { rowId: rowIds[r], col: CONTENT_COLS[c - 1] }
  if (r > 0) return { rowId: rowIds[r - 1], col: CONTENT_COLS[lastCol] } // 행 앞 → 이전 행 끝 열
  return active
}

/**
 * 붙여넣기: 앵커 + 파싱 격자 → 그리드·4열로 clip한 edits.
 * clippedRows/Cols = 시트 범위(행)·내용 4열을 넘어 잘려나간 수(Toast용, D2/D1).
 */
export function pasteEdits(
  rowIds: string[], anchor: CellAddr, values: string[][],
): { edits: WeeklyCellEdit[]; clippedRows: number; clippedCols: number } {
  const anchorRow = rowIds.indexOf(anchor.rowId)
  const anchorCol = colIndex(anchor.col)
  if (anchorRow < 0 || anchorCol < 0) return { edits: [], clippedRows: 0, clippedCols: 0 }
  const availRows = rowIds.length - anchorRow
  const availCols = CONTENT_COLS.length - anchorCol
  const edits: WeeklyCellEdit[] = []
  let maxWidth = 0
  for (let i = 0; i < values.length; i++) {
    const line = values[i]
    if (line.length > maxWidth) maxWidth = line.length
    if (i >= availRows) continue // 행 넘침 — clip
    const rowId = rowIds[anchorRow + i]
    for (let j = 0; j < line.length && j < availCols; j++) {
      edits.push({ rowId, cellKey: CONTENT_COLS[anchorCol + j], content: line[j] })
    }
  }
  return {
    edits,
    clippedRows: Math.max(0, values.length - availRows),
    clippedCols: Math.max(0, maxWidth - availCols),
  }
}

/**
 * 채우기: source 값을 target 방향으로 복사 타일(D4, 시리즈 추론 없음).
 * source 셀은 그대로 두고 target에서 source를 뺀 영역만 edits. 타일 원점은 source(위/왼쪽 드래그도 반복).
 */
export function fillEdits(
  rows: WeeklySheetRow[], rowIds: string[], source: GridRect, target: GridRect,
): WeeklyCellEdit[] {
  const sH = source.bottom - source.top + 1
  const sW = source.right - source.left + 1
  if (sH <= 0 || sW <= 0) return []
  const edits: WeeklyCellEdit[] = []
  for (let r = target.top; r <= target.bottom; r++) {
    if (r < 0 || r >= rowIds.length) continue
    const inSrcRow = r >= source.top && r <= source.bottom
    for (let c = target.left; c <= target.right; c++) {
      if (c < 0 || c >= CONTENT_COLS.length) continue
      if (inSrcRow && c >= source.left && c <= source.right) continue // source 셀 제외
      const sr = source.top + ((((r - source.top) % sH) + sH) % sH)  // 음수 오프셋(위/왼쪽 채우기) 보정
      const sc = source.left + ((((c - source.left) % sW) + sW) % sW)
      const srcRow = rows[sr]
      if (srcRow == null) continue
      edits.push({ rowId: rowIds[r], cellKey: CONTENT_COLS[c], content: srcRow[CELL_FIELD[CONTENT_COLS[sc]]] })
    }
  }
  return edits
}

/** 범위 비우기: rect의 모든 셀을 ''로. 이미 빈 셀은 제외(불필요 저장 방지, AC5.4). */
export function clearEdits(rows: WeeklySheetRow[], rowIds: string[], rect: GridRect): WeeklyCellEdit[] {
  const edits: WeeklyCellEdit[] = []
  for (let r = Math.max(0, rect.top); r <= Math.min(rows.length - 1, rect.bottom); r++) {
    const row = rows[r]
    for (let c = Math.max(0, rect.left); c <= Math.min(CONTENT_COLS.length - 1, rect.right); c++) {
      const col = CONTENT_COLS[c]
      if (row[CELL_FIELD[col]] === '') continue // 이미 빈 셀 스킵
      edits.push({ rowId: rowIds[r], cellKey: col, content: '' })
    }
  }
  return edits
}

/**
 * rows 변경 시 선택 재조정: 사라진 rowId 참조를 드롭하고 active를 유효 범위로 클램프.
 * - active·anchor 모두 살아있으면 원본 그대로 반환(참조 동일 — 불필요 리렌더 방지).
 * - active 소멸: 마지막 행으로 클램프(열 유지), 편집 종료.
 * - anchor 소멸: active로 접어 단일 셀 선택으로 축소.
 * - rowIds가 비면 null(유효 셀 없음).
 */
export function reconcileSelection(rowIds: string[], sel: SelectionState): SelectionState | null {
  if (rowIds.length === 0) return null
  const hasActive = rowIds.includes(sel.active.rowId)
  const hasAnchor = rowIds.includes(sel.anchor.rowId)
  if (hasActive && hasAnchor) return sel
  const active: CellAddr = hasActive ? sel.active : { rowId: rowIds[rowIds.length - 1], col: sel.active.col }
  const anchor: CellAddr = hasAnchor ? sel.anchor : active
  return { active, anchor, editing: hasActive ? sel.editing : false }
}
