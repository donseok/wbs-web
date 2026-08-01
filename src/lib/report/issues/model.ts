import {
  ISSUE_MEGA_AREAS,
  isIssueMegaCode,
  type IssueMegaCode,
  type IssueSourceType,
} from '@/lib/domain/issueAnalysis'
import type { Issue, IssueSeverity, IssueStatus } from '@/lib/domain/issues'
import type { IssueMinuteSource } from '@/lib/domain/issueMinuteSource'

export const ISSUE_ANALYSIS_SCHEMA_VERSION = 'issue-analysis.v1' as const

/** 표준 템플릿의 원인 유형 정본(전략/규정, 프로세스, 조직, IT). */
export const ISSUE_ANALYSIS_CAUSE_CATEGORIES = [
  'strategy_policy',
  'process',
  'organization',
  'it',
] as const
export type IssueAnalysisCauseCategory =
  (typeof ISSUE_ANALYSIS_CAUSE_CATEGORIES)[number]

// LLM 출력과 저장 JSON의 비정상적인 팽창을 막는 계약 상한이다. PPT 페이지 분할은
// 이 상한 안의 원문을 줄이지 않고 별도로 처리한다.
export const ISSUE_ANALYSIS_CAUSES_PER_ISSUE_MAX = 4
export const ISSUE_ANALYSIS_DIRECT_CAUSE_MAX = 400
export const ISSUE_ANALYSIS_ROOT_CAUSE_MAX = 800

// 프로세스 정의(트리/정의 페이지 초안)의 길이 상한 — 템플릿 박스 실측(셈플 최대
// 3줄 ≈110자)에 여유를 둔 값이며 프롬프트·검증·저장 파서가 같은 값을 공유한다.
export const ISSUE_ANALYSIS_MEGA_DEFINITION_MAX = 200
export const ISSUE_ANALYSIS_MAJOR_DEFINITION_MAX = 150

/** 로더가 전달하는 프로젝트 전체 Major 기준정보(0062). */
export interface IssueAnalysisMajorProcess {
  id: string
  megaCode: IssueMegaCode
  majorSeq: number
  name: string
}

/** 영역 스냅샷/보고서 내부의 Major 표현 — megaCode는 소속 영역이 이미 말해준다. */
export interface IssueAnalysisAreaMajor {
  id: string
  majorSeq: number
  name: string
}

export interface IssueAnalysisAreaProcessDefinitions {
  megaDefinition: string
  majors: Array<{ majorId: string; definition: string }>
}

/**
 * 0055 적용 전후의 읽기 경계를 명시한다. Issue 본체에도 같은 필드가 존재하지만,
 * 보고서 순수 계층이 실제로 요구하는 분석 필드를 한 곳에서 볼 수 있게 유지한다.
 */
export type IssueAnalysisIssueInput = Issue & {
  megaCode: IssueMegaCode | null
  megaSeq: number | null
  piIssueCode: string | null
  subProcess: string
  ownerDepartment: string
  relatedSystems: string[]
  sourceType: IssueSourceType | null
  sourceDetail: string
}

export type IssueAnalysisMissingField =
  | 'piIssueCode'
  | 'megaCode'
  | 'body'
  | 'subProcess'
  | 'ownerDepartment'
  | 'source'

export interface IssueAnalysisBlockedIssue {
  id: string
  label: string
  reasons: string[]
  missingFields: IssueAnalysisMissingField[]
  unclassified: boolean
}

export interface IssueAnalysisPreflightArea {
  megaCode: IssueMegaCode
  megaName: string
  count: number
  readyCount: number
  blockedCount: number
}

export interface IssueAnalysisPreflight {
  totalCount: number
  readyCount: number
  blockedCount: number
  areas: IssueAnalysisPreflightArea[]
  blockedIssues: IssueAnalysisBlockedIssue[]
  unclassifiedIssues: IssueAnalysisBlockedIssue[]
}

