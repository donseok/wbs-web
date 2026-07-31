/** 양식 자동 감지(§6.3) — 임의의 엑셀 워크북을 열어 ExcelProfile 을 최선 추정한다.
 *  규칙은 전부 순수 함수로 분리한다(detectWorkbook 은 조립만). 감지 실패는 침묵 폴백이 아니라
 *  질문거리다 — 확신이 없으면 warnings 에 남기고 confidence 를 낮춘다(빈 매핑은 null). */

import * as XLSX from 'xlsx'
import type { ExcelProfile } from '@/lib/excel/profile'

export interface DetectionResult {
  sheetNames: string[]
  profile: ExcelProfile          // 최선 추정(사람이 2단계에서 수정)
  confidence: { header: number; hierarchy: number; logical: number }  // 0~1
  preview: { headers: string[]; rows: unknown[][] }   // 헤더행 라벨 + 데이터 10행 원본
  warnings: string[]             // '가중치 열을 찾지 못했습니다' 등 — 빈 매핑은 null 로 두고 경고
}

/** 헤더 별칭 사전 — 완전일치(trim, 대소문자 무시) 우선, 부분일치 차선(규칙 5). */
export const LOGICAL_ALIASES: Record<keyof ExcelProfile['logical'], readonly string[]> = {
  extraAxis: ['Biz', 'Biz.', '업무영역', '사업영역'],
  code: ['코드', 'Code', 'No', 'No.', '번호'],
  deliverable: ['산출물', '산출물명', 'Deliverable', '결과물'],
  start: ['시작', '시작일', 'Start', 'Start Date', '착수일'],
  end: ['종료', '종료일', 'End', 'End Date', '완료일'],
  weight: ['가중치', 'Weight', '비중'],
  actualPct: ['실적%', '실적', 'Actual', 'Actual%', '진척률', '진척율'],
  // outline 계층 전용(규칙 5 물). columns 계층은 계층 열 자체가 이름의 출처라 이 별칭을 쓰지 않는다
  // (detectWorkbook 조립부가 hierarchy.kind==='columns' 면 무조건 null 로 강제한다) — 맨 뒤에 둬서
  // 기존 6개 필드의 열 선점 우선순위를 건드리지 않는다(리뷰 픽스: outline+1 무검증 관례 대체).
  name: ['이름', '업무명', '작업명', '제목', '내용', 'Name', 'Title'],
}

/** 담당 마크 방식(규칙 6)의 기본 마크 사전. */
export const DEFAULT_OWNER_MARKS: Record<string, 'primary' | 'support'> = {
  '●': 'primary', '△': 'support', '◎': 'primary', 'O': 'primary', 'o': 'primary',
}

/** '담당' 열에 팀명을 직접 적는 방식(규칙 6 대안)을 인식하기 위한 헤더 별칭. LOGICAL_ALIASES 밖 —
 *  팀은 ExcelProfile.logical 의 필드가 아니라 teamColumns 다. */
const TEAM_HEADER_ALIASES = ['담당', '담당팀', '담당자', 'Owner', 'Team', '팀']

const OUTLINE_RE = /^\d+([.\-]\d+)*$/

const FIELD_LABELS: Record<keyof ExcelProfile['logical'], string> = {
  extraAxis: '업무영역', code: '코드', deliverable: '산출물', start: '시작일',
  end: '종료일', weight: '가중치', actualPct: '실적%', name: '이름',
}

const ALL_ALIASES: string[] = Object.values(LOGICAL_ALIASES).flat().map(a => a.trim().toLowerCase())

function isBlankCell(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}
function isTextCell(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== ''
}
function cellText(v: unknown): string {
  return String(v ?? '').trim()
}

/* ── 규칙 1: 시트 선택 — 'WBS' 우선, 없으면 첫 시트. Holiday 는 이름 일치 시만. 시트 0개 → null. ── */
export function pickSheets(sheetNames: string[]): { workSheetName: string; holidaySheetName: string | null } | null {
  if (sheetNames.length === 0) return null
  const workSheetName = sheetNames.includes('WBS') ? 'WBS' : sheetNames[0]
  const holidaySheetName = sheetNames.includes('Holiday') ? 'Holiday' : null
  return { workSheetName, holidaySheetName }
}

