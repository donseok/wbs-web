import 'server-only'

import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { ISSUE_ANALYSIS_TEMPLATE_PATH } from './template'
import type {
  IssueAnalysisDeckIssueRow,
  IssueAnalysisDeckPlan,
  IssueAnalysisDeckSlide,
} from './deckPlan'

const SLIDE_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
const SLIDE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'

const SHAPE_RE = /<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g
const CONNECTOR_RE = /<p:cxnSp\b[^>]*>[\s\S]*?<\/p:cxnSp>/g
const GRAPHIC_FRAME_RE = /<p:graphicFrame\b[^>]*>[\s\S]*?<\/p:graphicFrame>/g
const TABLE_ROW_RE = /<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g
const TABLE_CELL_RE = /<a:tc(?:\s[^>]*)?>[\s\S]*?<\/a:tc>/g
const PARAGRAPH_RE = /<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g
const PPR_RE = /<a:pPr\b[^>]*\/>|<a:pPr\b[\s\S]*?<\/a:pPr>/
const RPR_RE = /<a:rPr\b[^>]*\/>|<a:rPr\b[\s\S]*?<\/a:rPr>/
const END_RPR_RE =
  /<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>/

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function textNode(value: string): string {
  const space = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : ''
  return `<a:t${space}>${escapeXml(value)}</a:t>`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function shapeIdPattern(shapeId: string): RegExp {
  return new RegExp(
    `<p:cNvPr\\b[^>]*\\bid="${escapeRegExp(shapeId)}"(?=[\\s/>])`,
  )
}

function mapSingleXmlElement(
  xml: string,
  matcher: RegExp,
  predicate: (elementXml: string) => boolean,
  mapper: (elementXml: string) => string,
  label: string,
): string {
  let count = 0
  const updated = xml.replace(matcher, elementXml => {
    if (!predicate(elementXml)) return elementXml
    count += 1
    return mapper(elementXml)
  })
  if (count !== 1) {
    throw new Error(`[issue-analysis] ${label} 요소가 ${count}개입니다. 표준 템플릿을 확인하세요.`)
  }
  return updated
}

function mapShape(
  slideXml: string,
  shapeId: string,
  mapper: (shapeXml: string) => string,
): string {
  const id = shapeIdPattern(shapeId)
  return mapSingleXmlElement(
    slideXml,
    SHAPE_RE,
    shapeXml => id.test(shapeXml),
    mapper,
    `shape ${shapeId}`,
  )
}

function deleteShapeOrConnector(slideXml: string, shapeId: string): string {
  const id = shapeIdPattern(shapeId)
  let count = 0
  let updated = slideXml.replace(SHAPE_RE, shapeXml => {
    if (!id.test(shapeXml)) return shapeXml
    count += 1
    return ''
  })
  updated = updated.replace(CONNECTOR_RE, connectorXml => {
    if (!id.test(connectorXml)) return connectorXml
    count += 1
    return ''
  })
  if (count !== 1) {
    throw new Error(
      `[issue-analysis] 삭제 대상 shape/connector ${shapeId}가 ${count}개입니다. 표준 템플릿을 확인하세요.`,
    )
  }
  return updated
}

function toEndRunProperties(runProperties: string): string {
  return runProperties
    .replace(/^<a:rPr/, '<a:endParaRPr')
    .replace(/<\/a:rPr>$/, '</a:endParaRPr>')
}

function toRunProperties(endProperties: string): string {
  return endProperties
    .replace(/^<a:endParaRPr/, '<a:rPr')
    .replace(/<\/a:endParaRPr>$/, '</a:rPr>')
}

type ParagraphKind = 'plain' | 'heading' | 'bullet'
type TextBodyMode = 'plain' | 'issue-body'

const BULLET_PROPERTIES_RE = new RegExp([
  '<a:bu(?:ClrTx|SzTx|FontTx|None)\\b[^>]*\\/>',
  '<a:bu(?:Clr|SzPct|SzPts|Font|AutoNum|Char)\\b[^>]*\\/>',
  '<a:buBlip\\b[\\s\\S]*?<\\/a:buBlip>',
].join('|'), 'g')

function appendParagraphProperty(pPr: string, property: string): string {
  if (!pPr) return `<a:pPr>${property}</a:pPr>`
  if (/\/>$/.test(pPr)) return pPr.replace(/\/>$/, `>${property}</a:pPr>`)
  return pPr.replace('</a:pPr>', `${property}</a:pPr>`)
}

function withoutBullet(pPr: string): string {
  const cleaned = pPr
    .replace(BULLET_PROPERTIES_RE, '')
    .replace(/\s(?:marL|indent)="-?\d+"/g, '')
  return appendParagraphProperty(cleaned, '<a:buNone/>')
}

function withBullet(pPr: string): string {
  const cleaned = pPr.replace(/<a:buNone\b[^>]*\/>/g, '')
  if (/<a:bu(?:AutoNum|Char|Blip)\b/.test(cleaned)) return cleaned
  return appendParagraphProperty(cleaned, '<a:buChar char="•"/>')
}

function withBold(runProperties: string): string {
  if (/\bb="[01]"/.test(runProperties)) {
    return runProperties.replace(/\bb="[01]"/, 'b="1"')
  }
  return runProperties.replace(/^<a:rPr\b/, '<a:rPr b="1"')
}

function rebuildParagraph(
  paragraphXml: string,
  value: string,
  kind: ParagraphKind = 'plain',
): string {
  const open = paragraphXml.match(/^<a:p(?:\s[^>]*)?>/)?.[0] ?? '<a:p>'
  const sourcePPr = paragraphXml.match(PPR_RE)?.[0] ?? ''
  const pPr = kind === 'bullet' ? withBullet(sourcePPr) : withoutBullet(sourcePPr)
  const sourceEnd = paragraphXml.match(END_RPR_RE)?.[0] ?? ''
  const sourceRPr = paragraphXml.match(RPR_RE)?.[0]
    ?? (sourceEnd ? toRunProperties(sourceEnd) : '<a:rPr/>')
  const rPr = kind === 'heading' ? withBold(sourceRPr) : sourceRPr
  const end = sourceEnd || toEndRunProperties(rPr)
  if (!value) return `${open}${pPr}${end}</a:p>`
  return `${open}${pPr}<a:r>${rPr}${textNode(value)}</a:r>${end}</a:p>`
}

function withNormalAutofit(bodyPrXml: string): string {
  const withoutAutofit = bodyPrXml.replace(
    /<a:(?:noAutofit|normAutofit|spAutoFit)\b[^>]*\/>/g,
    '',
  )
  if (/\/>$/.test(withoutAutofit)) {
    return withoutAutofit.replace(/\/>$/, '><a:normAutofit/></a:bodyPr>')
  }
  if (!/<\/a:bodyPr>$/.test(withoutAutofit)) {
    throw new Error('[issue-analysis] 텍스트 자동 맞춤 구조가 올바르지 않습니다.')
  }
  return withoutAutofit.replace('</a:bodyPr>', '<a:normAutofit/></a:bodyPr>')
}

function rebuildTextBody(
  textBodyXml: string,
  value: string,
  normalAutofit = false,
  mode: TextBodyMode = 'plain',
): string {
  const open = textBodyXml.match(/^<(?:p|a):txBody\b[^>]*>/)?.[0]
  const close = textBodyXml.match(/<\/(?:p|a):txBody>$/)?.[0]
  if (!open || !close) throw new Error('[issue-analysis] 텍스트 본문 구조가 올바르지 않습니다.')

  const sourceBodyPr = textBodyXml.match(
    /<a:bodyPr\b[^>]*\/>|<a:bodyPr\b[\s\S]*?<\/a:bodyPr>/,
  )?.[0] ?? '<a:bodyPr/>'
  const bodyPr = normalAutofit ? withNormalAutofit(sourceBodyPr) : sourceBodyPr
  const listStyle = textBodyXml.match(
    /<a:lstStyle\b[^>]*\/>|<a:lstStyle\b[\s\S]*?<\/a:lstStyle>/,
  )?.[0] ?? '<a:lstStyle/>'
  const sourceParagraphs = textBodyXml.match(PARAGRAPH_RE) ?? []
  if (!sourceParagraphs.length) {
    throw new Error('[issue-analysis] 텍스트 본문에 서식 문단이 없습니다.')
  }

  const lines = value.split(/\r?\n/)
  const paragraphs = lines.map((line, index) => {
    let valueForLine = line
    let kind: ParagraphKind = 'plain'
    if (mode === 'issue-body') {
      if (/^\[(?:현황|문제[·/]영향|필요 조치)\]$/.test(line.trim())) {
        kind = 'heading'
      } else if (/^-\s+\S/.test(line.trimStart())) {
        kind = 'bullet'
        valueForLine = line.trimStart().replace(/^-\s+/, '')
      }
    }
    return rebuildParagraph(
      sourceParagraphs[Math.min(index, sourceParagraphs.length - 1)],
      valueForLine,
      kind,
    )
  })
  return `${open}${bodyPr}${listStyle}${paragraphs.join('')}${close}`
}

function setShapeText(
  slideXml: string,
  shapeId: string,
  value: string | number,
  normalAutofit = false,
): string {
  return mapShape(slideXml, shapeId, shapeXml => {
    const textBody = shapeXml.match(/<p:txBody\b[^>]*>[\s\S]*?<\/p:txBody>/)?.[0]
    if (!textBody) {
      throw new Error(`[issue-analysis] shape ${shapeId}에 텍스트 본문이 없습니다.`)
    }
    return shapeXml.replace(
      textBody,
      () => rebuildTextBody(textBody, String(value), normalAutofit),
    )
  })
}

function setShapeTextInset(
  slideXml: string,
  shapeId: string,
  side: 'lIns' | 'rIns',
  value: number,
): string {
  return mapShape(slideXml, shapeId, shapeXml => {
    const textBody = shapeXml.match(/<p:txBody\b[^>]*>[\s\S]*?<\/p:txBody>/)?.[0]
    const bodyPr = textBody?.match(
      /<a:bodyPr\b[^>]*\/>|<a:bodyPr\b[\s\S]*?<\/a:bodyPr>/,
    )?.[0]
    if (!textBody || !bodyPr) {
      throw new Error(`[issue-analysis] shape ${shapeId}의 텍스트 여백을 찾을 수 없습니다.`)
    }
    const sidePattern = new RegExp(`\\b${side}="\\d+"`)
    const updatedBodyPr = sidePattern.test(bodyPr)
      ? bodyPr.replace(sidePattern, `${side}="${value}"`)
      : bodyPr.replace('<a:bodyPr', `<a:bodyPr ${side}="${value}"`)
    return shapeXml.replace(
      textBody,
      () => textBody.replace(bodyPr, () => updatedBodyPr),
    )
  })
}

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
      rowIndex > 0 && columnIndex === 2 ? 'issue-body' : 'plain',
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
): string {
  return mapSingleXmlElement(
    slideXml,
    GRAPHIC_FRAME_RE,
    frameXml => frameXml.includes('<a:tbl>'),
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
          updated = setTableCellText(updated, index + 1, column, values[column])
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
    '이슈 표',
  )
}