export interface IssueAnalysisMinuteSourceSnapshot {
  id: string
  minuteId: string
  minuteVersionId: string
  minuteVersionNo: number
  minuteTitle: string
  minuteDate: string
  excerpt: string
  kind: IssueMinuteSource['kind']
}

export interface IssueAnalysisSourceSnapshot {
  manual: {
    type: IssueSourceType
    detail: string
  } | null
  minutes: IssueAnalysisMinuteSourceSnapshot[]
}

/** PPT 영역 종합 표와 개선기회 근거 카드가 함께 소비하는 불변 이슈 스냅샷. */
export interface IssueAnalysisReportIssue {
  id: string
  issueNo: number
  piIssueCode: string
  megaCode: IssueMegaCode
  megaSeq: number | null
  /** 0062 이전 분류 레거시 이슈는 null — 트리에서 '(미지정)'으로 표시된다. */
  majorId: string | null
  title: string
  body: string
  status: IssueStatus
  severity: IssueSeverity
  subProcess: string
  ownerDepartment: string
  relatedSystems: string[]
  assigneeMemberIds: string[]
  source: IssueAnalysisSourceSnapshot
}

export interface IssueAnalysisAreaSummary {
  totalCount: number
  statusCounts: Record<IssueStatus, number>
  severityCounts: Record<IssueSeverity, number>
  ownerDepartments: string[]
  relatedSystems: string[]
}

export interface IssueAnalysisOpportunity {
  title: string
  description: string
  /** DB UUID만 허용한다. 표시용 PI ID는 areas[].issues에서 결정적으로 매핑한다. */
  issueIds: string[]
}

export interface IssueAnalysisCause {
  category: IssueAnalysisCauseCategory
  /** 관찰된 문제를 직접 유발하는 업무·통제·시스템상의 메커니즘. */
  directCause: string
  /** 제공 근거만으로 확정할 수 없으면 사실을 만들지 않고 null로 둔다. */
  rootCause: string | null
}

export interface IssueAnalysisIssueCauseAnalysis {
  /** DB UUID만 허용하며 같은 Mega의 각 이슈가 정확히 한 번 나타나야 한다. */
  issueId: string
  causes: IssueAnalysisCause[]
}

export interface IssueAnalysisReportArea {
  megaCode: IssueMegaCode
  megaName: string
  megaNameEn: string
  /** v2 이전 저장 실행에는 없다. 신규 실행은 processDefinitions와 항상 함께 저장한다. */
  majors?: IssueAnalysisAreaMajor[]
  processDefinitions?: IssueAnalysisAreaProcessDefinitions
  summary: IssueAnalysisAreaSummary
  issues: IssueAnalysisReportIssue[]
  /**
   * v1 초기에 저장된 실행에는 이 필드가 없다. 신규 AI 생성 결과는 모든 이슈를
   * 정확히 한 번 포함하며, 저장/캐시 파서가 그 coverage를 검증한다.
   */
  causeAnalyses?: IssueAnalysisIssueCauseAnalysis[]
  opportunities: IssueAnalysisOpportunity[]
}

export interface IssueAnalysisInputSnapshot {
  schemaVersion: typeof ISSUE_ANALYSIS_SCHEMA_VERSION
  projectId: string
  issueCount: number
  areas: Array<
    Omit<
      IssueAnalysisReportArea,
      'causeAnalyses' | 'opportunities' | 'processDefinitions' | 'majors'
    > & { majors: IssueAnalysisAreaMajor[] }
  >
  /** Mega가 없는 레거시 이슈도 hard delete 감사 입력에서 사라지지 않게 보존한다. */
  unclassifiedIssues: Array<{
    id: string
    issueNo: number
    title: string
    body: string
    piIssueCode: string | null
  }>
}

export interface IssueAnalysisReport {
  schemaVersion: typeof ISSUE_ANALYSIS_SCHEMA_VERSION
  projectId: string
  issueCount: number
  generatedAt: string
  areas: IssueAnalysisReportArea[]
}

const EMPTY_STATUS_COUNTS = (): Record<IssueStatus, number> => ({
  open: 0,
  in_progress: 0,
  resolved: 0,
  on_hold: 0,
})