/* ── 규칙 2: 헤더 행 — 상위 10행을 별칭 사전 히트 수로 스코어링. 동점·0점이면 tie=true. ── */
export function detectHeaderRow(aoa: unknown[][], maxScan = 10): { row: number; score: number; tie: boolean } {
  const n = Math.min(maxScan, aoa.length)
  if (n === 0) return { row: 0, score: 0, tie: false }
  const scores: number[] = []
  for (let r = 0; r < n; r++) {
    const row = aoa[r] ?? []
    let score = 0
    for (const cell of row) {
      const s = cellText(cell).toLowerCase()
      if (s && ALL_ALIASES.includes(s)) score++
    }
    scores.push(score)
  }
  const max = Math.max(...scores)
  const winners = scores.reduce<number[]>((acc, s, i) => (s === max ? [...acc, i] : acc), [])
  return { row: winners[0], score: max, tie: winners.length > 1 || max === 0 }
}

/* ── 규칙 3: 열=계층 — 텍스트 열의 연속 구간 중 "행마다 비공백 정확히 1개" 비율 90%+ 인 최장 구간.
 *  후보 없으면 null(호출부가 아웃라인으로 넘어간다). 길이 1 구간은 "항상 채워진 단일 필드"(예: 산출물)와
 *  구별할 수 없으므로 제외한다 — 계층은 최소 2열 이상이어야 의미가 있다. ── */
export function detectColumnHierarchy(dataRows: unknown[][]): { columns: number[]; ratio: number } | null {
  if (dataRows.length === 0) return null
  const maxCol = dataRows.reduce((m, r) => Math.max(m, r.length), 0)
  const isTextColumn: boolean[] = []
  for (let c = 0; c < maxCol; c++) isTextColumn[c] = dataRows.some(r => isTextCell(r[c]))

  const runs: [number, number][] = []
  let runStart: number | null = null
  for (let c = 0; c <= maxCol; c++) {
    const t = c < maxCol && isTextColumn[c]
    if (t && runStart === null) runStart = c
    if (!t && runStart !== null) { runs.push([runStart, c - 1]); runStart = null }
  }

  let best: { columns: number[]; ratio: number } | null = null
  for (const [s, e] of runs) {
    for (let len = e - s + 1; len >= 2; len--) {
      for (let start = s; start + len - 1 <= e; start++) {
        const cols = Array.from({ length: len }, (_, i) => start + i)
        const ratio = exactlyOneRatio(dataRows, cols)
        if (ratio >= 0.9 && (!best || len > best.columns.length || (len === best.columns.length && start < best.columns[0]))) {
          best = { columns: cols, ratio }
        }
      }
    }
  }
  return best
}

function exactlyOneRatio(dataRows: unknown[][], cols: number[]): number {
  if (dataRows.length === 0) return 0
  let hit = 0
  for (const r of dataRows) {
    const filled = cols.filter(c => !isBlankCell(r[c])).length
    if (filled === 1) hit++
  }
  return hit / dataRows.length
}

/* ── 규칙 4: 아웃라인 — ^\d+([.\-]\d+)*$ 매치 비율 80%+ 인 첫 열(왼쪽부터). ── */
export function detectOutlineHierarchy(dataRows: unknown[][]): { column: number; ratio: number } | null {
  if (dataRows.length === 0) return null
  const maxCol = dataRows.reduce((m, r) => Math.max(m, r.length), 0)
  for (let c = 0; c < maxCol; c++) {
    let hit = 0
    for (const r of dataRows) if (OUTLINE_RE.test(cellText(r[c]))) hit++
    const ratio = hit / dataRows.length
    if (ratio >= 0.8) return { column: c, ratio }
  }
  return null
}

function leftmostTextColumn(headerLabels: string[]): number {
  for (let c = 0; c < headerLabels.length; c++) if (headerLabels[c] !== '') return c
  return 0
}

/** 부분일치 단계 최소 별칭 길이. 길이 2 이하 별칭('No' 등)은 부분일치에 쓰면 'Note'/'Nomination' 류
 *  무관 헤더를 오탐한다(리뷰 발견) — 그런 별칭은 완전일치로만 인정한다. 헤더 셀 쪽도 같은 이유로
 *  이 길이 미만이면 부분일치 후보에서 아예 제외한다(양방향 짧은 문자열 오탐 방지). */
const MIN_PARTIAL_ALIAS_LEN = 3

/* ── 규칙 5: 논리 열 — 완전일치 우선, 부분일치 차선(짧은 별칭은 완전일치만). 미발견 = null + warning.
 *  부분일치로 확정된 열은 별도 warning("...(으)로 추정했습니다")을 남긴다 — 사람 확인 없이 확정 취급하지
 *  않는다. hierarchy 가 이미 점유한 열은 후보에서 제외한다(충돌 방지). 같은 열이 두 필드에 중복 배정되지
 *  않도록 배정된 열은 즉시 claim 한다. ── */
