import * as XLSX from 'xlsx'

/**
 * wbs.xlsx 양식(2026-08-24) — 임포트 마법사가 100% 자동 감지하는 형식을 빈손인 사용자에게 내려준다.
 * 형식은 scripts/wbs/build-xlsx.mjs 와 같다: 시트 'WBS'(pickSheets 우선), 헤더는 전부 LOGICAL_ALIASES
 * 완전일치, 계층은 아웃라인 코드(1 / 1.1 / 1.1.1), 'Holiday' 시트는 이름으로 인식.
 * 정적 파일 대신 코드로 만드는 이유: 감지기(detect.ts)가 바뀌면 tests/excel/template.test.ts 가 깨져 드리프트를 잡는다.
 */
export const TEMPLATE_HEADER = ['코드', '업무명', '업무영역', '산출물', '시작일', '종료일', '가중치', '실적%', '담당'] as const

/** 로컬 정오 Date — 시리얼 경계(UTC 자정)에서 하루가 밀리는 것을 막는다(build-xlsx.mjs toCell 과 동일). */
function d(iso: string): Date {
  const [y, m, day] = iso.split('-').map(Number)
  return new Date(y, m - 1, day, 12, 0, 0)
}

/** 예시 행 — 아웃라인 3층, 부모 기간은 자식을 덮고, 가중치는 형제 합 1.0, 실적% 는 비움(진도는 D'Flow 가 정본). */
export const TEMPLATE_ROWS: unknown[][] = [
  ['1',     '기반 구축',        '공통', '',                d('2026-09-01'), d('2026-09-12'), 1,   '', ''],
  ['1.1',   '초기화',           '공통', '',                d('2026-09-01'), d('2026-09-12'), 1,   '', ''],
  ['1.1.1', '프로젝트 스캐폴드', '공통', '리포·CI 설정',     d('2026-09-01'), d('2026-09-04'), 0.5, '', '●'],
  ['1.1.2', 'DB 스키마',        '공통', 'ERD·마이그레이션', d('2026-09-07'), d('2026-09-12'), 0.5, '', '●'],
  ['2',     '기능 개발',        '생산', '',                d('2026-09-14'), d('2026-10-02'), 1,   '', ''],
  ['2.1',   'API',              '생산', '',                d('2026-09-14'), d('2026-09-25'), 0.6, '', ''],
  ['2.1.1', '설비 CRUD API',    '생산', 'API 명세',        d('2026-09-14'), d('2026-09-18'), 0.5, '', '●'],
  ['2.1.2', '이벤트 등록 API',  '생산', 'API 명세',        d('2026-09-21'), d('2026-09-25'), 0.5, '', '△'],
  ['2.2',   '화면',             '생산', '',                d('2026-09-28'), d('2026-10-02'), 0.4, '', ''],
  ['2.2.1', '설비 목록 화면',   '생산', '화면 정의서',     d('2026-09-28'), d('2026-10-02'), 1,   '', '●'],
]

export const TEMPLATE_HOLIDAYS: [string, string][] = [
  ['2026-10-03', '개천절'],
  ['2026-10-09', '한글날'],
]

/** '작성법' 시트 — 임포터 규칙을 사람 말로. 이 시트는 감지기가 무시한다(시트명 'WBS' 우선). */
export const TEMPLATE_GUIDE: string[][] = [
  ['wbs.xlsx 작성법'],
  [''],
  ['1', "시트 이름은 'WBS' 와 'Holiday' 를 그대로 둡니다. 이 '작성법' 시트는 지워도 됩니다."],
  ['2', '코드는 아웃라인 번호(1 / 1.1 / 1.1.1)로 계층을 나타냅니다. 최대 4단(1.1.1.1).'],
  ['3', '헤더 이름(코드·업무명·업무영역·산출물·시작일·종료일·가중치·실적%·담당)은 바꾸지 않습니다.'],
  ['4', '시작일·종료일은 날짜 셀 또는 YYYY-MM-DD 텍스트. 상위 행 기간은 하위를 덮게 적습니다.'],
  ['5', '가중치는 형제끼리 합이 1이 되게(안 맞으면 형제 균등으로 봅니다).'],
  ['6', '담당은 ● (주담당) / △ (지원). 팀명을 직접 써도 됩니다.'],
  ['7', '실적% 는 비워 둡니다 — 진도는 D\'Flow 에서 관리합니다.'],
  ['8', 'Holiday 시트에 회사 휴일(날짜, 이름)을 적으면 계획%가 영업일 기준으로 계산됩니다. 음력 휴일은 직접 확인해 적습니다.'],
  ['9', '예시 행은 지우고 실제 항목을 넣습니다. 행 수 제한은 없습니다.'],
]

export function buildWbsTemplateWorkbook(): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet([[...TEMPLATE_HEADER], ...TEMPLATE_ROWS], { cellDates: true })
  ws['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 }]
  for (const ref of Object.keys(ws)) {
    const cell = ws[ref] as { t?: string; z?: string }
    if (!ref.startsWith('!') && cell.t === 'd') cell.z = 'yyyy-mm-dd'
  }
  const hs = XLSX.utils.aoa_to_sheet([['날짜', '이름'], ...TEMPLATE_HOLIDAYS.map(([iso, name]) => [d(iso), name])], { cellDates: true })
  hs['!cols'] = [{ wch: 12 }, { wch: 16 }]
  for (const ref of Object.keys(hs)) {
    const cell = hs[ref] as { t?: string; z?: string }
    if (!ref.startsWith('!') && cell.t === 'd') cell.z = 'yyyy-mm-dd'
  }
  const gs = XLSX.utils.aoa_to_sheet(TEMPLATE_GUIDE)
  gs['!cols'] = [{ wch: 4 }, { wch: 90 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'WBS')
  XLSX.utils.book_append_sheet(wb, hs, 'Holiday')
  XLSX.utils.book_append_sheet(wb, gs, '작성법')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
