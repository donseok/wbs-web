/**
 * 한국 법정 공휴일·대체공휴일·국경일(비공휴일) 데이터 — 달력 표시 전용.
 * 프로젝트 설정의 수동 공휴일(간트 영업일 계산용)과는 별개 레이어다.
 *
 * 데이터 원칙:
 * - 음력 기반(설날·추석·부처님오신날)과 대체공휴일은 규칙 계산 대신 연도별
 *   확정 테이블로 명시한다 — 공식 월력요항·행정안전부 발표와 대조 검증이 가능하도록.
 * - 테이블 밖 연도는 양력 고정 특일만 폴백으로 계산한다(음력 특일은 미표시).
 * - 선거일은 법정 선거일 기준으로 수록(조기 선거 등 변수 시 갱신 필요),
 *   임시공휴일은 국무회의 의결·고시된 것만 수록한다.
 * - 2020~2026년은 공식 월력요항 미러(hyunbinseo/holidays-kr)와 전량 일치 검증,
 *   전 연도를 웹 교차 검증(Nager.Date + 한국어 공식 소스) 완료 — 2026-07-02 기준.
 */

export type KrSpecialDayKind = 'holiday' | 'substitute' | 'anniversary'

/** i18n 키(`hol.${name}`)로 매핑되는 로직 키 — ATTENDANCE_META와 같은 패턴 */
export type KrSpecialDayName =
  | 'newYear' | 'seollal' | 'samiljeol' | 'childrensDay' | 'buddha'
  | 'memorialDay' | 'jeheonjeol' | 'liberationDay' | 'chuseok'
  | 'gaecheonjeol' | 'hangulDay' | 'christmas' | 'substitute'
  | 'electionDay' | 'tempHoliday' | 'workersDay' | 'armedForcesDay' | 'laborDay'

export interface KrSpecialDay {
  date: string // 'YYYY-MM-DD'
  kind: KrSpecialDayKind
  name: KrSpecialDayName
}

type Row = [md: string, kind: KrSpecialDayKind, name: KrSpecialDayName]

/**
 * 양력 고정 특일 — 테이블 밖 연도 폴백에도 사용.
 * 2026년 대통령령 제36290호(관공서의 공휴일에 관한 규정 개정)로 두 특일의 지위가 바뀌었다:
 * - 제헌절(7/17): 2008~2025 무휴 국경일 → 2026년부터 공휴일 재지정.
 * - 5/1: 2025년까지 근로자의날(민간 유급휴일, 관공서 공휴일 아님) → 2026년부터 '노동절'로 개칭·공휴일화.
 * 둘 다 2026년부터 대체공휴일 제도 적용(공식 2027 월력요항에 대체일 명시 확인).
 */
function fixedRows(year: number): Row[] {
  const since2026 = year >= 2026
  return [
    ['01-01', 'holiday', 'newYear'],
    ['03-01', 'holiday', 'samiljeol'],
    ['05-01', since2026 ? 'holiday' : 'anniversary', since2026 ? 'laborDay' : 'workersDay'],
    ['05-05', 'holiday', 'childrensDay'],
    ['06-06', 'holiday', 'memorialDay'],
    ['07-17', since2026 ? 'holiday' : 'anniversary', 'jeheonjeol'],
    ['08-15', 'holiday', 'liberationDay'],
    ['10-03', 'holiday', 'gaecheonjeol'],
    ['10-09', 'holiday', 'hangulDay'],
    ['12-25', 'holiday', 'christmas'],
  ]
}