export function detectLogicalColumns(
  headerLabels: string[],
  excluded: ReadonlySet<number> = new Set(),
): { logical: ExcelProfile['logical']; warnings: string[]; partialMatchCount: number } {
  const lower = headerLabels.map(v => v.toLowerCase())
  const warnings: string[] = []
  const claimed = new Set<number>(excluded)
  const fields = Object.keys(LOGICAL_ALIASES) as (keyof ExcelProfile['logical'])[]
  const logical = {} as ExcelProfile['logical']
  let partialMatchCount = 0

  for (const field of fields) {
    const aliases = LOGICAL_ALIASES[field].map(a => a.trim().toLowerCase())
    let found = -1
    for (let c = 0; c < lower.length; c++) {
      if (claimed.has(c) || !lower[c]) continue
      if (aliases.includes(lower[c])) { found = c; break }
    }
    let isPartial = false
    if (found < 0) {
      const partialAliases = aliases.filter(a => a.length >= MIN_PARTIAL_ALIAS_LEN)
      for (let c = 0; c < lower.length; c++) {
        if (claimed.has(c) || lower[c].length < MIN_PARTIAL_ALIAS_LEN) continue
        if (partialAliases.some(a => lower[c].includes(a) || a.includes(lower[c]))) { found = c; isPartial = true; break }
      }
    }
    if (found >= 0) {
      logical[field] = found
      claimed.add(found)
      if (isPartial) {
        partialMatchCount++
        warnings.push(`'${headerLabels[found]}' 열을 ${FIELD_LABELS[field]}(으)로 추정했습니다 — 2단계에서 확인하세요`)
      }
    } else {
      logical[field] = null
      warnings.push(`${FIELD_LABELS[field]} 열을 찾지 못했습니다`)
    }
  }
  return { logical, warnings, partialMatchCount }
}

/* ── 규칙 6: 팀 열 — 마크 방식(계층·논리 열 제외 후, 데이터 셀이 DEFAULT_OWNER_MARKS 키 또는 공백뿐인
 *  열) 우선. 없으면 '담당' 계열 헤더 열 하나에 팀명이 직접 든 방식(teamColumns=[[열,'*']]).
 *  둘 다 없으면 빈 배열 + warning. 마크 방식은 실제 마크가 최소 1개 있어야 인정한다(완전히 빈 스페이서
 *  열이 팀 열로 오인되는 것을 막기 위함 — 헤더 라벨도 비어 있으면 후보에서 제외). ── */
export function detectTeamColumns(
  headerLabels: string[],
  dataRows: unknown[][],
  excluded: ReadonlySet<number> = new Set(),
): { teamColumns: [number, string][]; warnings: string[] } {
  const maxCol = Math.max(headerLabels.length, dataRows.reduce((m, r) => Math.max(m, r.length), 0))
  const markCols: [number, string][] = []
  for (let c = 0; c < maxCol; c++) {
    if (excluded.has(c)) continue
    const label = headerLabels[c] ?? ''
    if (!label) continue
    let sawMark = false
    let allMarkOrBlank = true
    for (const r of dataRows) {
      const v = cellText(r[c])
      if (v === '') continue
      if (Object.prototype.hasOwnProperty.call(DEFAULT_OWNER_MARKS, v)) sawMark = true
      else { allMarkOrBlank = false; break }
    }
    if (sawMark && allMarkOrBlank) markCols.push([c, label])
  }
  if (markCols.length > 0) return { teamColumns: markCols, warnings: [] }

  for (let c = 0; c < headerLabels.length; c++) {
    if (excluded.has(c)) continue
    const lower = headerLabels[c].toLowerCase()
    if (lower && TEAM_HEADER_ALIASES.some(a => a.toLowerCase() === lower)) {
      return { teamColumns: [[c, '*']], warnings: ['담당 열의 팀명을 직접 사용'] }
    }
  }
  return { teamColumns: [], warnings: ['팀 열을 찾지 못했습니다'] }
}