function setPageFooter(
  slideXml: string,
  pageNumber: number,
  authorName: string,
  pageShapeId = '5',
  footerShapeId = '6',
): string {
  let updated = setShapeText(slideXml, pageShapeId, pageNumber)
  updated = setShapeText(updated, footerShapeId, `작성자_${authorName}`, true)
  return updated
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
        '이슈 분석 Approach\n영역별 이슈 종합\n개선기회 도출',
      )
      break
    case 'approach':
      xml = setPageFooter(xml, outputPage, plan.meta.authorName)
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
    case 'opportunity': {
      xml = setPageFooter(xml, outputPage, plan.meta.authorName, '3', '6')
      xml = setShapeText(xml, '89', `${slide.megaCode}-${slide.megaName}`)
      xml = setShapeText(xml, '45', `${slide.title}\n${slide.description}`, true)
      // 개선기회 번호 배지가 상자 왼쪽 위를 덮는 원본 구조이므로 본문만 안쪽으로 이동한다.
      xml = setShapeTextInset(xml, '45', 'lIns', 360_000)
      xml = setShapeText(xml, '46', slide.opportunityNo)
      const cardIds = [
        { title: '48', code: '49', connector: '50' },
        { title: '54', code: '55', connector: '71' },
        { title: '57', code: '58', connector: '72' },
        { title: '60', code: '61', connector: '73' },
        { title: '63', code: '64', connector: '74' },
      ]
      for (let index = 0; index < cardIds.length; index += 1) {
        const card = cardIds[index]
        const issue = slide.issues[index]
        if (issue) {
          xml = setShapeText(xml, card.title, issue.title, true)
          xml = setShapeText(xml, card.code, issue.piIssueCode)
        } else {
          xml = deleteShapeOrConnector(xml, card.title)
          xml = deleteShapeOrConnector(xml, card.code)
          xml = deleteShapeOrConnector(xml, card.connector)
        }
      }
      break
    }
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
    case 'area-summary': return 8
    case 'area-summary-continuation': return 9
    case 'opportunity': return 12
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
  })
}

function slideMetadataTitle(slide: IssueAnalysisDeckSlide): string {
  switch (slide.kind) {
    case 'cover':
      return `${slide.projectName} (이슈 분석서)`
    case 'contents':
      if (slide.sourceSlide === 2) return '이슈 분석 목차'
      if (slide.sourceSlide === 4) return '영역별 이슈 종합'
      return '개선기회 도출'
    case 'approach':
      return '이슈 분석 수행 방법'
    case 'area-summary':
    case 'area-summary-continuation':
      return `영역별 이슈 종합 – ${slide.megaCode}_${slide.megaName}`
    case 'opportunity':
      return `이슈별 개선기회 도출 – ${slide.opportunityNo}. ${slide.title}`
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
