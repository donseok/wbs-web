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
export const ISSUE_ANALYSIS_OPPORTUNITY_PAGE_CAPACITY = 10

// 표의 기본 1행은 11pt 한글 약 5줄을 안정적으로 표시한다. 고정 글자 수로
// 내용을 버리는 대신 열 너비별 예상 줄 수를 계산해 최대 3행 높이로 나누고,
// 슬라이드에는 행 높이 예산(첫 장 3, 후속 장 5)에 맞춰 배치한다.
const ISSUE_ANALYSIS_LINES_PER_ROW_UNIT = 5
const ISSUE_ANALYSIS_MAX_ROW_UNITS = ISSUE_ANALYSIS_FIRST_PAGE_CAPACITY
const ISSUE_ANALYSIS_MAX_LINES_PER_ROW =
  ISSUE_ANALYSIS_LINES_PER_ROW_UNIT * ISSUE_ANALYSIS_MAX_ROW_UNITS
const ISSUE_ANALYSIS_COLUMN_LINE_WIDTH = {
  title: 12,
  body: 34,
  subProcess: 6,
  source: 10,
} as const

// 개선기회 상세는 한 기회당 한 페이지를 고정하지 않는다. 연결 이슈와 개선 방향의
// 예상 높이를 같은 단위로 환산해 페이지 높이 예산 10 안에서 여러 기회를 묶는다.
// 한 단위는 12pt 한글 약 3줄이며, 장문은 원문을 버리지 않고 계속 블록으로 나눈다.
const ISSUE_ANALYSIS_OPPORTUNITY_LINES_PER_UNIT = 3
const ISSUE_ANALYSIS_OPPORTUNITY_MAX_LINES =
  ISSUE_ANALYSIS_OPPORTUNITY_PAGE_CAPACITY * ISSUE_ANALYSIS_OPPORTUNITY_LINES_PER_UNIT