const EMPTY_SEVERITY_COUNTS = (): Record<IssueSeverity, number> => ({
  high: 0,
  medium: 0,
  low: 0,
})

const compact = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

function issueLabel(issue: Pick<IssueAnalysisIssueInput, 'issueNo' | 'piIssueCode' | 'title'>): string {
  const code = compact(issue.piIssueCode) || `#${issue.issueNo}`
  return `${code} ${compact(issue.title) || '(제목 없음)'}`
}

function expectedPiCode(megaCode: IssueMegaCode, megaSeq: number): string {
  return `PI-I-${megaCode}-${String(megaSeq).padStart(2, '0')}`
}

function missingForIssue(issue: IssueAnalysisIssueInput): {
  fields: IssueAnalysisMissingField[]
  reasons: string[]
} {
  const fields: IssueAnalysisMissingField[] = []
  const reasons: string[] = []
  const megaCode = isIssueMegaCode(issue.megaCode) ? issue.megaCode : null
  const piCode = compact(issue.piIssueCode)

  if (!megaCode) {
    fields.push('megaCode')
    reasons.push('Mega 영역이 지정되지 않았습니다.')
  }

  if (!piCode) {
    fields.push('piIssueCode')
    reasons.push('PI 이슈 ID가 체번되지 않았습니다.')
  } else if (
    megaCode
    && Number.isSafeInteger(issue.megaSeq)
    && Number(issue.megaSeq) > 0
    && piCode !== expectedPiCode(megaCode, Number(issue.megaSeq))
  ) {
    fields.push('piIssueCode')
    reasons.push('PI 이슈 ID가 Mega 영역/일련번호와 일치하지 않습니다.')
  }

  if (!compact(issue.body)) {
    fields.push('body')
    reasons.push('이슈 내용이 없습니다.')
  }
  if (!compact(issue.subProcess)) {
    fields.push('subProcess')
    reasons.push('Sub Process가 없습니다.')
  }
  if (!compact(issue.ownerDepartment)) {
    fields.push('ownerDepartment')
    reasons.push('주관부서가 없습니다.')
  }

  // 수기 메타(sourceType)와 불변 회의록 링크 중 하나만 있어도 출처가 있다.
  const hasSource = issue.sourceType === 'minutes'
    ? issue.minuteSources.length > 0
    : issue.sourceType !== null || issue.minuteSources.length > 0
  if (!hasSource) {
    fields.push('source')
    reasons.push('이슈 원천 또는 연결된 회의록 출처가 없습니다.')
  }
  return { fields, reasons }
}

function compareIssues(a: IssueAnalysisIssueInput, b: IssueAnalysisIssueInput): number {
  const aSeq = Number.isSafeInteger(a.megaSeq) && Number(a.megaSeq) > 0
    ? Number(a.megaSeq)
    : Number.POSITIVE_INFINITY
  const bSeq = Number.isSafeInteger(b.megaSeq) && Number(b.megaSeq) > 0
    ? Number(b.megaSeq)
    : Number.POSITIVE_INFINITY
  if (aSeq !== bSeq) return aSeq - bSeq
  const codeOrder = compact(a.piIssueCode).localeCompare(compact(b.piIssueCode), 'en', {
    numeric: true,
    sensitivity: 'base',
  })
  if (codeOrder !== 0) return codeOrder
  if (a.issueNo !== b.issueNo) return a.issueNo - b.issueNo
  return a.id.localeCompare(b.id)
}

/**
 * 전달된 분석 범위의 이슈를 Mega 정본 순서로 집계한다. 상태 필터는 의도적으로 없다.
 * 하나라도 blocked 이면 호출부가 AI 생성 전에 중단할 수 있도록 상세 사유를 직렬화한다.
 */
