import type { IssueAnalysisReportArea } from './model'

export const ISSUE_ANALYSIS_TREE_COLUMN_CAPACITY = 8
export const ISSUE_ANALYSIS_TREE_SUB_CAPACITY = 6
export const ISSUE_ANALYSIS_DEFINITION_ROW_CAPACITY = 4
export const ISSUE_ANALYSIS_UNCLASSIFIED_MAJOR_LABEL = '(미지정)'

export interface IssueAnalysisDeckTreeColumn {
  label: string
  /** 같은 Major의 Sub가 6칸을 넘어 "이름(계속)" 열로 이어진 경우 true. */
  continuation: boolean
  subs: string[]
}

export interface IssueAnalysisDeckDefinitionRow {
  /** `{megaCode}.{seq2}` — 0062 체번을 그대로 노출한다(예: 02.01). */
  seqLabel: string
  name: string
  definition: string
}

export interface IssueAnalysisDeckProcessTreeSlide {
  kind: 'process-tree'
  sourceSlide: 5
  megaCode: string
  megaName: string
  pageInSeries: number
  pageCount: number
  headline: string
  columns: IssueAnalysisDeckTreeColumn[]
}

export interface IssueAnalysisDeckProcessDefinitionSlide {
  kind: 'process-definition'
  sourceSlide: 6
  megaCode: string
  megaName: string
  pageInSeries: number
  pageCount: number
  /** 셈플은 트리 페이지의 요약문을 정의 페이지에도 반복한다. */
  headline: string
  megaDefinition: string
  rows: IssueAnalysisDeckDefinitionRow[]
}

export type IssueAnalysisDeckProcessSlide =
  | IssueAnalysisDeckProcessTreeSlide
  | IssueAnalysisDeckProcessDefinitionSlide

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    pages.push(items.slice(start, start + size))
  }
  return pages
}

/**
 * Major(seq순)별 이슈 구분 고유값을 열로 편성한다. 전량 유지 원칙:
 * 열당 6칸을 넘으면 "이름(계속)" 연속 열, Sub 0개 Major도 빈 열을 차지하고,
 * Major 미지정(0062 이전) 이슈의 구분은 마지막 "(미지정)" 열에 모은다.
 */
function treeColumns(area: IssueAnalysisReportArea): IssueAnalysisDeckTreeColumn[] {
  const majors = area.majors ?? []
  const majorIds = new Set(majors.map(major => major.id))
  const subsByKey = new Map<string, string[]>()
  for (const issue of area.issues) {
    if (issue.majorId !== null && !majorIds.has(issue.majorId)) {
      throw new Error(
        `${area.megaName} ${issue.piIssueCode} 이슈가 영역 Major 목록에 없는 Major를 참조합니다.`,
      )
    }
    const sub = compactText(issue.subProcess)
    if (!sub) {
      throw new Error(`${area.megaName} ${issue.piIssueCode} 이슈의 Sub Process가 비어 있습니다.`)
    }
    const key = issue.majorId ?? ''
    const list = subsByKey.get(key)
    if (!list) subsByKey.set(key, [sub])
    else if (!list.includes(sub)) list.push(sub)
  }

  const columns: IssueAnalysisDeckTreeColumn[] = []
  const pushColumns = (label: string, subs: readonly string[]) => {
    if (!subs.length) {
      columns.push({ label, continuation: false, subs: [] })
      return
    }
    chunk(subs, ISSUE_ANALYSIS_TREE_SUB_CAPACITY).forEach((page, index) => {
      columns.push({
        label: index === 0 ? label : `${label}(계속)`,
        continuation: index > 0,
        subs: page,
      })
    })
  }
  for (const major of majors) pushColumns(major.name, subsByKey.get(major.id) ?? [])
  const unclassified = subsByKey.get('')
  if (unclassified?.length) {
    pushColumns(ISSUE_ANALYSIS_UNCLASSIFIED_MAJOR_LABEL, unclassified)
  }
  return columns
}

function treeHeadline(
  area: IssueAnalysisReportArea,
  columns: readonly IssueAnalysisDeckTreeColumn[],
): string {
  const majors = area.majors ?? []
  const subCount = columns.reduce((sum, column) => sum + column.subs.length, 0)
  // Sub 마스터가 없어 트리의 Sub는 이슈의 구분에서 관찰된 것만이다(디자인 감사 #1).
  // 셈플처럼 "M개의 Sub로 구성됨"이라고 쓰면 전체 체계 수처럼 읽히므로 출처를 정직하게 쓴다.
  if (!majors.length) {
    return `현행 ${area.megaName} 프로세스에서 이슈가 확인된 Sub 프로세스는 ${subCount}개임 (Major 미지정)`
  }
  const names = majors.map(major => major.name)
  const listed = names.slice(0, 3).join(',')
  const suffix = names.length > 3 ? ' 등' : ''
  return `현행 ${area.megaName} 프로세스는 ${listed}${suffix} ${majors.length}개의 Major 프로세스로 구성되며, 이슈가 확인된 Sub 프로세스는 ${subCount}개임`
}

/**
 * 저장 실행에 프로세스 정의가 있는 영역만 트리→정의 순의 슬라이드 시리즈를 만든다.
 * 정의가 없는 구버전 저장 실행은 빈 배열 — 기존 덱 구성이 한 장도 변하지 않는다.
 */
export function buildIssueAnalysisProcessSlides(
  area: IssueAnalysisReportArea,
): IssueAnalysisDeckProcessSlide[] {
  const definitions = area.processDefinitions
  const majors = area.majors
  if (!definitions || !majors || !area.issues.length) return []

  const columns = treeColumns(area)
  const headline = treeHeadline(area, columns)
  const treePages = chunk(columns, ISSUE_ANALYSIS_TREE_COLUMN_CAPACITY)
  const slides: IssueAnalysisDeckProcessSlide[] = treePages.map((pageColumns, index) => ({
    kind: 'process-tree',
    sourceSlide: 5,
    megaCode: area.megaCode,
    megaName: area.megaName,
    pageInSeries: index + 1,
    pageCount: treePages.length,
    headline,
    columns: pageColumns,
  }))

  const definitionById = new Map(
    definitions.majors.map(major => [major.majorId, major.definition]),
  )
  if (definitionById.size !== definitions.majors.length) {
    throw new Error(`${area.megaName} 프로세스 정의에 중복 Major가 있습니다.`)
  }
  const rows = majors.map(major => {
    const definition = definitionById.get(major.id)
    if (definition === undefined) {
      throw new Error(`${area.megaName} ${major.name} Major의 프로세스 정의가 없습니다.`)
    }
    return {
      seqLabel: `${area.megaCode}.${String(major.majorSeq).padStart(2, '0')}`,
      name: major.name,
      definition,
    }
  })
  const definitionPages = chunk(rows, ISSUE_ANALYSIS_DEFINITION_ROW_CAPACITY)
  definitionPages.forEach((pageRows, index) => {
    slides.push({
      kind: 'process-definition',
      sourceSlide: 6,
      megaCode: area.megaCode,
      megaName: area.megaName,
      pageInSeries: index + 1,
      pageCount: definitionPages.length,
      headline,
      megaDefinition: definitions.megaDefinition,
      rows: pageRows,
    })
  })
  return slides
}