const ISSUE_ANALYSIS_OPPORTUNITY_ISSUE_MAX_LINES = 9
const ISSUE_ANALYSIS_OPPORTUNITY_LINE_WIDTH = {
  issueTitle: 30,
  opportunity: 28,
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

export interface IssueAnalysisDeckIssueRow extends IssueAnalysisDeckIssue {
  /** 표 기본 행 높이의 배수. 렌더러가 같은 페이지의 실제 행 높이 비율로 사용한다. */
  rowUnits: number
  /** 한 이슈가 여러 행/페이지로 이어질 때 현재 조각의 순서. */
  continuationIndex: number
  continuationCount: number
}

export interface IssueAnalysisDeckOpportunityIssueRow
  extends Pick<IssueAnalysisDeckIssue, 'id' | 'piIssueCode' | 'title'> {
  /** 개선기회 페이지 기본 높이 단위의 배수. */
  rowUnits: number
  /** 장문 이슈 제목이 여러 행으로 이어질 때 현재 조각의 순서. */
  continuationIndex: number
  continuationCount: number
}

export interface IssueAnalysisDeckOpportunityBlock {
  megaCode: string
  megaName: string
  opportunityNo: number
  /** 계속 페이지에서도 맥락을 잃지 않도록 제목은 반복한다. */
  title: string
  /** 설명 원문의 현재 조각. 모든 블록을 순서대로 합치면 정규화된 원문과 같다. */
  description: string
  issues: IssueAnalysisDeckOpportunityIssueRow[]
  issueUnits: number
  opportunityUnits: number
  /** 한 페이지 높이 예산 안에서 이 블록이 차지하는 비율. */
  rowUnits: number
  continuationIndex: number
  continuationCount: number
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
      issues: IssueAnalysisDeckIssueRow[]
    }
  | {
      kind: 'area-summary-continuation'
      sourceSlide: 9
      megaCode: string
      megaName: string
      pageInArea: number
      issues: IssueAnalysisDeckIssueRow[]
    }
  | {
      kind: 'opportunity'
      sourceSlide: 12
      pageInSection: number
      pageCount: number
      blocks: IssueAnalysisDeckOpportunityBlock[]
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
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 등록 본문의 구역·목록 구조를 유지하면서 제어문자와 과도한 빈 줄만 정리한다. */
export function normalizeIssueAnalysisMultilineText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

export function fullSourceLines(lines: readonly string[]): string[] {
  return [...new Set(lines.map(compact).filter(Boolean))]
}

function toDeckIssue(issue: IssueAnalysisReportIssue): IssueAnalysisDeckIssue {
  return {
    id: issue.id,
    piIssueCode: issue.piIssueCode,
    title: compact(issue.title),
    body: normalizeIssueAnalysisMultilineText(issue.body),
    subProcess: compact(issue.subProcess),
    sourceLines: fullSourceLines(issueSourceLines(issue)),
  }
}

function characterWidth(char: string): number {
  if (/\s/u.test(char)) return 0.35
  if (/^[\u0000-\u00ff]$/u.test(char)) return 0.55
  return 1
}

export function estimateIssueAnalysisLineCount(value: string, lineWidth: number): number {
  if (!Number.isFinite(lineWidth) || lineWidth <= 0) {
    throw new Error('PPT 열 너비가 올바르지 않습니다.')
  }
  if (!value) return 1
  let lines = 1
  let width = 0
  for (const char of value) {
    if (char === '\n') {
      lines += 1
      width = 0
      continue
    }
    const next = characterWidth(char)
    if (width > 0 && width + next > lineWidth) {
      lines += 1
      width = next
    } else {
      width += next
    }
  }
  return lines
}

const PREFERRED_PAGE_BREAK_RE = /[\s.!?。;；:：,，、]/u

/**
 * 텍스트를 표시 줄 예산에 맞춰 손실 없이 나눈다. 가능한 경우 공백·문장부호에서
 * 끊고, 긴 식별자처럼 경계가 없을 때만 유니코드 코드포인트 경계에서 나눈다.
 */
export function splitIssueAnalysisTextForRows(
  value: string,
  lineWidth: number,
  maxLines = ISSUE_ANALYSIS_MAX_LINES_PER_ROW,
): string[] {
  if (!Number.isSafeInteger(maxLines) || maxLines < 1) {
    throw new Error('PPT 행 줄 수가 올바르지 않습니다.')
  }
  if (!value) return ['']

  const result: string[] = []
  let rest = value
  while (estimateIssueAnalysisLineCount(rest, lineWidth) > maxLines) {
    let width = 0
    let lines = 1
    let utf16Index = 0
    let lastPreferredIndex = 0
    let hardCutIndex = 0

    for (const char of rest) {
      const charLength = char.length
      if (char === '\n') {
        if (lines >= maxLines) {
          // 다음 문단의 개행은 다음 조각에 남겨 현재 조각이 줄 예산을 넘지 않게 한다.
          // 조각 맨 앞의 개행만 단독 보존해 진행이 멈추는 것을 방지한다.
          hardCutIndex = utf16Index || charLength
          break
        }
        lines += 1
        width = 0
        utf16Index += charLength
        lastPreferredIndex = utf16Index
        continue
      }

      const next = characterWidth(char)
      if (width > 0 && width + next > lineWidth) {
        if (lines >= maxLines) {
          hardCutIndex = utf16Index
          break
        }
        lines += 1
        width = next
      } else {
        width += next
      }
      utf16Index += charLength
      if (PREFERRED_PAGE_BREAK_RE.test(char)) lastPreferredIndex = utf16Index
    }

    if (!hardCutIndex) hardCutIndex = utf16Index
    const preferredIsClose = lastPreferredIndex >= Math.floor(hardCutIndex * 0.65)
    const cutIndex = preferredIsClose ? lastPreferredIndex : hardCutIndex
    if (cutIndex < 1 || cutIndex >= rest.length) {
      throw new Error('PPT 텍스트 페이지 분할에 실패했습니다.')
    }
    result.push(rest.slice(0, cutIndex))
    rest = rest.slice(cutIndex)
  }
  result.push(rest)
  return result
}

export function fullHeaderLines(values: readonly string[]): string[] {
  return [...new Set(values.map(compact).filter(Boolean))]
}

function repeatedOrIndexed(chunks: readonly string[], index: number): string {
  return chunks.length === 1 ? chunks[0] : (chunks[index] ?? '')
}

function issueRows(issue: IssueAnalysisDeckIssue): IssueAnalysisDeckIssueRow[] {
  const titleChunks = splitIssueAnalysisTextForRows(
    issue.title,
    ISSUE_ANALYSIS_COLUMN_LINE_WIDTH.title,
  )
  const bodyChunks = splitIssueAnalysisTextForRows(
    issue.body,
    ISSUE_ANALYSIS_COLUMN_LINE_WIDTH.body,
  )
  const subProcessChunks = splitIssueAnalysisTextForRows(
    issue.subProcess,
    ISSUE_ANALYSIS_COLUMN_LINE_WIDTH.subProcess,
  )
  const sourceChunks = splitIssueAnalysisTextForRows(
    issue.sourceLines.join('\n'),
    ISSUE_ANALYSIS_COLUMN_LINE_WIDTH.source,
  )
  const continuationCount = Math.max(
    titleChunks.length,
    bodyChunks.length,
    subProcessChunks.length,
    sourceChunks.length,
  )

  return Array.from({ length: continuationCount }, (_, index) => {
    const title = repeatedOrIndexed(titleChunks, index)
    const body = bodyChunks[index] ?? ''
    const subProcess = repeatedOrIndexed(subProcessChunks, index)
    const sourceText = repeatedOrIndexed(sourceChunks, index)
    const lineCounts = [
      estimateIssueAnalysisLineCount(title, ISSUE_ANALYSIS_COLUMN_LINE_WIDTH.title),
      estimateIssueAnalysisLineCount(body, ISSUE_ANALYSIS_COLUMN_LINE_WIDTH.body),
      estimateIssueAnalysisLineCount(subProcess, ISSUE_ANALYSIS_COLUMN_LINE_WIDTH.subProcess),
      estimateIssueAnalysisLineCount(sourceText, ISSUE_ANALYSIS_COLUMN_LINE_WIDTH.source),
    ]
    const rowUnits = Math.min(
      ISSUE_ANALYSIS_MAX_ROW_UNITS,
      Math.max(1, Math.ceil(Math.max(...lineCounts) / ISSUE_ANALYSIS_LINES_PER_ROW_UNIT)),
    )
    return {
      ...issue,
      title,
      body,
      subProcess,
      sourceLines: sourceText ? [sourceText] : [],
      rowUnits,
      continuationIndex: index + 1,
      continuationCount,
    }
  })
}

function takeIssuePage(
  rows: readonly IssueAnalysisDeckIssueRow[],
  start: number,
  capacity: number,
): { page: IssueAnalysisDeckIssueRow[]; next: number } {
  const page: IssueAnalysisDeckIssueRow[] = []
  let used = 0
  let next = start
  while (next < rows.length) {
    const row = rows[next]
    if (page.length && used + row.rowUnits > capacity) break
    if (row.rowUnits > capacity) {
      throw new Error(`${row.piIssueCode} 이슈 행이 PPT 페이지 높이를 초과합니다.`)
    }
    page.push(row)
    used += row.rowUnits
    next += 1
  }
  return { page, next }
}

function areaSlides(area: IssueAnalysisReportArea): IssueAnalysisDeckSlide[] {
  if (!area.issues.length) return []
  const rows = area.issues.flatMap(issue => issueRows(toDeckIssue(issue)))
  const first = takeIssuePage(rows, 0, ISSUE_ANALYSIS_FIRST_PAGE_CAPACITY)
  const slides: IssueAnalysisDeckSlide[] = [
    {
      kind: 'area-summary',
      sourceSlide: 8,
      megaCode: area.megaCode,
      megaName: area.megaName,
      ownerDepartmentLines: fullHeaderLines(area.summary.ownerDepartments),
      relatedSystemLines: fullHeaderLines(area.summary.relatedSystems),
      issues: first.page,
    },
  ]
  let cursor = first.next
  let pageInArea = 2
  while (cursor < rows.length) {
    const next = takeIssuePage(rows, cursor, ISSUE_ANALYSIS_CONTINUATION_CAPACITY)
    slides.push({
      kind: 'area-summary-continuation',
      sourceSlide: 9,
      megaCode: area.megaCode,
      megaName: area.megaName,
      pageInArea,
      issues: next.page,
    })
    cursor = next.next
    pageInArea += 1
  }
  return slides
}

function opportunityIssueRows(
  issue: Pick<IssueAnalysisDeckIssue, 'id' | 'piIssueCode' | 'title'>,
): IssueAnalysisDeckOpportunityIssueRow[] {
  const titleChunks = splitIssueAnalysisTextForRows(
    issue.title,
    ISSUE_ANALYSIS_OPPORTUNITY_LINE_WIDTH.issueTitle,
    ISSUE_ANALYSIS_OPPORTUNITY_ISSUE_MAX_LINES,
  )
  return titleChunks.map((title, index) => ({
    ...issue,
    title,
    rowUnits: Math.max(
      1,
      Math.ceil(
        estimateIssueAnalysisLineCount(
          title,
          ISSUE_ANALYSIS_OPPORTUNITY_LINE_WIDTH.issueTitle,
        ) / ISSUE_ANALYSIS_OPPORTUNITY_LINES_PER_UNIT,
      ),
    ),
    continuationIndex: index + 1,
    continuationCount: titleChunks.length,
  }))
}

function takeOpportunityIssuePage(
  rows: readonly IssueAnalysisDeckOpportunityIssueRow[],
  start: number,
): { page: IssueAnalysisDeckOpportunityIssueRow[]; next: number } {
  const page: IssueAnalysisDeckOpportunityIssueRow[] = []
  let used = 0
  let next = start
  while (next < rows.length) {
    const row = rows[next]
    if (row.rowUnits > ISSUE_ANALYSIS_OPPORTUNITY_PAGE_CAPACITY) {
      throw new Error(`${row.piIssueCode} 주요 이슈가 개선기회 페이지 높이를 초과합니다.`)
    }
    if (page.length && used + row.rowUnits > ISSUE_ANALYSIS_OPPORTUNITY_PAGE_CAPACITY) break
    page.push(row)
    used += row.rowUnits
    next += 1
  }
  return { page, next }
}

function opportunityIssuePages(
  issues: readonly Pick<IssueAnalysisDeckIssue, 'id' | 'piIssueCode' | 'title'>[],
): IssueAnalysisDeckOpportunityIssueRow[][] {
  const rows = issues.flatMap(opportunityIssueRows)
  const pages: IssueAnalysisDeckOpportunityIssueRow[][] = []
  let cursor = 0
  while (cursor < rows.length) {
    const next = takeOpportunityIssuePage(rows, cursor)
    pages.push(next.page)
    cursor = next.next
  }
  return pages
}

function opportunityDescriptionChunks(
  megaCode: string,
  megaName: string,
  title: string,
  description: string,
): string[] {
  const heading = `${megaCode}-${megaName} · ${title}`
  const headingLines = estimateIssueAnalysisLineCount(
    heading,
    ISSUE_ANALYSIS_OPPORTUNITY_LINE_WIDTH.opportunity,
  )
  const descriptionLines = ISSUE_ANALYSIS_OPPORTUNITY_MAX_LINES - headingLines
  if (descriptionLines < 1) {
    throw new Error(`${megaName} 개선기회 제목이 PPT 페이지 높이를 초과합니다.`)
  }
  return splitIssueAnalysisTextForRows(
    description,
    ISSUE_ANALYSIS_OPPORTUNITY_LINE_WIDTH.opportunity,
    descriptionLines,
  )
}

function opportunityBlocks(
  area: IssueAnalysisReportArea,
  opportunity: IssueAnalysisOpportunity,
  opportunityNo: number,
): IssueAnalysisDeckOpportunityBlock[] {
  if (
    opportunity.issueIds.length < 1
    || opportunity.issueIds.length > ISSUE_ANALYSIS_OPPORTUNITY_CAPACITY
  ) {
    throw new Error(
      `${area.megaName} 개선기회 ${opportunityNo}의 연결 이슈는 1~${ISSUE_ANALYSIS_OPPORTUNITY_CAPACITY}건이어야 합니다.`,
    )
  }
  if (new Set(opportunity.issueIds).size !== opportunity.issueIds.length) {
    throw new Error(`${area.megaName} 개선기회 ${opportunityNo}에 중복 연결 이슈가 있습니다.`)
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
      title: deckIssue.title,
    }
  })
  const title = compact(opportunity.title)
  const description = normalizeIssueAnalysisMultilineText(opportunity.description)
  const issuePages = opportunityIssuePages(issues)
  const descriptionChunks = opportunityDescriptionChunks(
    area.megaCode,
    area.megaName,
    title,
    description,
  )
  const continuationCount = Math.max(issuePages.length, descriptionChunks.length)

  return Array.from({ length: continuationCount }, (_, index) => {
    const pageIssues = issuePages[index] ?? []
    const descriptionChunk = descriptionChunks[index] ?? ''
    const issueUnits = pageIssues.reduce((sum, issue) => sum + issue.rowUnits, 0)
    const opportunityText = [
      `${area.megaCode}-${area.megaName} · ${title}`,
      descriptionChunk,
    ].filter(Boolean).join('\n')
    const textUnits = Math.ceil(
      estimateIssueAnalysisLineCount(
        opportunityText,
        ISSUE_ANALYSIS_OPPORTUNITY_LINE_WIDTH.opportunity,
      ) / ISSUE_ANALYSIS_OPPORTUNITY_LINES_PER_UNIT,
    )
    const rowUnits = Math.max(2, issueUnits, textUnits)
    if (rowUnits > ISSUE_ANALYSIS_OPPORTUNITY_PAGE_CAPACITY) {
      throw new Error(`${area.megaName} 개선기회 ${opportunityNo}가 PPT 페이지 높이를 초과합니다.`)
    }
    return {
      megaCode: area.megaCode,
      megaName: area.megaName,
      opportunityNo,
      title,
      description: descriptionChunk,
      issues: pageIssues,
      issueUnits,
      opportunityUnits: textUnits,
      rowUnits,
      continuationIndex: index + 1,
      continuationCount,
    }
  })
}