/** 음력 특일·대체공휴일·선거일·임시공휴일 — 연도별 확정분(고정 특일은 FIXED에서 합성) */
const VARIABLE: Record<number, Row[]> = {
  2020: [
    ['01-24', 'holiday', 'seollal'], ['01-25', 'holiday', 'seollal'], ['01-26', 'holiday', 'seollal'],
    ['01-27', 'substitute', 'substitute'],
    ['04-15', 'holiday', 'electionDay'],
    ['04-30', 'holiday', 'buddha'],
    ['08-17', 'holiday', 'tempHoliday'],
    ['09-30', 'holiday', 'chuseok'], ['10-01', 'holiday', 'chuseok'], ['10-02', 'holiday', 'chuseok'],
  ],
  2021: [
    ['02-11', 'holiday', 'seollal'], ['02-12', 'holiday', 'seollal'], ['02-13', 'holiday', 'seollal'],
    ['05-19', 'holiday', 'buddha'],
    ['08-16', 'substitute', 'substitute'],
    ['09-20', 'holiday', 'chuseok'], ['09-21', 'holiday', 'chuseok'], ['09-22', 'holiday', 'chuseok'],
    ['10-04', 'substitute', 'substitute'], ['10-11', 'substitute', 'substitute'],
  ],
  2022: [
    ['01-31', 'holiday', 'seollal'], ['02-01', 'holiday', 'seollal'], ['02-02', 'holiday', 'seollal'],
    ['03-09', 'holiday', 'electionDay'],
    ['05-08', 'holiday', 'buddha'],
    ['06-01', 'holiday', 'electionDay'],
    ['09-09', 'holiday', 'chuseok'], ['09-10', 'holiday', 'chuseok'], ['09-11', 'holiday', 'chuseok'],
    ['09-12', 'substitute', 'substitute'], ['10-10', 'substitute', 'substitute'],
  ],
  2023: [
    ['01-21', 'holiday', 'seollal'], ['01-22', 'holiday', 'seollal'], ['01-23', 'holiday', 'seollal'],
    ['01-24', 'substitute', 'substitute'],
    ['05-27', 'holiday', 'buddha'], ['05-29', 'substitute', 'substitute'],
    ['09-28', 'holiday', 'chuseok'], ['09-29', 'holiday', 'chuseok'], ['09-30', 'holiday', 'chuseok'],
    ['10-02', 'holiday', 'tempHoliday'],
  ],
  2024: [
    ['02-09', 'holiday', 'seollal'], ['02-10', 'holiday', 'seollal'], ['02-11', 'holiday', 'seollal'],
    ['02-12', 'substitute', 'substitute'],
    ['04-10', 'holiday', 'electionDay'],
    ['05-06', 'substitute', 'substitute'],
    ['05-15', 'holiday', 'buddha'],
    ['09-16', 'holiday', 'chuseok'], ['09-17', 'holiday', 'chuseok'], ['09-18', 'holiday', 'chuseok'],
    ['10-01', 'holiday', 'armedForcesDay'],
  ],
  2025: [
    ['01-27', 'holiday', 'tempHoliday'],
    ['01-28', 'holiday', 'seollal'], ['01-29', 'holiday', 'seollal'], ['01-30', 'holiday', 'seollal'],
    ['03-03', 'substitute', 'substitute'],
    ['05-05', 'holiday', 'buddha'], // 어린이날과 겹침 — 표시 병합은 FIXED의 어린이날이 우선
    ['05-06', 'substitute', 'substitute'],
    ['06-03', 'holiday', 'electionDay'],
    ['10-05', 'holiday', 'chuseok'], ['10-06', 'holiday', 'chuseok'], ['10-07', 'holiday', 'chuseok'],
    ['10-08', 'substitute', 'substitute'],
  ],
  2026: [
    ['02-16', 'holiday', 'seollal'], ['02-17', 'holiday', 'seollal'], ['02-18', 'holiday', 'seollal'],
    ['03-02', 'substitute', 'substitute'],
    ['05-24', 'holiday', 'buddha'], ['05-25', 'substitute', 'substitute'],
    ['06-03', 'holiday', 'electionDay'],
    ['08-17', 'substitute', 'substitute'],
    ['09-24', 'holiday', 'chuseok'], ['09-25', 'holiday', 'chuseok'], ['09-26', 'holiday', 'chuseok'],
    ['10-05', 'substitute', 'substitute'],
  ],
  2027: [
    ['02-06', 'holiday', 'seollal'], ['02-07', 'holiday', 'seollal'], ['02-08', 'holiday', 'seollal'],
    ['02-09', 'substitute', 'substitute'],
    ['05-03', 'substitute', 'substitute'], // 노동절(5/1 토) 대체
    ['05-13', 'holiday', 'buddha'],
    ['07-19', 'substitute', 'substitute'], // 제헌절(7/17 토) 대체
    ['08-16', 'substitute', 'substitute'],
    ['09-14', 'holiday', 'chuseok'], ['09-15', 'holiday', 'chuseok'], ['09-16', 'holiday', 'chuseok'],
    ['10-04', 'substitute', 'substitute'], ['10-11', 'substitute', 'substitute'],
    ['12-27', 'substitute', 'substitute'],
  ],
  2028: [
    ['01-26', 'holiday', 'seollal'], ['01-27', 'holiday', 'seollal'], ['01-28', 'holiday', 'seollal'],
    ['04-12', 'holiday', 'electionDay'],
    ['05-02', 'holiday', 'buddha'],
    ['10-02', 'holiday', 'chuseok'], ['10-03', 'holiday', 'chuseok'], ['10-04', 'holiday', 'chuseok'],
    ['10-05', 'substitute', 'substitute'], // 추석 연휴가 개천절(10/3)과 겹침
  ],
  2029: [
    ['02-12', 'holiday', 'seollal'], ['02-13', 'holiday', 'seollal'], ['02-14', 'holiday', 'seollal'],
    ['05-07', 'substitute', 'substitute'],
    ['05-20', 'holiday', 'buddha'], ['05-21', 'substitute', 'substitute'],
    ['09-21', 'holiday', 'chuseok'], ['09-22', 'holiday', 'chuseok'], ['09-23', 'holiday', 'chuseok'],
    ['09-24', 'substitute', 'substitute'],
  ],
  2030: [
    ['02-02', 'holiday', 'seollal'], ['02-03', 'holiday', 'seollal'], ['02-04', 'holiday', 'seollal'],
    ['02-05', 'substitute', 'substitute'],
    ['03-27', 'holiday', 'electionDay'], // 제22대 대선(임기만료 기준 법정일 — 조기 선거 시 변동 가능)
    ['05-06', 'substitute', 'substitute'],
    ['05-09', 'holiday', 'buddha'],
    ['06-12', 'holiday', 'electionDay'], // 제10회 지방선거
    ['09-11', 'holiday', 'chuseok'], ['09-12', 'holiday', 'chuseok'], ['09-13', 'holiday', 'chuseok'],
  ],
}

