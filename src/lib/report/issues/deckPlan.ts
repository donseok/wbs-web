import type { IssueSourceType } from '@/lib/domain/issueAnalysis'
import type {
  IssueAnalysisOpportunity,
  IssueAnalysisReport,
  IssueAnalysisReportArea,
  IssueAnalysisReportIssue,
} from './model'

export const ISSUE_ANALYSIS_FIRST_PAGE_CAPACITY = 3
export const ISSUE_ANALYSIS_CONTINUATION_CAPACITY = 5
export const ISSUE_ANALYSIS_OPPORTUNITY_CAPACITY = 5
export const ISSUE_ANALYSIS_CELL_LIMITS = {
  coverProjectName: 42,
  authorName: 24,
  authorTeam: 24,
  authorLine: 42,
  title: 60,
  body: 160,
  subProcess: 28,
  sourceLine: 20,
  sourceLines: 2,
  opportunityIssueTitle: 64,
  opportunityTitle: 36,
  opportunityDescription: 44,
} as const

export interface IssueAnalysisDeckMeta {
  projectName: string
  authorName: string
  authorTeam: string
  generatedAt: string
}

export interface IssueAnalysisDeckIssue {
  id: string
  piIssueCode: string
  title: string
  body: string
  subProcess: string
  sourceLines: string[]
}

export type IssueAnalysisDeckSlide =
  | {
      kind: 'cover'
      sourceSlide: 1
      projectName: string
      authorLine: string
      dateLabel: string
    }
  | {
      kind: 'contents'
      sourceSlide: 2 | 4 | 11
      activeSection: 1 | 2 | 3
    }
  | {
      kind: 'approach'
      sourceSlide: 3
    }
  | {
      kind: 'area-summary'
      sourceSlide: 8
      megaCode: string
      megaName: string
      ownerDepartmentLines: string[]
      relatedSystemLines: string[]
      issues: IssueAnalysisDeckIssue[]
    }
  | {
      kind: 'area-summary-continuation'
      sourceSlide: 9
      megaCode: string
      megaName: string
      pageInArea: number
      issues: IssueAnalysisDeckIssue[]
    }
  | {
      kind: 'opportunity'
      sourceSlide: 12
      megaCode: string
      megaName: string
      opportunityNo: number
      title: string
      description: string
      issues: Array<Pick<IssueAnalysisDeckIssue, 'id' | 'piIssueCode' | 'title'>>
    }

export interface IssueAnalysisDeckPlan {
  schemaVersion: 'issue-analysis-deck.v1'
  projectId: string
  issueCount: number
  generatedAt: string
  meta: {
    projectName: string
    authorName: string
    authorTeam: string
    authorLine: string
    dateLabel: string
  }
  slides: IssueAnalysisDeckSlide[]
}

const SOURCE_TYPE_LABELS: Record<IssueSourceType, string> = {
  minutes: '회의록',
  interview: '현업 인터뷰',
  deliverable: '기존 산출물',
  as_is_analysis: 'As-Is 이슈 및 원인분석서',
  data_analysis: '데이터 분석',
  other: '기타',
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function truncateIssueAnalysisText(value: string, max: number): string {
  if (!Number.isSafeInteger(max) || max < 1) throw new Error('PPT 텍스트 제한이 올바르지 않습니다.')
  const normalized = compact(value)
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1).trimEnd()}…`
}

function formatDateInSeoul(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('이슈 분석서 생성일시가 올바르지 않습니다.')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}.${get('month')}.${get('day')}`
}

function splitDetail(value: string): string[] {
  return value
    .split(/\r?\n|[|;]/)
    .map(compact)
    .filter(Boolean)
}

export function issueSourceLines(issue: IssueAnalysisReportIssue): string[] {
  const lines: string[] = []
  if (issue.source.manual) {
    lines.push(SOURCE_TYPE_LABELS[issue.source.manual.type])
    lines.push(...splitDetail(issue.source.manual.detail))
  }
  for (const source of issue.source.minutes) {
    const context = compact([source.minuteDate, source.minuteTitle].filter(Boolean).join(' '))
    lines.push(context ? `회의록 · ${context}` : '회의록')
  }
  return [...new Set(lines)]
}

