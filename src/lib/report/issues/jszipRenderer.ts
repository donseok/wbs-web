import 'server-only'

import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { ISSUE_ANALYSIS_TEMPLATE_PATH } from './template'
import {
  ISSUE_ANALYSIS_CAUSE_PAGE_CAPACITY,
  ISSUE_ANALYSIS_OPPORTUNITY_PAGE_CAPACITY,
  type IssueAnalysisDeckBodyParagraph,
  type IssueAnalysisDeckCauseRow,
  type IssueAnalysisDeckIssueRow,
  type IssueAnalysisDeckOpportunityBlock,
  type IssueAnalysisDeckPlan,
  type IssueAnalysisDeckSlide,
} from './deckPlan'
import {
  ISSUE_ANALYSIS_DEFINITION_ROW_CAPACITY,
  ISSUE_ANALYSIS_TREE_COLUMN_CAPACITY,
  ISSUE_ANALYSIS_TREE_SUB_CAPACITY,
} from './processPages'
import {
  renderProcessDefinitionSlide,
  renderProcessTreeSlide,
} from './processSlideRenderer'
import {
  CONNECTOR_RE,
  END_RPR_RE,
  GRAPHIC_FRAME_RE,
  PARAGRAPH_RE,
  PPR_RE,
  SHAPE_RE,
  TABLE_CELL_RE,
  TABLE_ROW_RE,
  type TextBodyMode,
  appendShapeTreeElements,
  deleteGroupShape,
  deleteShapeOrConnector,
  escapeXml,
  mapGraphicFrame,
  mapShape,
  mapSingleXmlElement,
  rebuildTextBody,
  setPageFooter,
  setShapeElementInset,
  setShapeElementText,
  setShapeText,
  shapeIdPattern,
  singleElementById,
  textNode,
  toEndRunProperties,
  withConnectorTargets,
  withElementId,
  withElementTransform,
  withGraphicFrameTransform,
  withNormalAutofit,
} from './slideXml'

const SLIDE_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
const SLIDE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'

function rebuildCoverTitle(textBodyXml: string, projectName: string): string {
  const open = textBodyXml.match(/^<p:txBody\b[^>]*>/)?.[0]
  const close = textBodyXml.match(/<\/p:txBody>$/)?.[0]
  const sourceBodyPr = textBodyXml.match(
    /<a:bodyPr\b[^>]*\/>|<a:bodyPr\b[\s\S]*?<\/a:bodyPr>/,
  )?.[0]
  const listStyle = textBodyXml.match(
    /<a:lstStyle\b[^>]*\/>|<a:lstStyle\b[\s\S]*?<\/a:lstStyle>/,
  )?.[0]
  const paragraph = textBodyXml.match(PARAGRAPH_RE)?.[0]
  if (!open || !close || !sourceBodyPr || !listStyle || !paragraph) {
    throw new Error('[issue-analysis] 표지 제목 구조가 올바르지 않습니다.')
  }
  const bodyPr = withNormalAutofit(sourceBodyPr)

  const pOpen = paragraph.match(/^<a:p(?:\s[^>]*)?>/)?.[0] ?? '<a:p>'
  const pPr = paragraph.match(PPR_RE)?.[0] ?? ''
  const runProperties = [...paragraph.matchAll(
    /<a:rPr\b[^>]*\/>|<a:rPr\b[\s\S]*?<\/a:rPr>/g,
  )].map(match => match[0])
  const primary = runProperties[0] ?? '<a:rPr/>'
  const secondary = runProperties.find(item => /\bsz="2400"/.test(item))
    ?? runProperties.at(-1)
    ?? primary
  const breakProperties = paragraph.match(
    /<a:br\b[^>]*>\s*(<a:rPr\b[^>]*\/>|<a:rPr\b[\s\S]*?<\/a:rPr>)\s*<\/a:br>/,
  )?.[1] ?? primary
  const end = paragraph.match(END_RPR_RE)?.[0] ?? toEndRunProperties(secondary)

  const content = [
    `${pOpen}${pPr}`,
    `<a:r>${primary}${textNode(projectName)}</a:r>`,
    `<a:br>${breakProperties}</a:br>`,
    `<a:r>${secondary}<a:t>(이슈 분석서)</a:t></a:r>`,
    `${end}</a:p>`,
  ].join('')
  return `${open}${bodyPr}${listStyle}${content}${close}`
}

function setCoverTitle(slideXml: string, projectName: string): string {
  return mapShape(slideXml, '2', shapeXml => {
    const textBody = shapeXml.match(/<p:txBody\b[^>]*>[\s\S]*?<\/p:txBody>/)?.[0]
    if (!textBody) throw new Error('[issue-analysis] 표지 제목 텍스트 본문이 없습니다.')
    return shapeXml.replace(textBody, () => rebuildCoverTitle(textBody, projectName))
  })
}

function cellAt(tableXml: string, rowIndex: number, columnIndex: number): string {
  const rows = tableXml.match(TABLE_ROW_RE) ?? []
  const cells = rows[rowIndex]?.match(TABLE_CELL_RE) ?? []
  return cells[columnIndex] ?? ''
}