export function buildIssueAnalysisPreflight(
  issues: readonly IssueAnalysisIssueInput[],
): IssueAnalysisPreflight {
  const checks = new Map<string, ReturnType<typeof missingForIssue>>()
  const blockedIssues: IssueAnalysisBlockedIssue[] = []

  for (const issue of issues) {
    const missing = missingForIssue(issue)
    checks.set(issue.id, missing)
    if (missing.reasons.length) {
      blockedIssues.push({
        id: issue.id,
        label: issueLabel(issue),
        reasons: missing.reasons,
        missingFields: missing.fields,
        unclassified: !isIssueMegaCode(issue.megaCode),
      })
    }
  }

  const areas = ISSUE_MEGA_AREAS.map(area => {
    const members = issues.filter(issue => issue.megaCode === area.code)
    const blockedCount = members.filter(issue => (checks.get(issue.id)?.reasons.length ?? 0) > 0).length
    return {
      megaCode: area.code,
      megaName: area.nameKo,
      count: members.length,
      readyCount: members.length - blockedCount,
      blockedCount,
    }
  })

  return {
    totalCount: issues.length,
    readyCount: issues.length - blockedIssues.length,
    blockedCount: blockedIssues.length,
    areas,
    blockedIssues,
    unclassifiedIssues: blockedIssues.filter(issue => issue.unclassified),
  }
}

function snapshotMinuteSources(
  sources: readonly IssueMinuteSource[],
): IssueAnalysisMinuteSourceSnapshot[] {
  return [...sources]
    .sort((a, b) =>
      a.minuteDate.localeCompare(b.minuteDate)
      || a.minuteTitle.localeCompare(b.minuteTitle, 'ko')
      || a.blockIndex - b.blockIndex
      || a.id.localeCompare(b.id))
    .map(source => ({
      id: source.id,
      minuteId: source.minuteId,
      minuteVersionId: source.minuteVersionId,
      minuteVersionNo: source.minuteVersionNo,
      minuteTitle: source.minuteTitle,
      minuteDate: source.minuteDate,
      excerpt: source.excerpt,
      kind: source.kind,
    }))
}

export function toIssueAnalysisReportIssue(
  issue: IssueAnalysisIssueInput,
): IssueAnalysisReportIssue {
  if (!isIssueMegaCode(issue.megaCode) || !compact(issue.piIssueCode)) {
    throw new Error(`분류되지 않은 이슈는 보고서 이슈로 변환할 수 없습니다: ${issue.id}`)
  }
  return {
    id: issue.id,
    issueNo: issue.issueNo,
    piIssueCode: compact(issue.piIssueCode),
    megaCode: issue.megaCode,
    megaSeq: Number.isSafeInteger(issue.megaSeq) && Number(issue.megaSeq) > 0
      ? Number(issue.megaSeq)
      : null,
    majorId: issue.majorId ?? null,
    title: compact(issue.title),
    body: issue.body.trim(),
    status: issue.status,
    severity: issue.severity,
    subProcess: issue.subProcess.trim(),
    ownerDepartment: issue.ownerDepartment.trim(),
    relatedSystems: [...new Set(issue.relatedSystems.map(compact).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'ko')),
    assigneeMemberIds: [...new Set(issue.assigneeMemberIds)].sort(),
    source: {
      manual: issue.sourceType === null
        ? null
        : { type: issue.sourceType, detail: issue.sourceDetail.trim() },
      minutes: snapshotMinuteSources(issue.minuteSources),
    },
  }
}

function buildAreaSummary(issues: readonly IssueAnalysisReportIssue[]): IssueAnalysisAreaSummary {
  const statusCounts = EMPTY_STATUS_COUNTS()
  const severityCounts = EMPTY_SEVERITY_COUNTS()
  const ownerDepartments = new Set<string>()
  const relatedSystems = new Set<string>()
  for (const issue of issues) {
    statusCounts[issue.status] += 1
    severityCounts[issue.severity] += 1
    if (issue.ownerDepartment) ownerDepartments.add(issue.ownerDepartment)
    for (const system of issue.relatedSystems) relatedSystems.add(system)
  }
  return {
    totalCount: issues.length,
    statusCounts,
    severityCounts,
    ownerDepartments: [...ownerDepartments].sort((a, b) => a.localeCompare(b, 'ko')),
    relatedSystems: [...relatedSystems].sort((a, b) => a.localeCompare(b, 'ko')),
  }
}

