/* ── 주간업무 시트 도메인(순수) — 행 타입·셀 키·이월·서버 병합. I/O 없음. ── */

export interface WeeklySheetRow {
  id: string
  reportId: string
  section: string
  module: string
  sortOrder: number
  thisContent: string
  thisIssue: string
  nextContent: string
  nextIssue: string
}

export type NewWeeklyRow = Omit<WeeklySheetRow, 'id' | 'reportId'>

/** 레퍼런스 시트의 표준 분류 체계 — 구분·모듈 콤보박스 옵션. 자유 값은 '직접 입력' 경로로 허용. */
export const WEEKLY_SECTIONS = ['공통', 'ERP', 'MES'] as const

export const WEEKLY_MODULES: Record<string, readonly string[]> = {
  공통: ['공통'],
  ERP: ['SD/LE', 'MD/PP', 'MM', 'FI/TR', 'CO'],
  MES: ['품질', 'APS', '조업 및 표준화', '가공', '설비 Level2', '물류'],
}

/** 구분별 모듈 옵션. 미지의 구분은 전체 평탄화, current는 목록에 없으면 선두에 포함. */
export function moduleOptions(section: string, current?: string): string[] {
  const base = WEEKLY_MODULES[section] ?? Object.values(WEEKLY_MODULES).flat()
  return current && !base.includes(current) ? [current, ...base] : [...base]
}

/** 새 주차 기본 스켈레톤 — 표준 분류 12행(셀은 빈값). '빈 시트로 시작' 대신 이 프레임을 시드. */
export function defaultWeeklyRows(): NewWeeklyRow[] {
  return WEEKLY_SECTIONS.flatMap(section => WEEKLY_MODULES[section].map(module => ({ section, module })))
    .map((r, i) => ({
      ...r, sortOrder: i + 1,
      thisContent: '', thisIssue: '', nextContent: '', nextIssue: '',
    }))
}

/** 셀 저장 가능한 DB 열 화이트리스트 — 구조 필드(section/module/sort_order)는 별도 액션으로만. */
export const WEEKLY_CELL_KEYS = ['this_content', 'this_issue', 'next_content', 'next_issue'] as const
export type WeeklyCellKey = (typeof WEEKLY_CELL_KEYS)[number]
export function isWeeklyCellKey(v: string): v is WeeklyCellKey {
  return (WEEKLY_CELL_KEYS as readonly string[]).includes(v)
}

export const CELL_FIELD = {
  this_content: 'thisContent', this_issue: 'thisIssue',
  next_content: 'nextContent', next_issue: 'nextIssue',
} as const satisfies Record<WeeklyCellKey, keyof WeeklySheetRow>

/** 새 주차 이월(스펙 §4): 행 구성 복사 + 전주 차주계획→금주실적, next는 비움. sortOrder 재부여. */
export function carryOverRows(prev: WeeklySheetRow[]): NewWeeklyRow[] {
  return [...prev]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r, i) => ({
      section: r.section, module: r.module, sortOrder: i + 1,
      thisContent: r.nextContent, thisIssue: r.nextIssue,
      nextContent: '', nextIssue: '',
    }))
}

/** Realtime/refresh 병합(스펙 §5): dirty(`${rowId}:${cellKey}`) 셀만 로컬 유지, 나머지는 서버 채택. */
export function applyServerRow(
  local: WeeklySheetRow, server: WeeklySheetRow, dirty: ReadonlySet<string>,
): WeeklySheetRow {
  const merged = { ...server }
  for (const key of WEEKLY_CELL_KEYS) {
    if (dirty.has(`${server.id}:${key}`)) merged[CELL_FIELD[key]] = local[CELL_FIELD[key]]
  }
  return merged
}
