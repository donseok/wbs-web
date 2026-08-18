import 'server-only'

import type { IssueAnalysisDeckBodyParagraph } from './deckPlan'
// 사본 정리 — 정본은 ../xml(제어문자 제거 포함 동일 구현). 기존 importer 경로 유지를 위해 re-export.
import { escapeXml } from '../xml'
export { escapeXml }

export const SHAPE_RE = /<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g
export const GROUP_SHAPE_RE = /<p:grpSp\b[^>]*>[\s\S]*?<\/p:grpSp>/g
export const CONNECTOR_RE = /<p:cxnSp\b[^>]*>[\s\S]*?<\/p:cxnSp>/g
export const GRAPHIC_FRAME_RE = /<p:graphicFrame\b[^>]*>[\s\S]*?<\/p:graphicFrame>/g
export const TABLE_ROW_RE = /<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g
export const TABLE_CELL_RE = /<a:tc(?:\s[^>]*)?>[\s\S]*?<\/a:tc>/g
export const PARAGRAPH_RE = /<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g
export const PPR_RE = /<a:pPr\b[^>]*\/>|<a:pPr\b[\s\S]*?<\/a:pPr>/
export const RPR_RE = /<a:rPr\b[^>]*\/>|<a:rPr\b[\s\S]*?<\/a:rPr>/
export const END_RPR_RE =
  /<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>/

