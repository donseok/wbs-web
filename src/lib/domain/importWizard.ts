/** 임포트 마법사(B8) 상태 전이 — 순수 함수만 둔다. `ImportWizard` 컴포넌트가 그대로 소비한다.
 *  네트워크 호출(inspect/execute)·파일 보관(File 객체)은 컴포넌트 쪽 책임 — 여기는 상태 계산만. */

import type { ExcelProfile } from '@/lib/excel/profile'
import type { DetectionResult } from '@/lib/excel/detect'
import type { ImportError } from '@/lib/excel/validate'

export type ImportMode = 'append' | 'replace'

/** `/api/import/execute` 200 응답 바디(§B6) — ok 는 판별에만 쓰고 이 타입엔 담지 않는다. */
export interface ExecuteResult {
  count: number
  mode: ImportMode
  reindexed: number
  backup?: { rows: unknown[]; generatedAt: string }
  profileSaved: boolean
  warnings?: string[]
}

export type WizardStep = 'select' | 'review' | 'done'

export interface WizardState {
  step: WizardStep
  fileName: string | null
  detection: DetectionResult | null
  profile: ExcelProfile | null
  mode: ImportMode
  saveProfile: boolean
  busy: boolean
  error: string | null
  errors: ImportError[] | null
  needsTeams: string[] | null
  result: ExecuteResult | null
}

export const initialWizardState: WizardState = {
  step: 'select',
  fileName: null,
  detection: null,
  profile: null,
  mode: 'append',
  saveProfile: true,
  busy: false,
  error: null,
  errors: null,
  needsTeams: null,
  result: null,
}

export type WizardAction =
  | { type: 'fileSelected'; fileName: string }
  | { type: 'inspectStart' }
  | { type: 'inspectSuccess'; detection: DetectionResult; savedProfile: ExcelProfile | null }
  | { type: 'inspectFailure'; error: string }
  | { type: 'profileChanged'; profile: ExcelProfile }
  | { type: 'modeChanged'; mode: ImportMode }
  | { type: 'saveProfileChanged'; saveProfile: boolean }
  | { type: 'executeStart' }
  | { type: 'executeNeedsTeams'; teams: string[] }
  | { type: 'dismissNeedsTeams' }
  | { type: 'executeFailure'; error: string }
  | { type: 'executeValidationFailure'; errors: ImportError[] }
  | { type: 'executeSuccess'; result: ExecuteResult }
  | { type: 'reset' }

/** 2단계 진입 기본값 계약(§6.2): savedProfile ?? detection.profile. */
export function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'fileSelected':
      // 파일을 바꾸면 이전 감지·편집 결과는 전부 무효 — 처음부터 다시 진행한다.
      return { ...initialWizardState, fileName: action.fileName }
    case 'inspectStart':
      return { ...state, busy: true, error: null }
    case 'inspectSuccess':
      return {
        ...state,
        busy: false,
        step: 'review',
        detection: action.detection,
        profile: action.savedProfile ?? action.detection.profile,
        error: null,
      }
    case 'inspectFailure':
      return { ...state, busy: false, error: action.error }
    case 'profileChanged':
      return { ...state, profile: action.profile }
    case 'modeChanged':
      return { ...state, mode: action.mode }
    case 'saveProfileChanged':
      return { ...state, saveProfile: action.saveProfile }
    case 'executeStart':
      return { ...state, busy: true, error: null, errors: null, needsTeams: null }
    case 'executeNeedsTeams':
      return { ...state, busy: false, needsTeams: action.teams }
    case 'dismissNeedsTeams':
      return { ...state, needsTeams: null }
    case 'executeFailure':
      return { ...state, busy: false, error: action.error, needsTeams: null }
    case 'executeValidationFailure':
      return { ...state, busy: false, errors: action.errors, needsTeams: null }
    case 'executeSuccess':
      return { ...state, busy: false, step: 'done', result: action.result, error: null, errors: null, needsTeams: null }
    case 'reset':
      return initialWizardState
    default:
      return state
  }
}

/** 계층 방식 전환 — columns↔outline. 반대편에 없던 필드는 합리적 기본값으로 재구성한다.
 *  columns 로 돌아가면 name 은 다시 null(계층 열 자체가 이름의 출처 — profile.ts 규약). */
export function switchHierarchyKind(profile: ExcelProfile, kind: 'columns' | 'outline'): ExcelProfile {
  if (profile.hierarchy.kind === kind) return profile
  if (kind === 'outline') {
    const column = profile.hierarchy.kind === 'columns' ? profile.hierarchy.columns[0] : 0
    return { ...profile, hierarchy: { kind: 'outline', column } }
  }
  const column = profile.hierarchy.kind === 'outline' ? profile.hierarchy.column : 0
  return { ...profile, hierarchy: { kind: 'columns', columns: [column] }, logical: { ...profile.logical, name: null } }
}

/** 아웃라인 코드 열 편집. columns 모드에서는 무의미하므로 무시(호출부가 outline 일 때만 부른다). */
export function setOutlineColumn(profile: ExcelProfile, column: number): ExcelProfile {
  if (profile.hierarchy.kind !== 'outline') return profile
  return { ...profile, hierarchy: { kind: 'outline', column } }
}

/** 논리 열 편집 — 8개 필드(extraAxis/code/name/deliverable/start/end/weight/actualPct) 공용. */
export function setLogicalColumn(
  profile: ExcelProfile,
  field: keyof ExcelProfile['logical'],
  column: number | null,
): ExcelProfile {
  return { ...profile, logical: { ...profile.logical, [field]: column } }
}

