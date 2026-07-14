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

/** D-CUBE 주간보고 양식의 업무영역 구분 — 시트는 이 목록 그대로 구분당 1행. */
export const WEEKLY_SECTIONS = [
  '영업', '품질', '생산계획', '조업및표준화', '가공',
  '물류', '설비및L2', '관리회계', '구매',
] as const

/** 매핑 불가 행이 흡수되는 구분 — 어떤 경우에도 이월 내용을 조용히 버리지 않기 위한 종착지. */
const FALLBACK_SECTION: string = WEEKLY_SECTIONS[0]

/** 구 분류 체계(공통/ERP/MES × 모듈) → 신규 구분. 키는 모듈명(구분명보다 구체적). */
const LEGACY_SECTION_MAP: Record<string, string> = {
  'SD/LE': '영업',
  'MD/PP': '생산계획',
  'APS': '생산계획',
  'MM': '구매',
  'FI/TR': '관리회계',
  'CO': '관리회계',
  '품질': '품질',
  '조업 및 표준화': '조업및표준화',
  '가공': '가공',
  '설비 Level2': '설비및L2',
  '물류': '물류',
}

const isWeeklySection = (v: string): boolean => (WEEKLY_SECTIONS as readonly string[]).includes(v)

/** 소유 프로퍼티만 조회 — 'toString'·'constructor' 같은 Object.prototype 상속 키가 함수를 돌려주면
 *  ?? 폴백이 발동하지 않아 흡수 계약이 깨지고 그 행의 이월 내용이 통째로 사라진다. */
const lookupLegacy = (k: string): string | undefined =>
  Object.hasOwn(LEGACY_SECTION_MAP, k) ? LEGACY_SECTION_MAP[k] : undefined

/** 레거시 행 → 신규 구분. 이미 신규 구분이면 항등. 매핑 불가는 첫 구분으로 흡수(내용 유실 방지). */
export function mapLegacySection(section: string, module: string): string {
  const sec = section.trim(), mod = module.trim()
  if (isWeeklySection(sec)) return sec
  return lookupLegacy(mod) ?? lookupLegacy(sec) ?? FALLBACK_SECTION
}

/** 셀 1개 상한 — 서버 액션·클라이언트 클램프·이월 병합이 공유하는 단일 출처. */
export const WEEKLY_CELL_MAX = 20000

/** 새 주차 기본 스켈레톤 — 업무영역 9행(구분당 1행, 셀은 빈값). 신규 행의 module은 항상 ''. */
export function defaultWeeklyRows(): NewWeeklyRow[] {
  return WEEKLY_SECTIONS.map((section, i) => ({
    section, module: '', sortOrder: i + 1,
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

/** 멀티셀 변이의 최소 단위 — 붙여넣기·범위삭제·채우기·undo·배치 액션이 공유. 고유성 키는 `${rowId}:${cellKey}`. */
export interface WeeklyCellEdit {
  rowId: string           // weekly_report_rows.id
  cellKey: WeeklyCellKey  // snake_case DB 열명(구조 열 불가침 — 내용 4열만)
  content: string         // 저장할 새 값(0~CELL_MAX)
}

/** 새 주차 이월: 결과는 **항상 표준 9행**이다. 전주 차주계획 → 금주실적, next는 비움.
 *  레거시(공통/ERP/MES) 시트는 mapLegacySection으로 신규 구분에 흡수하고, 같은 구분으로
 *  모이는 내용(FI/TR + CO → 관리회계)은 sortOrder 순서대로 줄바꿈으로 이어붙인다.
 *  이 정규화가 없으면 레거시 시트에서 이월한 새 주차가 다시 구 13행 구조로 태어난다. */
export function carryOverRows(prev: WeeklySheetRow[]): NewWeeklyRow[] {
  const out = defaultWeeklyRows()
  const bySection = new Map(out.map(r => [r.section, r]))
  // 붙이는 값의 앞뒤 공백·개행을 실제로 다듬는다. 사용자가 셀 마지막 줄에서 Enter를 친 흔한 경우,
  // 후행 개행이 병합 구분자 \n과 겹쳐 빈 줄이 되고 PPT에 빈 불릿으로 찍힌다(셀 내부 문단 빈 줄은 보존).
  // 상한을 넘기면 더 붙이지 않는다 — 넘긴 채 시드되면 그 셀은 이후 저장 자체가 거부된다.
  const append = (cur: string, add: string) => {
    const t = add.trim()
    if (!t) return cur
    const merged = cur ? `${cur}\n${t}` : t
    return merged.length > WEEKLY_CELL_MAX ? merged.slice(0, WEEKLY_CELL_MAX) : merged
  }
  for (const r of [...prev].sort((a, b) => a.sortOrder - b.sortOrder)) {
    // 매핑 실패 시에도 행을 버리지 않는다 — mapLegacySection이 폴백을 보장하지만, 방어적으로 한 번 더.
    const target = bySection.get(mapLegacySection(r.section, r.module)) ?? bySection.get(FALLBACK_SECTION)!
    target.thisContent = append(target.thisContent, r.nextContent)
    target.thisIssue = append(target.thisIssue, r.nextIssue)
  }
  return out
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