function setTableCellText(
  tableXml: string,
  rowIndex: number,
  columnIndex: number,
  value: string,
  mode?: TextBodyMode,
  issueParagraphs?: readonly IssueAnalysisDeckBodyParagraph[],
): string {
  const target = cellAt(tableXml, rowIndex, columnIndex)
  if (!target) {
    throw new Error(
      `[issue-analysis] 표 셀 [${rowIndex},${columnIndex}]을 찾을 수 없습니다.`,
    )
  }
  const textBody = target.match(/<a:txBody\b[^>]*>[\s\S]*?<\/a:txBody>/)?.[0]
  if (!textBody) {
    throw new Error(
      `[issue-analysis] 표 셀 [${rowIndex},${columnIndex}]에 텍스트 본문이 없습니다.`,
    )
  }
  const replacement = target.replace(
    textBody,
    () => rebuildTextBody(
      textBody,
      value,
      true,
      mode ?? (rowIndex > 0 && columnIndex === 2 ? 'issue-body' : 'plain'),
      issueParagraphs,
    ),
  )
  let row = -1
  return tableXml.replace(TABLE_ROW_RE, rowXml => {
    row += 1
    if (row !== rowIndex) return rowXml
    let column = -1
    return rowXml.replace(TABLE_CELL_RE, cellXml => {
      column += 1
      return column === columnIndex ? replacement : cellXml
    })
  })
}

function issueRowValues(issue: IssueAnalysisDeckIssueRow | undefined): string[] {
  if (!issue) return ['', '', '', '', '']
  const continuation = issue.continuationCount > 1
    ? `\n(계속 ${issue.continuationIndex}/${issue.continuationCount})`
    : ''
  return [
    `${issue.piIssueCode}${continuation}`,
    issue.title,
    issue.body,
    issue.subProcess,
    issue.sourceLines.join('\n'),
  ]
}

function tableRowHeight(rowXml: string): number {
  const value = Number(rowXml.match(/<a:tr\b[^>]*\bh="(\d+)"/)?.[1] ?? 0)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('[issue-analysis] 표 행 높이가 올바르지 않습니다.')
  }
  return value
}

function setTableRowHeight(rowXml: string, value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('[issue-analysis] 계산된 표 행 높이가 올바르지 않습니다.')
  }
  if (!/<a:tr\b[^>]*\bh="\d+"/.test(rowXml)) {
    throw new Error('[issue-analysis] 높이를 변경할 표 행을 찾을 수 없습니다.')
  }
  return rowXml.replace(
    /(<a:tr\b[^>]*\bh=")\d+("[^>]*>)/,
    `$1${value}$2`,
  )
}

function issueRowHeights(
  rows: readonly string[],
  issues: readonly IssueAnalysisDeckIssueRow[],
): number[] {
  const totalHeight = rows.slice(1).reduce((sum, row) => sum + tableRowHeight(row), 0)
  const totalUnits = issues.reduce((sum, issue) => sum + issue.rowUnits, 0)
  if (!issues.length || totalUnits < 1) {
    throw new Error('[issue-analysis] 이슈 표 페이지가 비어 있습니다.')
  }

  let remainingHeight = totalHeight
  let remainingUnits = totalUnits
  return issues.map((issue, index) => {
    if (
      !Number.isSafeInteger(issue.rowUnits)
      || issue.rowUnits < 1
      || issue.rowUnits > totalUnits
    ) {
      throw new Error(`[issue-analysis] ${issue.piIssueCode} 이슈 행 비율이 올바르지 않습니다.`)
    }
    const height = index === issues.length - 1
      ? remainingHeight
      : Math.floor((remainingHeight * issue.rowUnits) / remainingUnits)
    remainingHeight -= height
    remainingUnits -= issue.rowUnits
    return height
  })
}

function fillIssueTable(
  slideXml: string,
  issues: IssueAnalysisDeckIssueRow[],
  capacity: number,
  shapeId?: string,
): string {
  const id = shapeId ? shapeIdPattern(shapeId) : null
  return mapSingleXmlElement(
    slideXml,
    GRAPHIC_FRAME_RE,
    frameXml => frameXml.includes('<a:tbl>') && (!id || id.test(frameXml)),
    frameXml => {
      const rowCount = frameXml.match(TABLE_ROW_RE)?.length ?? 0
      if (rowCount !== capacity + 1) {
        throw new Error(
          `[issue-analysis] 표 행 수가 ${rowCount}개입니다. 예상값은 ${capacity + 1}개입니다.`,
        )
      }
      if (!issues.length || issues.length > capacity) {
        throw new Error(
          `[issue-analysis] 표에 배치할 이슈 행 수가 ${issues.length}개입니다. 허용값은 1~${capacity}개입니다.`,
        )
      }
      let updated = setTableCellText(frameXml, 0, 3, '구분')
      for (let index = 0; index < issues.length; index += 1) {
        const values = issueRowValues(issues[index])
        for (let column = 0; column < values.length; column += 1) {
          updated = setTableCellText(
            updated,
            index + 1,
            column,
            values[column],
            undefined,
            column === 2 ? issues[index].bodyParagraphs : undefined,
          )
        }
      }
      const rows = updated.match(TABLE_ROW_RE) ?? []
      const heights = issueRowHeights(rows, issues)
      let rowIndex = -1
      return updated.replace(TABLE_ROW_RE, rowXml => {
        rowIndex += 1
        if (rowIndex === 0) return rowXml
        if (rowIndex > issues.length) return ''
        return setTableRowHeight(rowXml, heights[rowIndex - 1])
      })
    },
    shapeId ? `이슈 표 ${shapeId}` : '이슈 표',
  )
}

const CAUSE_CONTENT_TOP = 642_241
const CAUSE_CONTENT_BOTTOM = 6_250_000
const CAUSE_TABLE_GAP = 100_000
const CAUSE_ISSUE_TABLE_X = 279_578
const CAUSE_ISSUE_TABLE_WIDTH = 9_280_800
const CAUSE_ISSUE_HEADER_HEIGHT = 286_617
const CAUSE_TABLE_X = 287_762
const CAUSE_TABLE_WIDTH = 9_272_616
const CAUSE_HEADER_HEIGHT = 493_776
const CAUSE_MAX_UNIT_HEIGHT = 1_520_782