/** 명시 테이블이 있는 연도 범위 — 이 밖은 FIXED 폴백만 적용된다. */
export const KR_HOLIDAY_TABLE_YEARS = Object.keys(VARIABLE).map(Number)

const KIND_PRIORITY: Record<KrSpecialDayKind, number> = { holiday: 0, substitute: 1, anniversary: 2 }

/** 한 해의 특일 목록 — 같은 날짜 중복 시 공휴일 > 대체공휴일 > 기념일 순으로 1건 병합. */
export function krSpecialDays(year: number): KrSpecialDay[] {
  const rows = [...fixedRows(year), ...(VARIABLE[year] ?? [])]
  const byDate = new Map<string, KrSpecialDay>()
  for (const [md, kind, name] of rows) {
    const date = `${year}-${md}`
    const prev = byDate.get(date)
    if (!prev || KIND_PRIORITY[kind] < KIND_PRIORITY[prev.kind]) {
      byDate.set(date, { date, kind, name })
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** 여러 해의 특일을 날짜 키 맵으로 — 달력 그리드(월 경계 셀 포함) 조회용. */
export function krSpecialDayMap(years: Iterable<number>): Map<string, KrSpecialDay> {
  const map = new Map<string, KrSpecialDay>()
  for (const y of new Set(years)) {
    for (const d of krSpecialDays(y)) map.set(d.date, d)
  }
  return map
}