/* ── 조립 ── */
export function detectWorkbook(buf: ArrayBuffer): { ok: true; result: DetectionResult } | { ok: false; error: string } {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { type: 'array', cellDates: false })
  } catch {
    return { ok: false, error: '워크북을 읽을 수 없습니다' }
  }

  const sheets = pickSheets(wb.SheetNames)
  if (!sheets) return { ok: false, error: '시트가 없습니다' }
  const { workSheetName, holidaySheetName } = sheets

  const ws = wb.Sheets[workSheetName]
  const aoa = ws ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false }) : []

  const warnings: string[] = []

  // 규칙 2
  const headerRes = detectHeaderRow(aoa)
  const headerUnclear = headerRes.tie || headerRes.score === 0
  const headerRow = headerUnclear ? 0 : headerRes.row
  if (headerUnclear) warnings.push('헤더 행을 확실히 찾지 못했습니다 — 0행으로 가정합니다')
  const confidenceHeader = headerUnclear ? 0.15 : Math.min(1, headerRes.score / 4)

  const headerLabels = ((aoa[headerRow] ?? []) as unknown[]).map(cellText)
  const dataRows = aoa.slice(headerRow + 1)

  // 규칙 3 → 4
  let hierarchy: ExcelProfile['hierarchy']
  let confidenceHierarchy: number
  const colCandidate = detectColumnHierarchy(dataRows)
  if (colCandidate) {
    hierarchy = { kind: 'columns', columns: colCandidate.columns }
    confidenceHierarchy = colCandidate.ratio
  } else {
    const outlineCandidate = detectOutlineHierarchy(dataRows)
    if (outlineCandidate) {
      hierarchy = { kind: 'outline', column: outlineCandidate.column }
      confidenceHierarchy = outlineCandidate.ratio
    } else {
      hierarchy = { kind: 'columns', columns: [leftmostTextColumn(headerLabels)] }
      confidenceHierarchy = 0
      warnings.push('계층 열을 확정하지 못했습니다 — 첫 텍스트 열로 가정합니다')
    }
  }
  const hierarchyColumns = new Set<number>(hierarchy.kind === 'columns' ? hierarchy.columns : [hierarchy.column])
  // outline 열은 코드 열과 동일 물리 열인 경우가 흔하다(Task 4 §6.4 — "코드 열 값이 code 후보").
  // columns 계층(Phase/Task/Activity 류)만 논리 열 후보에서 제외한다.
  const logicalExcluded = hierarchy.kind === 'columns' ? hierarchyColumns : new Set<number>()

  // 규칙 5
  const logicalRes = detectLogicalColumns(headerLabels, logicalExcluded)
  warnings.push(...logicalRes.warnings)

  // name 열은 outline 계층에서만 유효하다(columns 계층은 계층 열 자체가 이름의 출처 — 리뷰 픽스).
  // outline 인데 별칭으로 못 찾았으면 '코드 열 바로 다음 열' 관례로 폴백하되, 이건 확정이 아니라
  // 추정이므로 부분일치와 동일하게 confidence 를 깎고 warning 을 남긴다(무검증 침묵 관례였던 것을
  // 명시 열로 승격 + 실패 시에도 최소한 사람이 보게 만든다).
  let nameCol = logicalRes.logical.name
  let namePartial = 0
  if (hierarchy.kind === 'columns') {
    nameCol = null
  } else if (nameCol === null) {
    nameCol = hierarchy.column + 1
    namePartial = 1
    warnings.push("'이름' 열을 찾지 못해 코드 열 다음 열로 추정했습니다 — 2단계에서 확인하세요")
  }
  const logical: ExcelProfile['logical'] = { ...logicalRes.logical, name: nameCol }
  const partialMatchCount = logicalRes.partialMatchCount + namePartial

  const matchedLogical = Object.values(logical).filter(v => v !== null).length
  const exactMatchedLogical = matchedLogical - partialMatchCount
  // 부분일치는 완전일치의 절반 가중치만 인정 — 추정임을 confidence 에도 반영한다.
  const confidenceLogical =
    (exactMatchedLogical + partialMatchCount * 0.5) / Object.keys(LOGICAL_ALIASES).length

  // 규칙 6
  const logicalColumns = new Set<number>(
    Object.values(logical).filter((v): v is number => v !== null),
  )
  const excludedForTeams = new Set<number>([...hierarchyColumns, ...logicalColumns])
  const teamRes = detectTeamColumns(headerLabels, dataRows, excludedForTeams)
  warnings.push(...teamRes.warnings)

  const profile: ExcelProfile = {
    version: 1,
    sheetName: workSheetName,
    holidaySheetName,
    headerRow,
    hierarchy,
    logical,
    teamColumns: teamRes.teamColumns,
    ownerMarks: { ...DEFAULT_OWNER_MARKS },
  }

  // 규칙 7
  const result: DetectionResult = {
    sheetNames: wb.SheetNames,
    profile,
    confidence: { header: confidenceHeader, hierarchy: confidenceHierarchy, logical: confidenceLogical },
    preview: { headers: headerLabels, rows: dataRows.slice(0, 10) },
    warnings,
  }
  return { ok: true, result }
}
