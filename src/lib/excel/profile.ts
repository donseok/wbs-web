/** ExcelProfile — 엑셀 양식의 물화된 지식(§6).
 *  라운드트립(임포트 → 내부 활용 → 내보내기)의 단일 진실. */

export interface ExcelProfile {
  version: 1
  sheetName: string
  holidaySheetName: string | null
  /** 0-based 헤더 행 인덱스. 데이터는 headerRow+1 부터. */
  headerRow: number
  hierarchy:
    | { kind: 'columns'; columns: number[] }   // 열=계층: 왼쪽=얕음. 한 행에 정확히 하나 채워짐
    | { kind: 'outline'; column: number }      // 아웃라인 코드(1.2.3) 열. 깊이=구분자 수+1
  logical: {
    extraAxis: number | null; code: number | null
    /** 이름 열 — outline 계층에서만 쓰인다(columns 계층은 계층 열 자체가 이름의 출처라 항상 null,
     *  리뷰 픽스: outline+1 관례가 무검증 침묵 오독 경로였다 — '코드,비고,이름' 형 파일에서 '비고'를
     *  이름으로 잘못 읽는 사고를 막기 위해 명시 열로 승격했다). 이 필드 도입 이전에 저장된 프로파일은
     *  키 자체가 없을 수 있다 — validateProfile 이 그 경우를 null 로 정규화해 반환한다(전방호환). */
    name: number | null
    deliverable: number | null
    start: number | null; end: number | null; weight: number | null; actualPct: number | null
  }
  teamColumns: [number, string][]
  ownerMarks: Record<string, 'primary' | 'support'>
}

export function validateProfile(p: unknown): { ok: true; profile: ExcelProfile } | { ok: false; error: string } {
  // version 확인
  if (!isObject(p) || p.version !== 1) {
    return { ok: false, error: 'version must be 1' }
  }

  // sheetName 확인
  if (typeof p.sheetName !== 'string' || p.sheetName.trim() === '') {
    return { ok: false, error: 'sheetName must be a non-empty string' }
  }

  // holidaySheetName 확인 (null or non-empty string)
  if (p.holidaySheetName !== null && (typeof p.holidaySheetName !== 'string' || p.holidaySheetName.trim() === '')) {
    return { ok: false, error: 'holidaySheetName must be null or non-empty string' }
  }

  // headerRow 확인
  if (!Number.isInteger(p.headerRow) || (p.headerRow as number) < 0) {
    return { ok: false, error: 'headerRow must be an integer >= 0' }
  }

  // hierarchy 확인
  if (!isObject(p.hierarchy)) {
    return { ok: false, error: 'hierarchy must be an object' }
  }

  if (p.hierarchy.kind === 'columns') {
    if (!Array.isArray(p.hierarchy.columns)) {
      return { ok: false, error: 'hierarchy.columns must be an array' }
    }
    if (p.hierarchy.columns.length === 0) {
      return { ok: false, error: 'hierarchy.columns must not be empty' }
    }
    // 모든 요소가 정수인지 확인
    if (!p.hierarchy.columns.every((c: unknown) => Number.isInteger(c))) {
      return { ok: false, error: 'hierarchy.columns must contain only integers' }
    }
    // 중복 없는지 확인
    const seen = new Set<number>()
    for (const c of p.hierarchy.columns as number[]) {
      if (seen.has(c)) {
        return { ok: false, error: 'hierarchy.columns must not have duplicates' }
      }
      seen.add(c)
    }
    // 오름차순 정렬되어 있는지 확인
    const cols = p.hierarchy.columns as number[]
    for (let i = 1; i < cols.length; i++) {
      if (cols[i] <= cols[i - 1]) {
        return { ok: false, error: 'hierarchy.columns must be sorted in ascending order' }
      }
    }
  } else if (p.hierarchy.kind === 'outline') {
    if (!Number.isInteger(p.hierarchy.column) || (p.hierarchy.column as number) < 0) {
      return { ok: false, error: 'hierarchy.column must be an integer >= 0' }
    }
  } else {
    return { ok: false, error: 'hierarchy.kind must be "columns" or "outline"' }
  }

  // logical 확인
  if (!isObject(p.logical)) {
    return { ok: false, error: 'logical must be an object' }
  }

  const logicalFields = ['extraAxis', 'code', 'name', 'deliverable', 'start', 'end', 'weight', 'actualPct']
  for (const field of logicalFields) {
    const value = (p.logical as Record<string, unknown>)[field]
    // name 은 이 필드가 생기기 전에 저장된 프로파일엔 키 자체가 없을 수 있다 — 부재(undefined)를
    // null 과 동등하게 수용한다(전방호환). 다른 필드는 처음부터 필수였으므로 그대로 엄격 검증.
    if (field === 'name' && value === undefined) continue
    if (value !== null && (!Number.isInteger(value) || (value as number) < 0)) {
      return { ok: false, error: `logical.${field} must be null or integer >= 0` }
    }
  }

  // teamColumns 확인
  if (!Array.isArray(p.teamColumns)) {
    return { ok: false, error: 'teamColumns must be an array' }
  }
  for (const tc of p.teamColumns as unknown[]) {
    if (!Array.isArray(tc) || tc.length !== 2) {
      return { ok: false, error: 'teamColumns must contain [number, string] tuples' }
    }
    if (!Number.isInteger(tc[0])) {
      return { ok: false, error: 'teamColumns column indices must be integers' }
    }
    if (typeof tc[1] !== 'string' || tc[1].trim() === '') {
      return { ok: false, error: 'teamColumns team names must be non-empty strings' }
    }
  }

  // ownerMarks 확인
  if (!isObject(p.ownerMarks)) {
    return { ok: false, error: 'ownerMarks must be an object' }
  }
  for (const [key, value] of Object.entries(p.ownerMarks as Record<string, unknown>)) {
    if (key.trim() === '') {
      return { ok: false, error: 'ownerMarks keys must be non-empty strings' }
    }
    if (value !== 'primary' && value !== 'support') {
      return { ok: false, error: 'ownerMarks values must be "primary" or "support"' }
    }
  }

  // name 키가 부재(undefined)였다면 여기서 null 로 정규화한다 — 이후 모든 소비자(parseWithProfile 등)는
  // profile.logical.name 이 항상 number|null 이라고 믿을 수 있어야 한다(undefined 를 흘려보내지 않는다).
  const normalizedLogical = { ...(p.logical as ExcelProfile['logical']), name: (p.logical as Record<string, unknown>).name ?? null }
  return {
    ok: true,
    profile: { ...(p as unknown as ExcelProfile), logical: normalizedLogical as ExcelProfile['logical'] },
  }
}

/** D-CUBE 현행 3행 헤더 규약(5팀) — §7.5 백필값이자 라운드트립 계약 테스트의 기준. */
export const LEGACY_DCUBE_PROFILE: ExcelProfile = {
  version: 1,
  sheetName: 'WBS',
  holidaySheetName: 'Holiday',
  headerRow: 2,
  hierarchy: { kind: 'columns', columns: [1, 2, 3] },
  // name: null — columns 계층(Phase/Task/Activity)은 계층 열 자체가 이름의 출처라 별도 이름 열이 없다.
  logical: { extraAxis: 0, code: null, name: null, deliverable: 11, start: 12, end: 13, weight: 14, actualPct: 16 },
  teamColumns: [[6, 'PMO'], [7, 'ERP'], [8, 'MES'], [9, '가공'], [10, 'MDM']],
  ownerMarks: { '●': 'primary', '△': 'support' },
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