function replaceTableRows(tableXml: string, nextRows: readonly string[]): string {
  const rows = tableXml.match(TABLE_ROW_RE) ?? []
  if (!rows.length) throw new Error('[issue-analysis] 원인분석 표 행이 없습니다.')
  const start = tableXml.indexOf(rows[0]!)
  const last = rows.at(-1) ?? ''
  const endStart = tableXml.lastIndexOf(last)
  if (start < 0 || endStart < start) {
    throw new Error('[issue-analysis] 원인분석 표 행 범위를 찾을 수 없습니다.')
  }
  return `${tableXml.slice(0, start)}${nextRows.join('')}${tableXml.slice(endStart + last.length)}`
}

function withTableRowId(rowXml: string, value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('[issue-analysis] 동적 표 행 ID가 올바르지 않습니다.')
  }
  if (!/<a16:rowId\b[^>]*\bval="\d+"/.test(rowXml)) return rowXml
  return rowXml.replace(
    /(<a16:rowId\b[^>]*\bval=")\d+("[^>]*\/>)/,
    `$1${value}$2`,
  )
}

function causeCategoryText(cause: IssueAnalysisDeckCauseRow): string {
  if (cause.continuationCount === 1) return cause.categoryLabel
  return `${cause.categoryLabel}\n계속 ${cause.continuationIndex}/${cause.continuationCount}`
}

interface CauseSlideLayout {
  unitHeight: number
  issueBodyHeight: number
  issueFrameHeight: number
  causeY: number
  causeBodyHeights: number[]
  causeFrameHeight: number
}

function causeSlideLayout(
  issue: IssueAnalysisDeckIssueRow,
  causes: readonly IssueAnalysisDeckCauseRow[],
): CauseSlideLayout {
  const causeUnits = causes.reduce((sum, cause) => sum + cause.rowUnits, 0)
  const totalUnits = issue.rowUnits + causeUnits
  if (
    !causes.length
    || issue.rowUnits < 1
    || causeUnits < 1
    || totalUnits > ISSUE_ANALYSIS_CAUSE_PAGE_CAPACITY
  ) {
    throw new Error('[issue-analysis] 원인분석 페이지 높이 예산이 올바르지 않습니다.')
  }
  const bodyHeight = CAUSE_CONTENT_BOTTOM
    - CAUSE_CONTENT_TOP
    - CAUSE_ISSUE_HEADER_HEIGHT
    - CAUSE_HEADER_HEIGHT
    - CAUSE_TABLE_GAP
  const unitHeight = Math.min(
    CAUSE_MAX_UNIT_HEIGHT,
    Math.floor(bodyHeight / totalUnits),
  )
  if (unitHeight < 1) {
    throw new Error('[issue-analysis] 원인분석 표 높이를 계산할 수 없습니다.')
  }
  const issueBodyHeight = issue.rowUnits * unitHeight
  const issueFrameHeight = CAUSE_ISSUE_HEADER_HEIGHT + issueBodyHeight
  const causeY = CAUSE_CONTENT_TOP + issueFrameHeight + CAUSE_TABLE_GAP
  const causeBodyHeights = causes.map(cause => cause.rowUnits * unitHeight)
  const causeFrameHeight = CAUSE_HEADER_HEIGHT
    + causeBodyHeights.reduce((sum, height) => sum + height, 0)
  return {
    unitHeight,
    issueBodyHeight,
    issueFrameHeight,
    causeY,
    causeBodyHeights,
    causeFrameHeight,
  }
}

function resizeCauseIssueTable(
  slideXml: string,
  layout: CauseSlideLayout,
): string {
  return mapGraphicFrame(slideXml, '14', frameXml => {
    const rows = frameXml.match(TABLE_ROW_RE) ?? []
    if (rows.length !== 2) {
      throw new Error(`[issue-analysis] 원인분석 이슈 표 행이 ${rows.length}개입니다.`)
    }
    const nextRows = [
      setTableRowHeight(rows[0], CAUSE_ISSUE_HEADER_HEIGHT),
      setTableRowHeight(rows[1], layout.issueBodyHeight),
    ]
    return withGraphicFrameTransform(replaceTableRows(frameXml, nextRows), {
      x: CAUSE_ISSUE_TABLE_X,
      y: CAUSE_CONTENT_TOP,
      cx: CAUSE_ISSUE_TABLE_WIDTH,
      cy: layout.issueFrameHeight,
    })
  })
}

function fillCauseTable(
  slideXml: string,
  causes: readonly IssueAnalysisDeckCauseRow[],
  layout: CauseSlideLayout,
): string {
  return mapGraphicFrame(slideXml, '13', frameXml => {
    const sourceRows = frameXml.match(TABLE_ROW_RE) ?? []
    if (sourceRows.length !== 2) {
      throw new Error(`[issue-analysis] 원인분석 원인 표 행이 ${sourceRows.length}개입니다.`)
    }
    const header = setTableRowHeight(sourceRows[0], CAUSE_HEADER_HEIGHT)
    const prototype = sourceRows[1]
    const bodyRows = causes.map((cause, index) => withTableRowId(
      setTableRowHeight(prototype, layout.causeBodyHeights[index]),
      10_001 + index,
    ))
    let updated = replaceTableRows(frameXml, [header, ...bodyRows])
    for (let index = 0; index < causes.length; index += 1) {
      updated = setTableCellText(
        updated,
        index + 1,
        0,
        causeCategoryText(causes[index]),
      )
      updated = setTableCellText(
        updated,
        index + 1,
        1,
        causes[index].analysis,
        'cause-analysis',
      )
    }
    return withGraphicFrameTransform(updated, {
      x: CAUSE_TABLE_X,
      y: layout.causeY,
      cx: CAUSE_TABLE_WIDTH,
      cy: layout.causeFrameHeight,
    })
  })
}

