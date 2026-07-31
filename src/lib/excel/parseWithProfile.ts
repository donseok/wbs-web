/** 프로파일 주입형 N단 파서 + 링커(Plan B §6.4, Task 4).
 *  `ExcelProfile` 을 받아 임의 양식을 파싱한다. 레거시 D-CUBE 프로파일(`LEGACY_DCUBE_PROFILE`)을
 *  주입하면 기존 `parseWbsWorkbook`+`validateAndLink` 와 동등한 결과를 낸다(라운드트립 계약,
 *  tests/excel/parse-with-profile.test.ts 케이스 (a)). 구 경로(`parse.ts`/`validate.ts` 의 기존
 *  export)는 무접촉 — Plan C 에서 통합할 때까지 두 경로가 병행한다. */

import * as XLSX from 'xlsx'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { ImportItem, ImportError } from '@/lib/excel/validate'

export interface ParsedRowN {
  depth: number                 // 0-based
  code: string | null           // 코드 열 값(§6.4). 없으면 null → 링커가 채번
  name: string
  extraAxis: string | null
  deliverable: string | null
  plannedStart: string | null; plannedEnd: string | null
  weight: number | null; actualPct: number | null
  owners: { team: string; kind: 'primary' | 'support' }[]
  excelRow: number
}

/** parse.ts 와 동일, 구 경로 제거(Plan C) 때 통합.
 *  엑셀 날짜는 시리얼(정수)로 저장됨. SSF.parse_date_code 로 타임존 무관하게 {y,m,d} 도출
 *  (cellDates 로컬 변환에 의존하면 Asia/Seoul 1899 LMT 오프셋 때문에 -1일 밀린다). */
