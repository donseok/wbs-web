// 이슈 분석서 분류 메타 — 순수 함수만(I/O 없음).
// DB 정본은 0055_issue_analysis_metadata.sql 의 issue_mega_areas seed/check 제약과 함께 유지한다.

export const ISSUE_MEGA_AREAS = [
  { code: '00', nameKo: '기준관리', nameEn: 'Master Data' },
  { code: '01', nameKo: '손익관리', nameEn: 'Profit and Loss' },
  { code: '02', nameKo: '영업', nameEn: 'Sales' },
  { code: '03', nameKo: '품질·설계', nameEn: 'Quality & Design' },
  { code: '04', nameKo: '생산계획', nameEn: 'Production Planning' },
  { code: '05', nameKo: '조업', nameEn: 'Operations' },
  { code: '06', nameKo: '출하', nameEn: 'Shipping' },
  { code: '07', nameKo: '원가', nameEn: 'Cost' },
] as const

export type IssueMegaCode = (typeof ISSUE_MEGA_AREAS)[number]['code']
export const ISSUE_MEGA_CODES = ISSUE_MEGA_AREAS.map(area => area.code) as readonly IssueMegaCode[]
/** 이슈 목록과 분석서 작성이 공유하는 Mega 범위. */
export type IssueMegaFilter = 'all' | IssueMegaCode

export const ISSUE_SOURCE_TYPES = [
  'minutes',
  'interview',
  'deliverable',
  'as_is_analysis',
  'data_analysis',
  'other',
] as const
export type IssueSourceType = (typeof ISSUE_SOURCE_TYPES)[number]

export const ISSUE_SOURCE_META: Record<
  IssueSourceType,
  { labelKey: `issue.source.type.${IssueSourceType}` }
> = {
  minutes: { labelKey: 'issue.source.type.minutes' },
  interview: { labelKey: 'issue.source.type.interview' },
  deliverable: { labelKey: 'issue.source.type.deliverable' },
  as_is_analysis: { labelKey: 'issue.source.type.as_is_analysis' },
  data_analysis: { labelKey: 'issue.source.type.data_analysis' },
  other: { labelKey: 'issue.source.type.other' },
}

export const ISSUE_SUB_PROCESS_MAX = 200
export const ISSUE_OWNER_DEPARTMENT_MAX = 100
export const ISSUE_RELATED_SYSTEMS_MAX = 20
export const ISSUE_RELATED_SYSTEM_MAX = 100
export const ISSUE_SOURCE_DETAIL_MAX = 1000

export interface IssueAnalysisInput {
  megaCode: IssueMegaCode
  subProcess: string
  ownerDepartment: string
  relatedSystems: string[]
  sourceType: IssueSourceType
  sourceDetail: string
}

export interface NormalizedIssueAnalysisInput extends IssueAnalysisInput {
  relatedSystems: string[]
}

export type IssueAnalysisValidationResult =
  | { ok: true; value: NormalizedIssueAnalysisInput }
  | { ok: false; error: string }

export function isIssueMegaCode(value: unknown): value is IssueMegaCode {
  return typeof value === 'string' && (ISSUE_MEGA_CODES as readonly string[]).includes(value)
}

export function isIssueSourceType(value: unknown): value is IssueSourceType {
  return typeof value === 'string' && (ISSUE_SOURCE_TYPES as readonly string[]).includes(value)
}

/**
 * 서버 액션 인자는 브라우저가 임의로 만들 수 있으므로 타입 선언과 별개로 런타임 검증한다.
 * 회의록 출처는 불변 원문 검증이 끝난 전용 생성 경로만 허용한다.
 */
export function normalizeIssueAnalysisInput(
  input: IssueAnalysisInput,
  options: { allowMinutesSource?: boolean } = {},
): IssueAnalysisValidationResult {
  if (!isIssueMegaCode(input?.megaCode)) return { ok: false, error: '잘못된 Mega 영역입니다.' }

  if (typeof input.subProcess !== 'string' || !input.subProcess.trim()) {
    return { ok: false, error: 'Sub Process를 입력하세요.' }
  }
  const subProcess = input.subProcess.trim()
  if (subProcess.length > ISSUE_SUB_PROCESS_MAX) {
    return { ok: false, error: `Sub Process는 ${ISSUE_SUB_PROCESS_MAX}자 이하여야 합니다.` }
  }

  if (typeof input.ownerDepartment !== 'string' || !input.ownerDepartment.trim()) {
    return { ok: false, error: '주관부서를 입력하세요.' }
  }
  const ownerDepartment = input.ownerDepartment.trim()
  if (ownerDepartment.length > ISSUE_OWNER_DEPARTMENT_MAX) {
    return { ok: false, error: `주관부서는 ${ISSUE_OWNER_DEPARTMENT_MAX}자 이하여야 합니다.` }
  }

  if (!Array.isArray(input.relatedSystems) || input.relatedSystems.some(v => typeof v !== 'string')) {
    return { ok: false, error: '관련 시스템 형식이 올바르지 않습니다.' }
  }
  if (input.relatedSystems.length > ISSUE_RELATED_SYSTEMS_MAX) {
    return { ok: false, error: `관련 시스템은 최대 ${ISSUE_RELATED_SYSTEMS_MAX}개까지 입력할 수 있습니다.` }
  }
  const relatedSystems = input.relatedSystems.map(v => v.trim())
  if (relatedSystems.some(v => !v)) {
    return { ok: false, error: '관련 시스템의 빈 항목을 제거하세요.' }
  }
  if (relatedSystems.some(v => v.length > ISSUE_RELATED_SYSTEM_MAX)) {
    return { ok: false, error: `관련 시스템 이름은 ${ISSUE_RELATED_SYSTEM_MAX}자 이하여야 합니다.` }
  }

  if (!isIssueSourceType(input.sourceType)) return { ok: false, error: '잘못된 이슈 원천입니다.' }
  if (input.sourceType === 'minutes' && !options.allowMinutesSource) {
    return { ok: false, error: '회의록 원천은 회의록의 이슈 등록 기능에서만 선택할 수 있습니다.' }
  }

  if (typeof input.sourceDetail !== 'string') return { ok: false, error: '이슈 원천 상세 형식이 올바르지 않습니다.' }
  const sourceDetail = input.sourceDetail.trim()
  if (sourceDetail.length > ISSUE_SOURCE_DETAIL_MAX) {
    return { ok: false, error: `이슈 원천 상세는 ${ISSUE_SOURCE_DETAIL_MAX}자 이하여야 합니다.` }
  }

  return {
    ok: true,
    value: {
      megaCode: input.megaCode,
      subProcess,
      ownerDepartment,
      relatedSystems: [...new Set(relatedSystems)],
      sourceType: input.sourceType,
      sourceDetail,
    },
  }
}

/** 표시 계약: 최소 2자리이며 100부터는 잘라내지 않고 자연스럽게 확장한다. */
export function formatPiIssueCode(megaCode: IssueMegaCode, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error('이슈 일련번호는 양의 정수여야 합니다.')
  return `PI-I-${megaCode}-${String(sequence).padStart(2, '0')}`
}