/** 마크 사전 편집 행 — 컴포넌트는 ownerMarks(Record)를 직접 편집하지 않고 이 행 배열을 들고 있는다.
 *  이유: 텍스트 입력 중(키를 한 글자씩 고칠 때) React key 가 객체 키 자체면 매 타이핑마다
 *  리스트 아이템이 통째로 리마운트돼 포커스를 잃는다 — id 는 값과 무관하게 고정. */
export interface MarkRow { id: number; key: string; kind: 'primary' | 'support' }

export function recordToRows(marks: ExcelProfile['ownerMarks']): MarkRow[] {
  return Object.entries(marks).map(([key, kind], i) => ({ id: i, key, kind }))
}

/** 빈 키 행은 버리고, 같은 키가 중복되면 나중 행이 이긴다(Object.fromEntries 관례 — 사전 삭제 UX). */
export function rowsToRecord(rows: MarkRow[]): ExcelProfile['ownerMarks'] {
  return Object.fromEntries(
    rows.map((r): [string, 'primary' | 'support'] => [r.key.trim(), r.kind]).filter(([key]) => key !== ''),
  )
}

/* ── 미리보기 표 파생(리뷰 Important #2) — replace 는 되돌릴 수 없어 이 표가 실행 전 유일한
 *  검증면이다: 계층 방식·논리 열 편집이 표에 즉시 반영돼야 한다. 아래는 로케일 무관 구조만 만들고
 *  라벨 문구는 컴포넌트가 role 을 보고 t() 로 붙인다(도메인 모듈은 i18n 을 모른다 — 기존 관례). ── */

export type PreviewColumnRole =
  | { kind: 'hierarchy' }
  | { kind: 'logical'; field: keyof ExcelProfile['logical'] }
  | { kind: 'team'; team: string }
  | null

export interface MappedPreviewColumn { index: number; label: string; role: PreviewColumnRole }
export interface MappedPreviewRow { depth: number | null; cells: unknown[] }
export interface MappedPreview { columns: MappedPreviewColumn[]; rows: MappedPreviewRow[] }

// detect.ts/parseWithProfile.ts 와 동일 패턴(둘 다 비export 라 각자 복제해 왔다 — Plan C 통합 때 단일화).
const OUTLINE_RE = /^\d+([.\-]\d+)*$/

function isBlankPreviewCell(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

/** 행 하나의 계층 깊이를 판정한다. columns 모드는 정확히 1열만 채워져야 판정 가능(0/2개+ 채움은 null —
 *  편집 중 일시적으로 모호해질 수 있어 에러로 막지 않고 "?"로 보여준다). outline 모드는 코드 형식이
 *  아니면 null. parseWithProfile.linkByDepth 와 달리 실행을 막지 않는 표시 전용 판정이다. */
function computeRowDepth(row: unknown[], profile: ExcelProfile): number | null {
  if (profile.hierarchy.kind === 'columns') {
    const cols = profile.hierarchy.columns
    const filled = cols.filter(c => !isBlankPreviewCell(row[c]))
    return filled.length === 1 ? cols.indexOf(filled[0]) : null
  }
  const raw = String(row[profile.hierarchy.column] ?? '').trim()
  if (!OUTLINE_RE.test(raw)) return null
  return (raw.match(/[.\-]/g) ?? []).length
}

/** `detection.preview`(헤더+상위 10행 원본)를 현재 profile 매핑 기준으로 다시 라벨링한다.
 *  ArrayBuffer 재업로드+`parseWithProfile` 전체 재파싱은 쓰지 않는다 — 이미 서버가 돌려준 원본
 *  10행만으로 "이 열이 무엇에 매핑됐는지" 표시하는 데는 충분하고, 값 자체는 실행 시 서버가 다시
 *  정본으로 파싱하므로 여기서 날짜/숫자 변환까지 복제할 이유가 없다(파일당 1회면 충분한 파싱을
 *  편집 키 입력마다 반복하지 않는다). 열 우선순위: 계층 > 논리 > 팀(한 열이 여러 역할과 겹치는
 *  건 정상 프로파일에서는 없지만, 편집 중 일시적으로 겹칠 수 있어 결정적 우선순위를 둔다). */
export function deriveMappedPreview(headers: string[], rows: unknown[][], profile: ExcelProfile): MappedPreview {
  const maxCol = Math.max(headers.length, ...rows.map(r => r.length), 0)
  const hierarchySet = new Set<number>(
    profile.hierarchy.kind === 'columns' ? profile.hierarchy.columns : [profile.hierarchy.column],
  )
  const logicalByCol = new Map<number, keyof ExcelProfile['logical']>()
  for (const [field, col] of Object.entries(profile.logical) as [keyof ExcelProfile['logical'], number | null][]) {
    if (col !== null && !logicalByCol.has(col)) logicalByCol.set(col, field)
  }
  const teamByCol = new Map<number, string>()
  for (const [col, name] of profile.teamColumns) if (!teamByCol.has(col)) teamByCol.set(col, name)

  const columns: MappedPreviewColumn[] = []
  for (let c = 0; c < maxCol; c++) {
    let role: PreviewColumnRole = null
    if (hierarchySet.has(c)) role = { kind: 'hierarchy' }
    else if (logicalByCol.has(c)) role = { kind: 'logical', field: logicalByCol.get(c)! }
    else if (teamByCol.has(c)) role = { kind: 'team', team: teamByCol.get(c)! }
    columns.push({ index: c, label: headers[c] || `#${c}`, role })
  }

  const rowsOut: MappedPreviewRow[] = rows.map(r => ({ depth: computeRowDepth(r, profile), cells: r }))

  return { columns, rows: rowsOut }
}