function renderCauseAnalysisSlide(
  sourceXml: string,
  slide: Extract<IssueAnalysisDeckSlide, { kind: 'cause-analysis' }>,
  plan: IssueAnalysisDeckPlan,
  outputPage: number,
): string {
  const displayCauses: IssueAnalysisDeckCauseRow[] = slide.causes.length
    ? slide.causes
    : [{
        category: 'continuation',
        categoryLabel: '계속',
        analysis: `[원인 분석]\n${slide.causeDisplayMessage ?? ''}`,
        rowUnits: 1,
        continuationIndex: 1,
        continuationCount: 1,
      }]
  const layout = causeSlideLayout(slide.issue, displayCauses)
  const continuation = slide.pageCount > 1
    ? ` (${slide.pageInIssue}/${slide.pageCount})`
    : ''
  let xml = setPageFooter(sourceXml, outputPage, plan.meta.authorName)
  xml = setShapeText(
    xml,
    '146',
    `이슈별 원인 분석 – ${slide.megaCode}_${slide.megaName}${continuation}`,
    true,
  )
  xml = setShapeText(xml, '100', '2. 영역 별 이슈 및 원인 분석서')
  xml = fillIssueTable(xml, [slide.issue], 1, '14')
  xml = resizeCauseIssueTable(xml, layout)
  xml = fillCauseTable(xml, displayCauses, layout)
  return xml
}

const OPPORTUNITY_CONTENT_TOP = 1_680_000
const OPPORTUNITY_CONTENT_BOTTOM = 6_250_000
const OPPORTUNITY_BLOCK_GAP = 100_000
const OPPORTUNITY_ISSUE_GAP = 55_000
const OPPORTUNITY_MAX_UNIT_HEIGHT = 600_000
const OPPORTUNITY_CODE_X = 432_286
const OPPORTUNITY_CODE_WIDTH = 930_565
const OPPORTUNITY_TITLE_X = 1_429_229
const OPPORTUNITY_TITLE_WIDTH = 3_256_080
const OPPORTUNITY_BOX_X = 5_750_817
const OPPORTUNITY_BOX_WIDTH = 3_024_000
const OPPORTUNITY_BADGE_X = 5_749_829
const OPPORTUNITY_BADGE_WIDTH = 265_846
const OPPORTUNITY_BADGE_HEIGHT = 288_000

interface OpportunityBlockLayout {
  block: IssueAnalysisDeckOpportunityBlock
  y: number
  height: number
  unitHeight: number
}

function opportunityBlockLayouts(
  blocks: readonly IssueAnalysisDeckOpportunityBlock[],
): OpportunityBlockLayout[] {
  if (!blocks.length) throw new Error('[issue-analysis] 개선기회 페이지가 비어 있습니다.')
  const totalUnits = blocks.reduce((sum, block) => sum + block.rowUnits, 0)
  if (totalUnits < 1 || totalUnits > ISSUE_ANALYSIS_OPPORTUNITY_PAGE_CAPACITY) {
    throw new Error('[issue-analysis] 개선기회 페이지 높이 예산이 올바르지 않습니다.')
  }
  const contentHeight = OPPORTUNITY_CONTENT_BOTTOM - OPPORTUNITY_CONTENT_TOP
  const gapHeight = OPPORTUNITY_BLOCK_GAP * (blocks.length - 1)
  const unitHeight = Math.min(
    OPPORTUNITY_MAX_UNIT_HEIGHT,
    Math.floor((contentHeight - gapHeight) / totalUnits),
  )
  if (unitHeight < 1) {
    throw new Error('[issue-analysis] 개선기회 블록 높이를 계산할 수 없습니다.')
  }
  const usedHeight = totalUnits * unitHeight + gapHeight
  let y = OPPORTUNITY_CONTENT_TOP + Math.floor((contentHeight - usedHeight) / 2)
  return blocks.map(block => {
    const layout = { block, y, height: block.rowUnits * unitHeight, unitHeight }
    y += layout.height + OPPORTUNITY_BLOCK_GAP
    return layout
  })
}

function proportionalHeights(
  units: readonly number[],
  totalHeight: number,
  gap: number,
): number[] {
  if (!units.length) return []
  const available = totalHeight - gap * (units.length - 1)
  const totalUnits = units.reduce((sum, unit) => sum + unit, 0)
  if (available < units.length || totalUnits < 1) {
    throw new Error('[issue-analysis] 개선기회 이슈 행 높이를 계산할 수 없습니다.')
  }
  let remainingHeight = available
  let remainingUnits = totalUnits
  return units.map((unit, index) => {
    const height = index === units.length - 1
      ? remainingHeight
      : Math.floor((remainingHeight * unit) / remainingUnits)
    remainingHeight -= height
    remainingUnits -= unit
    return height
  })
}

function opportunityIssueCode(
  issue: IssueAnalysisDeckOpportunityBlock['issues'][number],
): string {
  if (issue.continuationCount === 1) return issue.piIssueCode
  return `${issue.piIssueCode}\n계속 ${issue.continuationIndex}/${issue.continuationCount}`
}