function opportunitySlides(
  blocks: readonly IssueAnalysisDeckOpportunityBlock[],
): IssueAnalysisDeckSlide[] {
  const pages: IssueAnalysisDeckOpportunityBlock[][] = []
  let current: IssueAnalysisDeckOpportunityBlock[] = []
  let used = 0
  for (const block of blocks) {
    if (
      current.length
      && used + block.rowUnits > ISSUE_ANALYSIS_OPPORTUNITY_PAGE_CAPACITY
    ) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(block)
    used += block.rowUnits
  }
  if (current.length) pages.push(current)
  const pageCount = pages.length
  return pages.map((pageBlocks, index) => ({
    kind: 'opportunity',
    sourceSlide: 12,
    pageInSection: index + 1,
    pageCount,
    blocks: pageBlocks,
  }))
}

/**
 * 표준 템플릿의 고정/동적 슬라이드를 결정하는 단일 계약.
 *
 * - 1~4 유지
 * - 5~7 프로세스 체계 제외
 * - 8 첫 페이지 높이 예산 3, 9 이후 높이 예산 5로 내용량에 맞춰 반복
 * - 10 원인분석 제외
 * - 11 유지
 * - 12 주요 이슈·개선기회를 높이 예산에 맞춰 함께 배치하고 필요할 때만 반복
 */
export function buildIssueAnalysisDeckPlan(
  report: IssueAnalysisReport,
  meta: IssueAnalysisDeckMeta,
): IssueAnalysisDeckPlan {
  if (report.issueCount < 1) throw new Error('분석서에 포함할 이슈가 없습니다.')
  const populatedAreas = report.areas.filter(area => area.issues.length > 0)
  if (!populatedAreas.length) throw new Error('분류된 Mega 영역 이슈가 없습니다.')

  const projectName = compact(meta.projectName)
  const authorName = compact(meta.authorName)
  const authorTeam = compact(meta.authorTeam)
  const authorLine = compact([authorTeam, authorName].filter(Boolean).join(' '))
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
  const opportunityPageBlocks: IssueAnalysisDeckOpportunityBlock[] = []
  for (const area of populatedAreas) {
    for (const opportunity of area.opportunities) {
      opportunityPageBlocks.push(...opportunityBlocks(area, opportunity, opportunityNo))
      opportunityNo += 1
    }
  }
  if (opportunityNo === 1) throw new Error('생성된 개선기회가 없습니다.')
  slides.push(...opportunitySlides(opportunityPageBlocks))

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