export function textNode(value: string): string {
  const space = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : ''
  return `<a:t${space}>${escapeXml(value)}</a:t>`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function shapeIdPattern(shapeId: string): RegExp {
  return new RegExp(
    `<p:cNvPr\\b[^>]*\\bid="${escapeRegExp(shapeId)}"(?=[\\s/>])`,
  )
}

export function mapSingleXmlElement(
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

export function mapShape(
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

export function mapGraphicFrame(
  slideXml: string,
  shapeId: string,
  mapper: (frameXml: string) => string,
): string {
  const id = shapeIdPattern(shapeId)
  return mapSingleXmlElement(
    slideXml,
    GRAPHIC_FRAME_RE,
    frameXml => id.test(frameXml),
    mapper,
    `graphicFrame ${shapeId}`,
  )
}

export function deleteShapeOrConnector(slideXml: string, shapeId: string): string {
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

export function singleElementById(
  xml: string,
  matcher: RegExp,
  shapeId: string,
  label: string,
): string {
  const id = shapeIdPattern(shapeId)
  const matches = (xml.match(matcher) ?? []).filter(elementXml => id.test(elementXml))
  if (matches.length !== 1) {
    throw new Error(
      `[issue-analysis] ${label} ${shapeId} 요소가 ${matches.length}개입니다. 표준 템플릿을 확인하세요.`,
    )
  }
  return matches[0]
}

export function deleteGroupShape(slideXml: string, shapeId: string): string {
  const id = shapeIdPattern(shapeId)
  let count = 0
  const updated = slideXml.replace(GROUP_SHAPE_RE, groupXml => {
    if (!id.test(groupXml)) return groupXml
    count += 1
    return ''
  })
  if (count !== 1) {
    throw new Error(
      `[issue-analysis] 삭제 대상 group ${shapeId}가 ${count}개입니다. 표준 템플릿을 확인하세요.`,
    )
  }
  return updated
}

export function withElementId(elementXml: string, shapeId: number): string {
  if (!Number.isSafeInteger(shapeId) || shapeId < 1) {
    throw new Error('[issue-analysis] 동적 shape ID가 올바르지 않습니다.')
  }
  let count = 0
  const updated = elementXml.replace(
    /(<p:cNvPr\b[^>]*\bid=")\d+("(?=[\s/>]))/,
    (_, before: string, after: string) => {
      count += 1
      return `${before}${shapeId}${after}`
    },
  )
  if (count !== 1) {
    throw new Error('[issue-analysis] 동적 shape의 ID를 변경할 수 없습니다.')
  }
  return updated
}

export interface ElementTransform {
  x: number
  y: number
  cx: number
  cy: number
  flipV?: boolean
}

export function withGraphicFrameTransform(
  frameXml: string,
  transform: Omit<ElementTransform, 'flipV'>,
): string {
  for (const value of [transform.x, transform.y, transform.cx, transform.cy]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('[issue-analysis] 동적 표 좌표가 올바르지 않습니다.')
    }
  }
  const source = frameXml.match(/<p:xfrm\b[^>]*>[\s\S]*?<\/p:xfrm>/)?.[0]
  if (!source) throw new Error('[issue-analysis] 동적 표의 좌표 구조가 없습니다.')
  const updated = source
    .replace(/<a:off\b[^>]*\/>/, `<a:off x="${transform.x}" y="${transform.y}"/>`)
    .replace(/<a:ext\b[^>]*\/>/, `<a:ext cx="${transform.cx}" cy="${transform.cy}"/>`)
  return frameXml.replace(source, () => updated)
}

export function withElementTransform(elementXml: string, transform: ElementTransform): string {
  for (const value of [transform.x, transform.y, transform.cx, transform.cy]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('[issue-analysis] 동적 shape 좌표가 올바르지 않습니다.')
    }
  }
  const source = elementXml.match(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/)?.[0]
  if (!source) throw new Error('[issue-analysis] 동적 shape의 좌표 구조가 없습니다.')

  const open = source.match(/^<a:xfrm\b[^>]*>/)?.[0]
  if (!open) throw new Error('[issue-analysis] 동적 shape의 좌표 시작 태그가 없습니다.')
  let nextOpen = open.replace(/\sflipV="[01]"/g, '')
  if (transform.flipV) nextOpen = nextOpen.replace(/>$/, ' flipV="1">')
  let updated = source.replace(open, nextOpen)
  updated = updated.replace(
    /<a:off\b[^>]*\/>/,
    `<a:off x="${transform.x}" y="${transform.y}"/>`,
  )
  updated = updated.replace(
    /<a:ext\b[^>]*\/>/,
    `<a:ext cx="${transform.cx}" cy="${transform.cy}"/>`,
  )
  return elementXml.replace(source, updated)
}

export function withConnectorTargets(
  connectorXml: string,
  startShapeId: number,
  endShapeId: number,
): string {
  let updated = connectorXml.replace(
    /<a:stCxn\b[^>]*\/>/,
    `<a:stCxn id="${startShapeId}" idx="3"/>`,
  )
  updated = updated.replace(
    /<a:endCxn\b[^>]*\/>/,
    `<a:endCxn id="${endShapeId}" idx="1"/>`,
  )
  return updated
}

export function appendShapeTreeElements(slideXml: string, elements: readonly string[]): string {
  if (!slideXml.includes('</p:spTree>')) {
    throw new Error('[issue-analysis] 슬라이드 shape tree가 없습니다.')
  }
  return slideXml.replace(
    '</p:spTree>',
    () => `${elements.join('')}</p:spTree>`,
  )
}

export function toEndRunProperties(runProperties: string): string {
  return runProperties
    .replace(/^<a:rPr/, '<a:endParaRPr')
    .replace(/<\/a:rPr>$/, '</a:endParaRPr>')
}

export function toRunProperties(endProperties: string): string {
  return endProperties
    .replace(/^<a:endParaRPr/, '<a:rPr')
    .replace(/<\/a:endParaRPr>$/, '</a:rPr>')
}

type ParagraphKind = 'plain' | 'heading' | 'body' | 'bullet'
export type TextBodyMode = 'plain' | 'issue-body' | 'cause-analysis' | 'opportunity'

const BULLET_PROPERTIES_RE = new RegExp([
  '<a:bu(Clr|Blip)\\b[^>]*>[\\s\\S]*?<\\/a:bu\\1>',
  '<a:bu(?:ClrTx|SzTx|FontTx|None)\\b[^>]*\\/>',
  '<a:bu(?:Clr|SzPct|SzPts|Font|AutoNum|Char|Blip)\\b[^>]*\\/>',
].join('|'), 'g')

function insertParagraphBulletChoice(pPr: string, bullet: string): string {
  if (!pPr) return `<a:pPr>${bullet}</a:pPr>`
  const expanded = /\/>$/.test(pPr)
    ? pPr.replace(/\/>$/, '></a:pPr>')
    : pPr
  return expanded.replace(
    /(?=<a:(?:tabLst|defRPr|extLst)\b|<\/a:pPr>)/,
    bullet,
  )
}

function withoutBullet(pPr: string): string {
  const cleaned = pPr
    .replace(BULLET_PROPERTIES_RE, '')
    .replace(/\s(?:marL|indent|lvl)="-?\d+"/g, '')
  return insertParagraphBulletChoice(cleaned, '<a:buNone/>')
}

function withIssueParagraphLevel(
  pPr: string,
  level: 0 | 1,
  hanging: boolean,
): string {
  const marginLeft = level === 0 ? 171_450 : 358_775
  const indent = hanging ? (level === 0 ? -171_450 : -184_150) : 0
  return withoutBullet(pPr).replace(
    /^<a:pPr\b/,
    `<a:pPr marL="${marginLeft}" indent="${indent}" lvl="${level}"`,
  )
}

function withBullet(pPr: string): string {
  const cleaned = pPr.replace(BULLET_PROPERTIES_RE, '')
  return insertParagraphBulletChoice(cleaned, '<a:buChar char="•"/>')
}

function withBold(runProperties: string): string {
  if (/\bb="[01]"/.test(runProperties)) {
    return runProperties.replace(/\bb="[01]"/, 'b="1"')
  }
  return runProperties.replace(/^<a:rPr\b/, '<a:rPr b="1"')
}

function withoutBold(runProperties: string): string {
  if (/\bb="[01]"/.test(runProperties)) {
    return runProperties.replace(/\bb="[01]"/, 'b="0"')
  }
  return runProperties.replace(/^<a:rPr\b/, '<a:rPr b="0"')
}

function rebuildParagraph(
  paragraphXml: string,
  value: string,
  kind: ParagraphKind = 'plain',
  issueLevel?: 0 | 1,
  issueMarker = false,
): string {
  const open = paragraphXml.match(/^<a:p(?:\s[^>]*)?>/)?.[0] ?? '<a:p>'
  const sourcePPr = paragraphXml.match(PPR_RE)?.[0] ?? ''
  const pPr = kind === 'bullet'
    ? withBullet(sourcePPr)
    : issueLevel === undefined
      ? withoutBullet(sourcePPr)
      : withIssueParagraphLevel(sourcePPr, issueLevel, issueMarker)
  const sourceEnd = paragraphXml.match(END_RPR_RE)?.[0] ?? ''
  const sourceRPr = paragraphXml.match(RPR_RE)?.[0]
    ?? (sourceEnd ? toRunProperties(sourceEnd) : '<a:rPr/>')
  const rPr = kind === 'heading'
    ? withBold(sourceRPr)
    : kind === 'body'
      ? withoutBold(sourceRPr)
      : sourceRPr
  const end = sourceEnd || toEndRunProperties(rPr)
  if (!value) return `${open}${pPr}${end}</a:p>`
  return `${open}${pPr}<a:r>${rPr}${textNode(value)}</a:r>${end}</a:p>`
}

export function withNormalAutofit(bodyPrXml: string): string {
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

export function rebuildTextBody(
  textBodyXml: string,
  value: string,
  normalAutofit = false,
  mode: TextBodyMode = 'plain',
  issueParagraphs?: readonly IssueAnalysisDeckBodyParagraph[],
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

  if (mode === 'issue-body' && issueParagraphs?.length) {
    const paragraphs = issueParagraphs.map((paragraph, index) => {
      const marker = paragraph.marker === 'bullet'
        ? '• '
        : paragraph.marker === 'check'
          ? '✓ '
          : ''
      return rebuildParagraph(
        sourceParagraphs[Math.min(index, sourceParagraphs.length - 1)],
        `${marker}${paragraph.text}`,
        paragraph.heading ? 'heading' : 'body',
        paragraph.heading ? undefined : paragraph.level,
        paragraph.marker !== null,
      )
    })
    return `${open}${bodyPr}${listStyle}${paragraphs.join('')}${close}`
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
    } else if (mode === 'cause-analysis') {
      if (/^\[(?:직접 원인|근본 원인|원인 분석)\]$/.test(line.trim())) {
        kind = 'heading'
      } else if (line.trim()) {
        // 원본 원인 표의 Wingdings `§` 글머리표는 LibreOffice 등에서 가위
        // 기호로 치환될 수 있어 텍스트 글머리표로 고정한다.
        kind = 'body'
        valueForLine = `• ${line.trim()}`
      }
    } else if (mode === 'opportunity') {
      kind = index === 0 ? 'heading' : 'body'
    }
    return rebuildParagraph(
      sourceParagraphs[Math.min(index, sourceParagraphs.length - 1)],
      valueForLine,
      kind,
    )
  })
  return `${open}${bodyPr}${listStyle}${paragraphs.join('')}${close}`
}

export function setShapeElementText(
  shapeXml: string,
  value: string | number,
  normalAutofit = false,
  mode: TextBodyMode = 'plain',
): string {
  const textBody = shapeXml.match(/<p:txBody\b[^>]*>[\s\S]*?<\/p:txBody>/)?.[0]
  if (!textBody) throw new Error('[issue-analysis] 동적 shape에 텍스트 본문이 없습니다.')
  return shapeXml.replace(
    textBody,
    () => rebuildTextBody(textBody, String(value), normalAutofit, mode),
  )
}

export function setShapeText(
  slideXml: string,
  shapeId: string,
  value: string | number,
  normalAutofit = false,
): string {
  return mapShape(
    slideXml,
    shapeId,
    shapeXml => setShapeElementText(shapeXml, value, normalAutofit),
  )
}

export function setShapeElementInset(
  shapeXml: string,
  side: 'lIns' | 'rIns',
  value: number,
): string {
  const textBody = shapeXml.match(/<p:txBody\b[^>]*>[\s\S]*?<\/p:txBody>/)?.[0]
  const bodyPr = textBody?.match(
    /<a:bodyPr\b[^>]*\/>|<a:bodyPr\b[\s\S]*?<\/a:bodyPr>/,
  )?.[0]
  if (!textBody || !bodyPr) {
    throw new Error('[issue-analysis] 동적 shape의 텍스트 여백을 찾을 수 없습니다.')
  }
  const sidePattern = new RegExp(`\\b${side}="\\d+"`)
  const updatedBodyPr = sidePattern.test(bodyPr)
    ? bodyPr.replace(sidePattern, `${side}="${value}"`)
    : bodyPr.replace('<a:bodyPr', `<a:bodyPr ${side}="${value}"`)
  return shapeXml.replace(
    textBody,
    () => textBody.replace(bodyPr, () => updatedBodyPr),
  )
}

export function setPageFooter(
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

/** 프로토타입 복제 시 원본 슬롯 좌표를 읽기 위한 xfrm 파서. */
export function readElementTransform(
  elementXml: string,
): { x: number; y: number; cx: number; cy: number } {
  const source = elementXml.match(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/)?.[0]
  const off = source?.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/)
  const ext = source?.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/)
  if (!off || !ext) {
    throw new Error('[issue-analysis] shape 좌표 구조를 읽을 수 없습니다.')
  }
  return {
    x: Number(off[1]),
    y: Number(off[2]),
    cx: Number(ext[1]),
    cy: Number(ext[2]),
  }
}

/**
 * 복제 커넥터의 원본 도형 참조를 끊는다. 참조 대상이 삭제된 채 남으면
 * PowerPoint가 임의 재접속하거나 복구 대화를 띄울 수 있다.
 */
export function withoutConnectorTargets(connectorXml: string): string {
  return connectorXml
    .replace(/<a:stCxn\b[^>]*\/>/, '')
    .replace(/<a:endCxn\b[^>]*\/>/, '')
}