function renderOpportunitySlide(
  sourceXml: string,
  slide: Extract<IssueAnalysisDeckSlide, { kind: 'opportunity' }>,
  plan: IssueAnalysisDeckPlan,
  outputPage: number,
): string {
  const issueTitlePrototype = singleElementById(sourceXml, SHAPE_RE, '54', 'shape')
  const issueCodePrototype = singleElementById(sourceXml, SHAPE_RE, '55', 'shape')
  const opportunityPrototype = singleElementById(sourceXml, SHAPE_RE, '45', 'shape')
  const badgePrototype = singleElementById(sourceXml, SHAPE_RE, '46', 'shape')
  const connectorPrototype = singleElementById(sourceXml, CONNECTOR_RE, '71', 'connector')

  let xml = setPageFooter(sourceXml, outputPage, plan.meta.authorName, '3', '6')
  xml = setShapeText(
    xml,
    '89',
    `주요 이슈 및 개선 기회 (${slide.pageInSection}/${slide.pageCount})`,
  )
  xml = deleteGroupShape(xml, '47')
  for (const dynamicId of [
    '45', '46', '50', '54', '55', '57', '58', '60', '61', '63', '64',
    '71', '72', '73', '74',
  ]) {
    xml = deleteShapeOrConnector(xml, dynamicId)
  }

  let nextShapeId = 1_000
  const connectors: string[] = []
  const shapes: string[] = []
  for (const { block, y, height, unitHeight } of opportunityBlockLayouts(slide.blocks)) {
    const opportunityShapeId = nextShapeId
    nextShapeId += 1
    const badgeShapeId = nextShapeId
    nextShapeId += 1

    const opportunityHeight = Math.min(
      height,
      Math.max(2, block.opportunityUnits) * unitHeight,
    )
    const opportunityY = y + Math.floor((height - opportunityHeight) / 2)
    const continuation = block.continuationCount > 1
      ? ` (계속 ${block.continuationIndex}/${block.continuationCount})`
      : ''
    const opportunityText = [
      `${block.megaCode}-${block.megaName} · ${block.title}${continuation}`,
      block.description,
    ].filter(Boolean).join('\n')

    let opportunityShape = withElementId(opportunityPrototype, opportunityShapeId)
    opportunityShape = withElementTransform(opportunityShape, {
      x: OPPORTUNITY_BOX_X,
      y: opportunityY,
      cx: OPPORTUNITY_BOX_WIDTH,
      cy: opportunityHeight,
    })
    opportunityShape = setShapeElementText(
      opportunityShape,
      opportunityText,
      true,
      'opportunity',
    )
    opportunityShape = setShapeElementInset(opportunityShape, 'lIns', 360_000)
    shapes.push(opportunityShape)

    let badgeShape = withElementId(badgePrototype, badgeShapeId)
    badgeShape = withElementTransform(badgeShape, {
      x: OPPORTUNITY_BADGE_X,
      y: opportunityY,
      cx: OPPORTUNITY_BADGE_WIDTH,
      cy: Math.min(OPPORTUNITY_BADGE_HEIGHT, opportunityHeight),
    })
    badgeShape = setShapeElementText(badgeShape, block.opportunityNo)
    shapes.push(badgeShape)

    if (!block.issues.length) continue
    const issueContentHeight = Math.min(height, block.issueUnits * unitHeight)
    const issueHeights = proportionalHeights(
      block.issues.map(issue => issue.rowUnits),
      issueContentHeight,
      OPPORTUNITY_ISSUE_GAP,
    )
    let issueY = y + Math.floor((height - issueContentHeight) / 2)
    for (let index = 0; index < block.issues.length; index += 1) {
      const issue = block.issues[index]
      const issueHeight = issueHeights[index]
      const issueTitleShapeId = nextShapeId
      nextShapeId += 1
      const issueCodeShapeId = nextShapeId
      nextShapeId += 1
      const connectorShapeId = nextShapeId
      nextShapeId += 1

      let issueTitleShape = withElementId(issueTitlePrototype, issueTitleShapeId)
      issueTitleShape = withElementTransform(issueTitleShape, {
        x: OPPORTUNITY_TITLE_X,
        y: issueY,
        cx: OPPORTUNITY_TITLE_WIDTH,
        cy: issueHeight,
      })
      issueTitleShape = setShapeElementText(issueTitleShape, issue.title, true)
      shapes.push(issueTitleShape)

      let issueCodeShape = withElementId(issueCodePrototype, issueCodeShapeId)
      issueCodeShape = withElementTransform(issueCodeShape, {
        x: OPPORTUNITY_CODE_X,
        y: issueY,
        cx: OPPORTUNITY_CODE_WIDTH,
        cy: issueHeight,
      })
      issueCodeShape = setShapeElementText(issueCodeShape, opportunityIssueCode(issue), true)
      shapes.push(issueCodeShape)

      const issueCenterY = issueY + Math.floor(issueHeight / 2)
      const opportunityCenterY = opportunityY + Math.floor(opportunityHeight / 2)
      const connectorY = Math.min(issueCenterY, opportunityCenterY)
      let connector = withElementId(connectorPrototype, connectorShapeId)
      connector = withElementTransform(connector, {
        x: OPPORTUNITY_TITLE_X + OPPORTUNITY_TITLE_WIDTH,
        y: connectorY,
        cx: OPPORTUNITY_BOX_X - (OPPORTUNITY_TITLE_X + OPPORTUNITY_TITLE_WIDTH),
        cy: Math.abs(opportunityCenterY - issueCenterY),
        flipV: opportunityCenterY < issueCenterY,
      })
      connector = withConnectorTargets(
        connector,
        issueTitleShapeId,
        opportunityShapeId,
      )
      connectors.push(connector)
      issueY += issueHeight + OPPORTUNITY_ISSUE_GAP
    }
  }
  return appendShapeTreeElements(xml, [...connectors, ...shapes])
}