export function boundedSourceLines(lines: readonly string[]): string[] {
  const unique = [...new Set(lines.map(compact).filter(Boolean))]
  const visible = unique
    .slice(0, ISSUE_ANALYSIS_CELL_LIMITS.sourceLines)
    .map(line => truncateIssueAnalysisText(line, ISSUE_ANALYSIS_CELL_LIMITS.sourceLine))
  if (unique.length <= ISSUE_ANALYSIS_CELL_LIMITS.sourceLines) return visible
  visible[visible.length - 1] = `외 ${unique.length - ISSUE_ANALYSIS_CELL_LIMITS.sourceLines + 1}개 원천`
  return visible
}

function toDeckIssue(issue: IssueAnalysisReportIssue): IssueAnalysisDeckIssue {
  return {
    id: issue.id,
    piIssueCode: issue.piIssueCode,
    title: truncateIssueAnalysisText(issue.title, ISSUE_ANALYSIS_CELL_LIMITS.title),
    body: truncateIssueAnalysisText(issue.body, ISSUE_ANALYSIS_CELL_LIMITS.body),
    subProcess: truncateIssueAnalysisText(
      issue.subProcess,
      ISSUE_ANALYSIS_CELL_LIMITS.subProcess,
    ),
    sourceLines: boundedSourceLines(issueSourceLines(issue)),
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

/**
 * 헤더 상자는 3줄을 넘기지 않는다. 값이 더 많으면 마지막 줄을 "외 N개"로 만들어
 * 누락을 숨기지 않으면서 원본 글꼴/상자 크기를 보존한다.
 */
export function boundedHeaderLines(values: readonly string[], capacity = 3): string[] {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('헤더 줄 용량이 올바르지 않습니다.')
  const unique = [...new Set(values.map(compact).filter(Boolean))]
  if (unique.length <= capacity) return unique
  if (capacity === 1) return [`외 ${unique.length}개`]
  return [...unique.slice(0, capacity - 1), `외 ${unique.length - capacity + 1}개`]
}

function areaSlides(area: IssueAnalysisReportArea): IssueAnalysisDeckSlide[] {
  if (!area.issues.length) return []
  const issues = area.issues.map(toDeckIssue)
  const first = issues.slice(0, ISSUE_ANALYSIS_FIRST_PAGE_CAPACITY)
  const remaining = chunks(
    issues.slice(ISSUE_ANALYSIS_FIRST_PAGE_CAPACITY),
    ISSUE_ANALYSIS_CONTINUATION_CAPACITY,
  )
  return [
    {
      kind: 'area-summary',
      sourceSlide: 8,
      megaCode: area.megaCode,
      megaName: area.megaName,
      ownerDepartmentLines: boundedHeaderLines(area.summary.ownerDepartments),
      relatedSystemLines: boundedHeaderLines(area.summary.relatedSystems),
      issues: first,
    },
    ...remaining.map((pageIssues, index): IssueAnalysisDeckSlide => ({
      kind: 'area-summary-continuation',
      sourceSlide: 9,
      megaCode: area.megaCode,
      megaName: area.megaName,
      pageInArea: index + 2,
      issues: pageIssues,
    })),
  ]
}

function opportunitySlide(
  area: IssueAnalysisReportArea,
  opportunity: IssueAnalysisOpportunity,
  opportunityNo: number,
): IssueAnalysisDeckSlide {
  if (
    opportunity.issueIds.length < 1
    || opportunity.issueIds.length > ISSUE_ANALYSIS_OPPORTUNITY_CAPACITY
  ) {
    throw new Error(
      `${area.megaName} 개선기회 ${opportunityNo}의 연결 이슈는 1~${ISSUE_ANALYSIS_OPPORTUNITY_CAPACITY}건이어야 합니다.`,
    )
  }
  const byId = new Map(area.issues.map(issue => [issue.id, issue]))
  const issues = opportunity.issueIds.map(id => {
    const issue = byId.get(id)
    if (!issue) {
      throw new Error(`${area.megaName} 개선기회 ${opportunityNo}가 영역 밖 이슈를 참조합니다: ${id}`)
    }
    const deckIssue = toDeckIssue(issue)
    return {
      id: deckIssue.id,
      piIssueCode: deckIssue.piIssueCode,
      title: truncateIssueAnalysisText(
        deckIssue.title,
        ISSUE_ANALYSIS_CELL_LIMITS.opportunityIssueTitle,
      ),
    }
  })
  return {
    kind: 'opportunity',
    sourceSlide: 12,
    megaCode: area.megaCode,
    megaName: area.megaName,
    opportunityNo,
    title: truncateIssueAnalysisText(
      opportunity.title,
      ISSUE_ANALYSIS_CELL_LIMITS.opportunityTitle,
    ),
    description: truncateIssueAnalysisText(
      opportunity.description,
      ISSUE_ANALYSIS_CELL_LIMITS.opportunityDescription,
    ),
    issues,
  }
}

/**
 * 표준 템플릿의 고정/동적 슬라이드를 결정하는 단일 계약.
 *
 * - 1~4 유지
 * - 5~7 프로세스 체계 제외
 * - 8 첫 3건, 9 이후 5건씩 반복
 * - 10 원인분석 제외
 * - 11 유지
 * - 12 개선기회별 반복(연결 이슈 1~5건)
 */
export function buildIssueAnalysisDeckPlan(
  report: IssueAnalysisReport,
  meta: IssueAnalysisDeckMeta,
): IssueAnalysisDeckPlan {
  if (report.issueCount < 1) throw new Error('분석서에 포함할 이슈가 없습니다.')
  const populatedAreas = report.areas.filter(area => area.issues.length > 0)
  if (!populatedAreas.length) throw new Error('분류된 Mega 영역 이슈가 없습니다.')

  const projectName = truncateIssueAnalysisText(
    meta.projectName,
    ISSUE_ANALYSIS_CELL_LIMITS.coverProjectName,
  )
  const authorName = truncateIssueAnalysisText(
    meta.authorName,
    ISSUE_ANALYSIS_CELL_LIMITS.authorName,
  )
  const authorTeam = truncateIssueAnalysisText(
    meta.authorTeam,
    ISSUE_ANALYSIS_CELL_LIMITS.authorTeam,
  )
  const authorLine = truncateIssueAnalysisText(
    [authorTeam, authorName].filter(Boolean).join(' '),
    ISSUE_ANALYSIS_CELL_LIMITS.authorLine,
  )
  const dateLabel = formatDateInSeoul(meta.generatedAt)
  if (!projectName) throw new Error('이슈 분석서 프로젝트명이 없습니다.')

  const slides: IssueAnalysisDeckSlide[] = [
    {
      kind: 'cover',
      sourceSlide: 1,
      projectName,
      authorLine,
      dateLabel,
    },
    { kind: 'contents', sourceSlide: 2, activeSection: 1 },
    { kind: 'approach', sourceSlide: 3 },
    { kind: 'contents', sourceSlide: 4, activeSection: 2 },
  ]

  for (const area of populatedAreas) slides.push(...areaSlides(area))
  slides.push({ kind: 'contents', sourceSlide: 11, activeSection: 3 })

  let opportunityNo = 1
  for (const area of populatedAreas) {
    for (const opportunity of area.opportunities) {
      slides.push(opportunitySlide(area, opportunity, opportunityNo))
      opportunityNo += 1
    }
  }
  if (opportunityNo === 1) throw new Error('생성된 개선기회가 없습니다.')

  return {
    schemaVersion: 'issue-analysis-deck.v1',
    projectId: report.projectId,
    issueCount: report.issueCount,
    generatedAt: meta.generatedAt,
    meta: {
      projectName,
      authorName,
      authorTeam,
      authorLine,
      dateLabel,
    },
    slides,
  }
}