/** 해시/감사 저장에 쓰는 정렬·정규화된 전체 입력 스냅샷. */
export function buildIssueAnalysisInputSnapshot(
  projectId: string,
  issues: readonly IssueAnalysisIssueInput[],
  majors: readonly IssueAnalysisMajorProcess[] = [],
): IssueAnalysisInputSnapshot {
  const areas = ISSUE_MEGA_AREAS.map(area => {
    const areaIssues = issues
      .filter(issue => issue.megaCode === area.code)
      .sort(compareIssues)
      .map(toIssueAnalysisReportIssue)
    const areaMajors = majors
      .filter(major => major.megaCode === area.code)
      .sort((a, b) => a.majorSeq - b.majorSeq)
      .map(major => ({ id: major.id, majorSeq: major.majorSeq, name: major.name }))
    // FK가 보장하는 정합이 로드 경계에서 깨졌다면 잘못된 공식 산출물을 만들지 않는다.
    const areaMajorIds = new Set(areaMajors.map(major => major.id))
    for (const issue of areaIssues) {
      if (issue.majorId !== null && !areaMajorIds.has(issue.majorId)) {
        throw new Error(
          `[issue-analysis] ${issue.piIssueCode} 이슈의 Major가 기준정보에 없습니다: ${issue.majorId}`,
        )
      }
    }
    return {
      megaCode: area.code,
      megaName: area.nameKo,
      megaNameEn: area.nameEn,
      majors: areaMajors,
      summary: buildAreaSummary(areaIssues),
      issues: areaIssues,
    }
  })
  const unclassifiedIssues = issues
    .filter(issue => !isIssueMegaCode(issue.megaCode))
    .sort((a, b) => a.issueNo - b.issueNo || a.id.localeCompare(b.id))
    .map(issue => ({
      id: issue.id,
      issueNo: issue.issueNo,
      title: issue.title,
      body: issue.body,
      piIssueCode: issue.piIssueCode,
    }))
  return {
    schemaVersion: ISSUE_ANALYSIS_SCHEMA_VERSION,
    projectId,
    issueCount: issues.length,
    areas,
    unclassifiedIssues,
  }
}

export function buildIssueAnalysisReport(
  snapshot: IssueAnalysisInputSnapshot,
  opportunities: Partial<Record<IssueMegaCode, IssueAnalysisOpportunity[]>>,
  generatedAt: string,
  causeAnalyses: Partial<Record<IssueMegaCode, IssueAnalysisIssueCauseAnalysis[]>> = {},
  processDefinitions: Partial<
    Record<IssueMegaCode, IssueAnalysisAreaProcessDefinitions>
  > = {},
): IssueAnalysisReport {
  return {
    schemaVersion: ISSUE_ANALYSIS_SCHEMA_VERSION,
    projectId: snapshot.projectId,
    issueCount: snapshot.issueCount,
    generatedAt,
    areas: snapshot.areas.map(area => {
      const areaCauseAnalyses = causeAnalyses[area.megaCode]
      const areaProcessDefinitions = processDefinitions[area.megaCode]
      return {
        ...area,
        ...(areaCauseAnalyses === undefined
          ? {}
          : {
              causeAnalyses: areaCauseAnalyses.map(analysis => ({
                issueId: analysis.issueId,
                causes: analysis.causes.map(cause => ({ ...cause })),
              })),
            }),
        ...(areaProcessDefinitions === undefined
          ? {}
          : {
              processDefinitions: {
                megaDefinition: areaProcessDefinitions.megaDefinition,
                majors: areaProcessDefinitions.majors.map(major => ({ ...major })),
              },
            }),
        opportunities: opportunities[area.megaCode]?.map(opportunity => ({
          title: opportunity.title,
          description: opportunity.description,
          issueIds: [...opportunity.issueIds],
        })) ?? [],
      }
    }),
  }
}
