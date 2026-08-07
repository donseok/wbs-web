import { cellsInRect, type GridRect } from './sheetSelection'
import {
  CELL_FIELD, rowSectionLabel, WEEKLY_CELL_LABEL,
  type WeeklyCellEdit, type WeeklyCellKey, type WeeklySheetRow,
} from './weeklySheet'

export interface WeeklyRewriteTarget {
  rowId: string
  cellKey: WeeklyCellKey
  section: string
  label: string
  original: string
}

export interface WeeklyRewriteCandidate {
  rowId: string
  cellKey: WeeklyCellKey
  original: string
  content: string
}

/** 현재 선택 사각형을 행 우선 순서의 AI 대상 목록으로 바꾸되 빈 셀은 제외한다. */
export function buildWeeklyRewriteSelection(
  rows: WeeklySheetRow[],
  rect: GridRect,
): WeeklyRewriteTarget[] {
  const byId = new Map(rows.map(row => [row.id, row]))
  return cellsInRect(rows.map(row => row.id), rect).flatMap(({ rowId, col }) => {
    const row = byId.get(rowId)
    if (!row) return []
    const original = row[CELL_FIELD[col]]
    if (!original.trim()) return []
    return [{
      rowId,
      cellKey: col,
      section: rowSectionLabel(row),
      label: WEEKLY_CELL_LABEL[col],
      original,
    }]
  })
}

/**
 * AI 요청 이후 원문이 한 글자라도 달라졌거나 행이 사라졌다면 전체 적용을 막는다.
 * 일부만 적용하면 사용자가 미리보기에서 확인한 변경 묶음과 실제 저장 결과가 달라지기 때문이다.
 */
export function prepareApplicableWeeklyRewriteEdits(
  rows: WeeklySheetRow[],
  candidates: WeeklyRewriteCandidate[],
): { ok: true; edits: WeeklyCellEdit[] } | { ok: false } {
  const byId = new Map(rows.map(row => [row.id, row]))
  const seen = new Set<string>()
  const edits: WeeklyCellEdit[] = []

  for (const candidate of candidates) {
    const address = `${candidate.rowId}:${candidate.cellKey}`
    const row = byId.get(candidate.rowId)
    if (seen.has(address) || !row || row[CELL_FIELD[candidate.cellKey]] !== candidate.original)
      return { ok: false }
    seen.add(address)
    if (candidate.content.trim() && candidate.content !== candidate.original) {
      edits.push({ rowId: candidate.rowId, cellKey: candidate.cellKey, content: candidate.content })
    }
  }

  return { ok: true, edits }
}
