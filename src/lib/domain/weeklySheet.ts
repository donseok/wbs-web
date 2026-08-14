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

/** D-CUBE 주간보고 양식의 업무영역 구분 — 시트 행 순서이자 PPT 보고 순서(단일 출처).
 *  PMO(사업 관리)를 맨 앞에 두고, 사업/원가(영업·구매·관리회계)에 이어 현장(품질·생산·조업·표준화·물류·설비·가공)이 뒤따른다.
 *  조업과 표준화는 2026-08-14까지 '조업및표준화' 한 구분이었다. 작성자가 셀 안에서 `[조업]`·`[표준화]`
 *  머리글로 손수 갈라 쓰던 관행이 굳어 있어, 그 경계를 구분 자체로 끌어올렸다. */
export const WEEKLY_SECTIONS = [
  'PMO', '영업', '구매', '관리회계', '품질', '생산계획',
  '조업', '표준화', '물류', '설비및L2', '가공',
] as const

/** 매핑 불가 행이 흡수되는 구분 — 어떤 경우에도 이월 내용을 조용히 버리지 않기 위한 종착지. */
const FALLBACK_SECTION: string = WEEKLY_SECTIONS[0]

/** 구 분류 체계(공통/ERP/MES × 모듈) → 신규 구분. 키는 주로 모듈명(구분명보다 구체적)이고,
 *  폐지된 구분명도 같은 표로 흡수한다.
 *
 *  ⚠️ 값은 반드시 `WEEKLY_SECTIONS` 안에 있어야 한다. mapLegacySection은 꺼낸 값이 실제 구분인지
 *  검사하지 않으므로, 구분 이름이 바뀔 때 여기를 함께 고치지 않으면 매핑은 '성공'하는데
 *  carryOverRows의 구분 조회가 빗나가 그 행의 내용이 폴백(PMO)으로 조용히 흘러간다.
 *  tests/domain/weeklySheet.test.ts 의 불변식 테스트가 유일한 안전망이다. */
export const LEGACY_SECTION_MAP: Record<string, string> = {
  'SD/LE': '영업',
  'MD/PP': '생산계획',
  'APS': '생산계획',
  'MM': '구매',
  'FI/TR': '관리회계',
  'CO': '관리회계',
  '품질': '품질',
  // 표기가 둘인 이유: 구 MES 시트는 module에 공백을 넣어 적었고('조업 및 표준화'),
  // 2026-08까지의 신규체계 시트는 section에 공백 없이 적었다('조업및표준화').
  // 어느 쪽도 빠뜨리면 그 경로의 이월 내용만 PMO로 샌다.
  '조업 및 표준화': '조업',
  '조업및표준화': '조업',
  '가공': '가공',
  '설비 Level2': '설비및L2',
  '물류': '물류',
}

const isWeeklySection = (v: string): boolean => (WEEKLY_SECTIONS as readonly string[]).includes(v)

/** 표준 구분은 WEEKLY_SECTIONS의 업무 순서로, 비표준(레거시·자유 입력) 행은 그 뒤에서
 *  기존 sortOrder 순으로 정렬한다. 과거 주차의 sort_order는 주차마다 값이 달라(PMO를 백필한
 *  주차는 -10·1..9, 그 뒤 주차는 1..10) 숫자만으로는 중간에 삽입된 구분을 제자리에 놓을 수 없다.
 *  표시 순서를 이름이 정하게 하면 과거 행의 구조 필드를 고쳐 쓰지 않아도 되고,
 *  화면·점검·PPT·봇 저장소가 한 규칙을 공유하게 된다. */
export function sortWeeklyRows<T extends Pick<WeeklySheetRow, 'section' | 'sortOrder'>>(
  rows: readonly T[],
): T[] {
  const rank = (section: string) => {
    const i = (WEEKLY_SECTIONS as readonly string[]).indexOf(section.trim())
    return i < 0 ? WEEKLY_SECTIONS.length : i
  }
  return [...rows].sort((a, b) => rank(a.section) - rank(b.section) || a.sortOrder - b.sortOrder)
}

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

/** 행 라벨 — 신규 시트는 구분명 단독('영업'), 레거시 행은 '구분 · 모듈'('ERP · SD/LE')로 병기.
 *  구분이 없으면 모듈로 폴백하고 둘 다 없으면 '기타'(이름 없는 묶음이 생기지 않게). */
export function rowSectionLabel(row: Pick<WeeklySheetRow, 'section' | 'module'>): string {
  const sec = row.section.trim(), mod = row.module.trim()
  if (!sec) return mod || '기타'
  return mod && mod !== sec ? `${sec} · ${mod}` : sec
}

/** 한 '구분'으로 묶이는 단위의 키 — PPT 페이지 합성(buildSheetSections)과 주간보고 점검이 공유한다.
 *  표준 구분명이면 모듈과 무관하게 구분명 하나로 묶고(PPT가 한 장으로 싣는 단위), 레거시 행은
 *  라벨(구분 · 모듈)로 가른다 — section이 ERP뿐이라 모듈까지 봐야 영업·구매·관리회계가 갈린다.
 *  폐지된 '조업및표준화' 행도 여기서는 비표준이라 자기 이름으로 묶인다 — 이관 전까지 조업·표준화와
 *  섞이지 않고 별도 페이지로 인쇄된다(내용을 임의로 합치지 않는 쪽을 택한 것).
 *  두 곳이 서로 다른 단위를 쓰면, 점검을 통과한 시트가 PPT에서는 중복으로 인쇄된다. */
export function sectionKeyOf(row: Pick<WeeklySheetRow, 'section' | 'module'>): string {
  const sec = row.section.trim()
  return isWeeklySection(sec) ? sec : rowSectionLabel(row)
}

/** 셀 1개 상한 — 서버 액션·클라이언트 클램프·이월 병합이 공유하는 단일 출처. */
export const WEEKLY_CELL_MAX = 20000

/** 새 주차 기본 스켈레톤 — 업무영역 11행(구분당 1행, 셀은 빈값). 신규 행의 module은 항상 ''. */
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

/** 열 표시 라벨 — 그리드 헤더(COLS)의 단일 출처. */
export const WEEKLY_CELL_LABEL = {
  this_content: '금주실적 내용', this_issue: '금주 이슈·이벤트',
  next_content: '차주계획 내용', next_issue: '차주 이슈·이벤트',
} as const satisfies Record<WeeklyCellKey, string>

/** 멀티셀 변이의 최소 단위 — 붙여넣기·범위삭제·채우기·undo·배치 액션이 공유. 고유성 키는 `${rowId}:${cellKey}`. */
export interface WeeklyCellEdit {
  rowId: string           // weekly_report_rows.id
  cellKey: WeeklyCellKey  // snake_case DB 열명(구조 열 불가침 — 내용 4열만)
  content: string         // 저장할 새 값(0~CELL_MAX)
}

/** 새 주차 이월: 결과는 **항상 표준 11행**이다. 전주 차주계획 → 금주실적, next는 비움.
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