function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.y}-${p(d.m)}-${p(d.d)}`
  }
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())).toISOString().slice(0, 10)
  }
  return null
}
/** parse.ts 와 동일, 구 경로 제거(Plan C) 때 통합. */
function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)
  return Number.isFinite(n) ? n : null
}

function cellStr(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}
function isBlankCell(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

/** 아웃라인 코드 패턴 — detect.ts 의 OUTLINE_RE 와 동일(export 되어 있지 않아 복제). */
const OUTLINE_RE = /^\d+([.\-]\d+)*$/

/** teamColumns 해석 — 마크 방식(ownerMarks 사전 조회)과 팀명 직접 방식([[c,'*']], 콤마 분리,
 *  첫 팀 primary·나머지 support)을 모두 지원한다(§6.3 규칙 6 / Task4 구현 규칙). */
function parseOwners(row: unknown[], profile: ExcelProfile): ParsedRowN['owners'] {
  const out: ParsedRowN['owners'] = []
  for (const [col, label] of profile.teamColumns) {
    const raw = String(row[col] ?? '').trim()
    if (raw === '') continue
    if (label === '*') {
      const teams = raw.split(',').map(s => s.trim()).filter(Boolean)
      teams.forEach((team, i) => out.push({ team, kind: i === 0 ? 'primary' : 'support' }))
    } else {
      const kind = profile.ownerMarks[raw]
      if (kind) out.push({ team: label, kind })
    }
  }
  return out
}

export function parseWithProfile(
  buf: ArrayBuffer,
  profile: ExcelProfile,
): { ok: true; rows: ParsedRowN[]; holidays: { date: string; name: string }[] } | { ok: false; error: string } {
  let wb: XLSX.WorkBook
  try {
    // cellDates:false — 날짜를 시리얼(정수)로 유지해 toIso 에서 타임존 무관 변환(위 참조).
    wb = XLSX.read(buf, { type: 'array', cellDates: false })
  } catch {
    return { ok: false, error: '워크북을 읽을 수 없습니다' }
  }

  const ws = wb.Sheets[profile.sheetName]
  // 시트명이 프로파일과 다르면 명시 에러(§6.1 — 구 파서의 '조용한 count:0' 문제를 여기서 되풀이하지 않는다).
  if (!ws) return { ok: false, error: `시트를 찾을 수 없습니다: ${profile.sheetName}` }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })

  const rows: ParsedRowN[] = []
  const dataStart = profile.headerRow + 1
  for (let i = dataStart; i < aoa.length; i++) {
    const r = (aoa[i] ?? []) as unknown[]
    const excelRow = i + 1

    let depth: number
    let name: string
    // outline 모드에서만 쓰인다 — 코드 열이 별도 지정되지 않았을 때 이 값을 code 후보로 쓴다.
    let outlineCode: string | null = null

    if (profile.hierarchy.kind === 'columns') {
      const cols = profile.hierarchy.columns
      const filledIdx: number[] = []
      cols.forEach((c, idx) => { if (!isBlankCell(r[c])) filledIdx.push(idx) })
      if (filledIdx.length === 0) continue // 계층 열이 전부 빈 행 — 데이터 없음(구 파서의 '레벨 미판정 스킵'과 동일)
      if (filledIdx.length >= 2) {
        // 2개 이상 채워짐 = 구조 오류. 단일 문자열 에러라 전체 파싱을 중단한다(행 번호는 메시지에 포함).
        return { ok: false, error: `${excelRow}행: 계층 열에 값이 2개 이상 채워짐(깊이를 판정할 수 없음)` }
      }
      depth = filledIdx[0]
      name = String(r[cols[depth]] ?? '').trim()
    } else {
      const raw = String(r[profile.hierarchy.column] ?? '').trim()
      if (raw === '') continue // 아웃라인 코드 없음 — 데이터 없는 행
      if (!OUTLINE_RE.test(raw)) {
        return { ok: false, error: `${excelRow}행: 아웃라인 코드 형식이 아님 — "${raw}"` }
      }
      // 깊이 = 구분자 수(0-based). '1' → 0, '1.1' → 1, '1.1.1.1' → 3.
      depth = (raw.match(/[.\-]/g) ?? []).length
      outlineCode = raw
      // 리뷰 픽스: profile.logical.name 이 정본이다 — 명시 지정이 있으면 그 열을 쓴다.
      // '코드 열 바로 오른쪽 열' 관례는 detect.ts 가 별칭으로도 못 찾았을 때만 쓰는 최후 폴백이었고,
      // 그 폴백값이 여기까지 profile.logical.name 에 실려 온다(detectWorkbook 이 이미 채워 둔다).
      // 이 함수 자체가 폴백을 다시 계산하는 건 프로파일이 아예 수동으로 만들어져 name 이 비어 있는
      // 극단적 경우에 대한 방어일 뿐 — 정상 경로는 항상 profile.logical.name 을 그대로 신뢰한다.
      const nameCol = profile.logical.name ?? (profile.hierarchy.column + 1)
      name = String(r[nameCol] ?? '').trim()
    }

    let code: string | null = null
    if (profile.logical.code !== null) {
      code = cellStr(r[profile.logical.code])
    } else if (outlineCode !== null) {
      code = outlineCode
    }

    rows.push({
      depth,
      code,
      name,
      extraAxis: profile.logical.extraAxis !== null ? cellStr(r[profile.logical.extraAxis]) : null,
      deliverable: profile.logical.deliverable !== null ? cellStr(r[profile.logical.deliverable]) : null,
      plannedStart: profile.logical.start !== null ? toIso(r[profile.logical.start]) : null,
      plannedEnd: profile.logical.end !== null ? toIso(r[profile.logical.end]) : null,
      weight: profile.logical.weight !== null ? toNum(r[profile.logical.weight]) : null,
      actualPct: profile.logical.actualPct !== null ? toNum(r[profile.logical.actualPct]) : null,
      owners: parseOwners(r, profile),
      excelRow,
    })
  }

  const holidays: { date: string; name: string }[] = []
  if (profile.holidaySheetName) {
    const hs = wb.Sheets[profile.holidaySheetName]
    if (hs) {
      const haoa = XLSX.utils.sheet_to_json<unknown[]>(hs, { header: 1, blankrows: false })
      for (const r of haoa) {
        const iso = toIso(r[0])
        if (iso) holidays.push({ date: iso, name: String(r[1] ?? '').trim() })
      }
    }
  }

  return { ok: true, rows, holidays }
}

/** hierarchy 가 columns 이고 정확히 3열이면 레거시(phase/task/activity) 라벨을 쓴다(레거시 호환).
 *  linkByDepth 는 rows 만 받는 함수라(Task4 인터페이스) profile 을 모른다 — 이 판정은 profile 을
 *  아는 호출부(라운드트립 테스트·향후 Task6 실행 라우트)가 미리 계산해 opts 로 넘긴다. */
export function resolveLegacyLevelLabels(profile: ExcelProfile): boolean {
  return profile.hierarchy.kind === 'columns' && profile.hierarchy.columns.length === 3
}

const LEGACY_LEVELS = ['phase', 'task', 'activity'] as const

/** N단 스택 링킹 + 코드 채번(코드 열 값 있으면 그대로, 없으면 형제 순번 경로 '1'·'1.1'·'1.1.2')
 *  → ImportItem[](validate.ts 의 기존 타입 재사용). `lastAtDepth[d]` 배열은 validate.ts 의
 *  `lastPhase`/`lastTask` 2단 스택을 N단으로 일반화한 것이다(설계 §4.4). */
export function linkByDepth(
  rows: ParsedRowN[],
  opts?: { legacyLevelLabels?: boolean },
): { ok: true; items: ImportItem[] } | { ok: false; errors: ImportError[] } {
  const legacyLevelLabels = opts?.legacyLevelLabels ?? false
  const errors: ImportError[] = []
  const items: ImportItem[] = []
  const lastAtDepth: (string | null)[] = []   // depth d 에서 가장 최근에 링크된 항목의 tempId
  const siblingCount: number[] = []           // depth d 에서의 1-based 형제 순번(채번용)
  let prevDepth = -1                          // 직전에 성공적으로 처리된 행의 깊이(첫 행은 0 이어야 함)
  let order = 0

  rows.forEach((r, i) => {
    const { plannedStart: s, plannedEnd: e, depth: d } = r
    if ((s && !e) || (!s && e)) errors.push({ excelRow: r.excelRow, message: '시작/종료일 중 하나만 입력됨' })
    if (s && e && s > e) errors.push({ excelRow: r.excelRow, message: '시작일이 종료일보다 늦음' })

    // depth 가 스택보다 2단 이상 점프하면 부모를 특정할 수 없다(중간 깊이 행 누락).
    if (d > prevDepth + 1) {
      errors.push({ excelRow: r.excelRow, message: `깊이 건너뜀(${prevDepth}단 → ${d}단)` })
    }

    const tempId = `t${i}`
    const parentTempId = d === 0 ? null : (lastAtDepth[d - 1] ?? null)

    // 형제 순번 경로 채번: 이 depth 의 카운터를 올리고, 더 깊은 카운터는 새 서브트리 시작이므로 버린다.
    siblingCount[d] = (siblingCount[d] ?? 0) + 1
    siblingCount.length = d + 1
    const autoCode = Array.from({ length: d + 1 }, (_, idx) => siblingCount[idx] ?? 1).join('.')

    let code = r.code
    if (code !== null) {
      if (code.length > 60) errors.push({ excelRow: r.excelRow, message: `코드 길이가 60자를 초과함: "${code}"` })
    } else {
      code = autoCode
    }

    const level = legacyLevelLabels ? (LEGACY_LEVELS[d] ?? 'activity') : 'activity'

    items.push({
      tempId, parentTempId, level,
      code, sortOrder: order++, name: r.name, biz: r.extraAxis, deliverable: r.deliverable,
      plannedStart: s, plannedEnd: e, weight: r.weight, actualPct: r.actualPct,
      owners: r.owners, isOwnerSplit: false,
    })

    lastAtDepth[d] = tempId
    prevDepth = d
  })

  if (errors.length) return { ok: false, errors }
  return { ok: true, items }
}