function renderSlide(
  sourceXml: string,
  slide: IssueAnalysisDeckSlide,
  plan: IssueAnalysisDeckPlan,
  outputPage: number,
): string {
  let xml = sourceXml
  switch (slide.kind) {
    case 'cover':
      xml = setCoverTitle(xml, slide.projectName)
      xml = setShapeText(xml, '5', `${slide.authorLine}｜${slide.dateLabel}`, true)
      break
    case 'contents':
      xml = setShapeText(
        xml,
        '16',
        '이슈 분석 Approach\n영역별 이슈 및 원인 분석\n개선기회 도출',
      )
      break
    case 'approach':
      xml = setPageFooter(xml, outputPage, plan.meta.authorName)
      break
    case 'process-tree':
      xml = renderProcessTreeSlide(sourceXml, slide, plan, outputPage)
      break
    case 'process-definition':
      xml = renderProcessDefinitionSlide(sourceXml, slide, plan, outputPage)
      break
    case 'area-summary':
      xml = setPageFooter(xml, outputPage, plan.meta.authorName)
      xml = setShapeText(
        xml,
        '146',
        `영역별 이슈 종합 – ${slide.megaCode}_${slide.megaName}`,
      )
      xml = setShapeText(xml, '100', '2. 영역 별 이슈 종합')
      xml = setShapeText(xml, '48', 'Mega')
      xml = setShapeText(xml, '49', `${slide.megaCode} ${slide.megaName}`)
      xml = setShapeText(xml, '51', slide.ownerDepartmentLines.join('\n'), true)
      xml = setShapeText(xml, '53', slide.relatedSystemLines.join('\n'), true)
      xml = fillIssueTable(xml, slide.issues, 3)
      break
    case 'area-summary-continuation':
      xml = setPageFooter(xml, outputPage, plan.meta.authorName)
      xml = setShapeText(
        xml,
        '146',
        `영역별 이슈 종합 – ${slide.megaCode}_${slide.megaName}`,
      )
      xml = setShapeText(xml, '100', '2. 영역 별 이슈 종합')
      xml = fillIssueTable(xml, slide.issues, 5)
      break
    case 'cause-analysis':
      xml = renderCauseAnalysisSlide(sourceXml, slide, plan, outputPage)
      break
    case 'opportunity':
      xml = renderOpportunitySlide(sourceXml, slide, plan, outputPage)
      break
  }
  return xml.replace(
    /<p14:creationId\b([^>]*)\bval="\d+"([^>]*)\/>/,
    `<p14:creationId$1val="${3_000_000_000 + outputPage}"$2/>`,
  )
}

function expectedSourceSlide(slide: IssueAnalysisDeckSlide): number {
  switch (slide.kind) {
    case 'cover': return 1
    case 'contents': return slide.sourceSlide
    case 'approach': return 3
    case 'process-tree': return 5
    case 'process-definition': return 6
    case 'area-summary': return 8
    case 'area-summary-continuation': return 9
    case 'cause-analysis': return 10
    case 'opportunity': return 12
    default: {
      const exhaustive: never = slide
      throw new Error(`[issue-analysis] 알 수 없는 슬라이드 유형입니다: ${String(exhaustive)}`)
    }
  }
}

function validatePlan(plan: IssueAnalysisDeckPlan): void {
  if (plan.schemaVersion !== 'issue-analysis-deck.v1') {
    throw new Error('[issue-analysis] 지원하지 않는 PPT 계획 버전입니다.')
  }
  if (!plan.slides.length || plan.slides[0]?.kind !== 'cover') {
    throw new Error('[issue-analysis] PPT 계획에 표지가 없습니다.')
  }
  plan.slides.forEach((slide, index) => {
    const expected = expectedSourceSlide(slide)
    if (slide.sourceSlide !== expected) {
      throw new Error(
        `[issue-analysis] 출력 ${index + 1}페이지의 원본 매핑이 올바르지 않습니다.`,
      )
    }
    if (
      slide.kind === 'contents'
      && !([2, 4, 11] as const).includes(slide.sourceSlide)
    ) {
      throw new Error(
        `[issue-analysis] 출력 ${index + 1}페이지의 목차 원본 매핑이 올바르지 않습니다.`,
      )
    }
    if (slide.kind === 'process-tree') {
      if (
        !slide.columns.length
        || slide.columns.length > ISSUE_ANALYSIS_TREE_COLUMN_CAPACITY
        || slide.pageInSeries < 1
        || slide.pageInSeries > slide.pageCount
        || !slide.headline
        || slide.columns.some(column =>
          !column.label
          || column.subs.length > ISSUE_ANALYSIS_TREE_SUB_CAPACITY
          || column.subs.some(sub => !sub))
      ) {
        throw new Error(
          `[issue-analysis] 출력 ${index + 1}페이지의 프로세스 트리 배치가 올바르지 않습니다.`,
        )
      }
    }
    if (slide.kind === 'process-definition') {
      if (
        !slide.rows.length
        || slide.rows.length > ISSUE_ANALYSIS_DEFINITION_ROW_CAPACITY
        || !slide.megaDefinition
        || !slide.headline
        || slide.pageInSeries < 1
        || slide.pageInSeries > slide.pageCount
        || slide.rows.some(row => !row.seqLabel || !row.name || !row.definition)
      ) {
        throw new Error(
          `[issue-analysis] 출력 ${index + 1}페이지의 프로세스 정의 배치가 올바르지 않습니다.`,
        )
      }
    }
    if (slide.kind === 'opportunity') {
      const usedUnits = slide.blocks.reduce((sum, block) => sum + block.rowUnits, 0)
      if (
        !slide.blocks.length
        || usedUnits < 1
        || usedUnits > ISSUE_ANALYSIS_OPPORTUNITY_PAGE_CAPACITY
        || slide.pageInSection < 1
        || slide.pageInSection > slide.pageCount
      ) {
        throw new Error(
          `[issue-analysis] 출력 ${index + 1}페이지의 개선기회 배치가 올바르지 않습니다.`,
        )
      }
      for (const block of slide.blocks) {
        const issueUnits = block.issues.reduce((sum, issue) => sum + issue.rowUnits, 0)
        if (
          block.issueUnits !== issueUnits
          || block.rowUnits < Math.max(2, block.issueUnits, block.opportunityUnits)
          || block.rowUnits > ISSUE_ANALYSIS_OPPORTUNITY_PAGE_CAPACITY
          || block.continuationIndex < 1
          || block.continuationIndex > block.continuationCount
        ) {
          throw new Error(
            `[issue-analysis] 개선기회 ${block.opportunityNo}의 높이 정보가 올바르지 않습니다.`,
          )
        }
      }
    }
    if (slide.kind === 'cause-analysis') {
      const causeUnits = slide.causes.reduce((sum, cause) => sum + cause.rowUnits, 0)
      const displayUnits = causeUnits || (slide.causeDisplayMessage ? 1 : 0)
      const usedUnits = slide.issue.rowUnits + displayUnits
      if (
        (!slide.causes.length && !slide.causeDisplayMessage)
        || usedUnits < 2
        || usedUnits > ISSUE_ANALYSIS_CAUSE_PAGE_CAPACITY
        || slide.pageInIssue < 1
        || slide.pageInIssue > slide.pageCount
        || slide.issue.id !== slide.issueId
        || slide.issue.piIssueCode !== slide.piIssueCode
      ) {
        throw new Error(
          `[issue-analysis] 출력 ${index + 1}페이지의 원인분석 배치가 올바르지 않습니다.`,
        )
      }
      for (const cause of slide.causes) {
        if (
          cause.rowUnits < 1
          || cause.continuationIndex < 1
          || cause.continuationIndex > cause.continuationCount
          || !cause.analysis
          || !cause.categoryLabel
        ) {
          throw new Error(
            `[issue-analysis] ${slide.piIssueCode} 원인분석 행 정보가 올바르지 않습니다.`,
          )
        }
      }
    }
  })

  const opportunitySlides = plan.slides.filter(slide => slide.kind === 'opportunity')
  if (
    !opportunitySlides.length
    || opportunitySlides.some((slide, index) =>
      slide.pageInSection !== index + 1
      || slide.pageCount !== opportunitySlides.length)
  ) {
    throw new Error('[issue-analysis] 개선기회 페이지 순서가 올바르지 않습니다.')
  }

  const causeSlidesByIssue = new Map<string, Array<Extract<
    IssueAnalysisDeckSlide,
    { kind: 'cause-analysis' }
  >>>()
  for (const slide of plan.slides) {
    if (slide.kind !== 'cause-analysis') continue
    const slides = causeSlidesByIssue.get(slide.issueId) ?? []
    slides.push(slide)
    causeSlidesByIssue.set(slide.issueId, slides)
  }
  for (const [issueId, slides] of causeSlidesByIssue) {
    if (slides.some((slide, index) =>
      slide.pageInIssue !== index + 1 || slide.pageCount !== slides.length)) {
      throw new Error(`[issue-analysis] ${issueId} 원인분석 페이지 순서가 올바르지 않습니다.`)
    }
  }
}

function slideMetadataTitle(slide: IssueAnalysisDeckSlide): string {
  switch (slide.kind) {
    case 'cover':
      return `${slide.projectName} (이슈 분석서)`
    case 'contents':
      if (slide.sourceSlide === 2) return '이슈 분석 목차'
      if (slide.sourceSlide === 4) return '영역별 이슈 및 원인 분석'
      return '개선기회 도출'
    case 'approach':
      return '이슈 분석 수행 방법'
    case 'process-tree':
      return `As-Is 프로세스 체계 – ${slide.megaCode}_${slide.megaName}`
    case 'process-definition':
      return `As-Is 프로세스 정의 – ${slide.megaCode}_${slide.megaName}`
    case 'area-summary':
    case 'area-summary-continuation':
      return `영역별 이슈 종합 – ${slide.megaCode}_${slide.megaName}`
    case 'cause-analysis':
      return `이슈별 원인 분석 – ${slide.piIssueCode} (${slide.pageInIssue}/${slide.pageCount})`
    case 'opportunity':
      return `이슈별 개선기회 도출 – ${slide.pageInSection}/${slide.pageCount}`
  }
}

function updateContentTypes(xml: string, slideCount: number): string {
  const withoutSlides = xml.replace(
    /<Override\b[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g,
    '',
  )
  const overrides = Array.from(
    { length: slideCount },
    (_, index) =>
      `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="${SLIDE_CONTENT_TYPE}"/>`,
  ).join('')
  if (!withoutSlides.includes('</Types>')) {
    throw new Error('[issue-analysis] [Content_Types].xml 구조가 올바르지 않습니다.')
  }
  return withoutSlides.replace('</Types>', `${overrides}</Types>`)
}

function updatePresentationRelationships(xml: string, slideCount: number): string {
  const withoutSlides = xml.replace(
    /<Relationship\b(?=[^>]*\bType="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/slide")(?=[^>]*\bTarget="slides\/slide\d+\.xml")[^>]*\/>/g,
    '',
  )
  const relationships = Array.from(
    { length: slideCount },
    (_, index) =>
      `<Relationship Id="rIdIssueSlide${index + 1}" Type="${SLIDE_RELATIONSHIP}" Target="slides/slide${index + 1}.xml"/>`,
  ).join('')
  if (!withoutSlides.includes('</Relationships>')) {
    throw new Error('[issue-analysis] presentation 관계 구조가 올바르지 않습니다.')
  }
  return withoutSlides.replace(
    '</Relationships>',
    `${relationships}</Relationships>`,
  )
}

function updatePresentation(xml: string, slideCount: number): string {
  const slideIds = Array.from(
    { length: slideCount },
    (_, index) =>
      `<p:sldId id="${1_000 + index}" r:id="rIdIssueSlide${index + 1}"/>`,
  ).join('')
  if (!/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/.test(xml)) {
    throw new Error('[issue-analysis] presentation 슬라이드 목록 구조가 올바르지 않습니다.')
  }
  return xml.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${slideIds}</p:sldIdLst>`,
  )
}

function updateCoreProperties(xml: string, plan: IssueAnalysisDeckPlan): string {
  const values: Record<string, string> = {
    'dc:title': `${plan.meta.projectName} 이슈 분석서`,
    'dc:creator': plan.meta.authorName,
    'cp:lastModifiedBy': plan.meta.authorName,
    'cp:revision': '1',
    'dcterms:modified': plan.generatedAt,
  }
  let updated = xml
  for (const [tag, value] of Object.entries(values)) {
    const re = new RegExp(`(<${tag}\\b[^>]*>)[\\s\\S]*?(<\\/${tag}>)`)
    updated = updated.replace(re, (_, open: string, close: string) =>
      `${open}${escapeXml(value)}${close}`)
  }
  return updated
}

function updateAppProperties(xml: string, plan: IssueAnalysisDeckPlan): string {
  const sourceSlideCount = Number(xml.match(/<Slides>(\d+)<\/Slides>/)?.[1] ?? 0)
  const slideCount = plan.slides.length
  let updated = xml.replace(
    /<Slides>\d+<\/Slides>/,
    `<Slides>${slideCount}</Slides>`,
  )
  updated = updated.replace(
    /(<vt:lpstr>슬라이드 제목<\/vt:lpstr>\s*<\/vt:variant>\s*<vt:variant>\s*<vt:i4>)\d+(<\/vt:i4>)/,
    (_, before: string, after: string) => `${before}${slideCount}${after}`,
  )

  const titlesBlock =
    /(<TitlesOfParts>\s*<vt:vector\b)([^>]*\bsize=")(\d+)("[^>]*>)([\s\S]*?)(<\/vt:vector>\s*<\/TitlesOfParts>)/
  updated = updated.replace(
    titlesBlock,
    (
      _,
      prefix: string,
      sizePrefix: string,
      _oldSize: string,
      openEnd: string,
      body: string,
      suffix: string,
    ) => {
      const entries = body.match(/<vt:lpstr>[\s\S]*?<\/vt:lpstr>/g) ?? []
      const staticCount = Math.max(0, entries.length - sourceSlideCount)
      const staticEntries = entries.slice(0, staticCount)
      const slideEntries = plan.slides.map(slide =>
        `<vt:lpstr>${escapeXml(slideMetadataTitle(slide))}</vt:lpstr>`)
      const allEntries = [...staticEntries, ...slideEntries]
      return `${prefix}${sizePrefix}${allEntries.length}${openEnd}${allEntries.join('')}${suffix}`
    },
  )
  return updated
}

async function requiredZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`[issue-analysis] 템플릿 구성 파일이 없습니다: ${path}`)
  return file.async('string')
}

function removeSourceSlideParts(zip: JSZip): void {
  for (const path of Object.keys(zip.files)) {
    if (
      /^ppt\/slides\/slide\d+\.xml$/.test(path)
      || /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(path)
    ) {
      zip.remove(path)
    }
  }
}

/**
 * 표준 PPTX 패키지의 원본 슬라이드를 복제하고 지정 shape/table만 치환한다.
 *
 * 사용자가 명시적으로 승인한 JSZip 운영 경로다. 레이아웃·테마·마스터·원본 서식은
 * 재작성하지 않으며, deckPlan의 sourceSlide 매핑만 허용한다.
 */
export async function renderIssueAnalysisPptFromTemplate(
  plan: IssueAnalysisDeckPlan,
  templateBytes: Uint8Array,
): Promise<Uint8Array> {
  validatePlan(plan)
  const zip = await JSZip.loadAsync(templateBytes)
  const sourceSlideNumbers = [...new Set(plan.slides.map(slide => slide.sourceSlide))]
  const sourceSlides = new Map<number, { xml: string; rels: string }>()
  for (const sourceSlide of sourceSlideNumbers) {
    sourceSlides.set(sourceSlide, {
      xml: await requiredZipText(zip, `ppt/slides/slide${sourceSlide}.xml`),
      rels: await requiredZipText(
        zip,
        `ppt/slides/_rels/slide${sourceSlide}.xml.rels`,
      ),
    })
  }

  let contentTypes = await requiredZipText(zip, '[Content_Types].xml')
  let presentation = await requiredZipText(zip, 'ppt/presentation.xml')
  let presentationRels = await requiredZipText(
    zip,
    'ppt/_rels/presentation.xml.rels',
  )
  let coreProperties = await requiredZipText(zip, 'docProps/core.xml')
  let appProperties = await requiredZipText(zip, 'docProps/app.xml')

  removeSourceSlideParts(zip)
  plan.slides.forEach((slide, index) => {
    const source = sourceSlides.get(slide.sourceSlide)
    if (!source) {
      throw new Error(
        `[issue-analysis] 원본 ${slide.sourceSlide}페이지를 불러오지 못했습니다.`,
      )
    }
    const outputPage = index + 1
    zip.file(
      `ppt/slides/slide${outputPage}.xml`,
      renderSlide(source.xml, slide, plan, outputPage),
    )
    zip.file(
      `ppt/slides/_rels/slide${outputPage}.xml.rels`,
      source.rels,
    )
  })

  contentTypes = updateContentTypes(contentTypes, plan.slides.length)
  presentation = updatePresentation(presentation, plan.slides.length)
  presentationRels = updatePresentationRelationships(
    presentationRels,
    plan.slides.length,
  )
  coreProperties = updateCoreProperties(coreProperties, plan)
  appProperties = updateAppProperties(appProperties, plan)

  zip.file('[Content_Types].xml', contentTypes)
  zip.file('ppt/presentation.xml', presentation)
  zip.file('ppt/_rels/presentation.xml.rels', presentationRels)
  zip.file('docProps/core.xml', coreProperties)
  zip.file('docProps/app.xml', appProperties)

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

export async function renderIssueAnalysisPptWithJsZip(
  plan: IssueAnalysisDeckPlan,
): Promise<Uint8Array> {
  const template = await readFile(ISSUE_ANALYSIS_TEMPLATE_PATH)
  return renderIssueAnalysisPptFromTemplate(plan, template)
}
