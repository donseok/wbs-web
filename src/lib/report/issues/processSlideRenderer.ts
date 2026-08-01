import 'server-only'

import { ISSUE_MEGA_AREAS } from '@/lib/domain/issueAnalysis'
import {
  CONNECTOR_RE,
  SHAPE_RE,
  appendShapeTreeElements,
  deleteShapeOrConnector,
  readElementTransform,
  setPageFooter,
  setShapeElementText,
  setShapeText,
  singleElementById,
  withElementId,
  withElementTransform,
  withoutConnectorTargets,
} from './slideXml'
import type {
  IssueAnalysisDeckProcessDefinitionSlide,
  IssueAnalysisDeckProcessTreeSlide,
} from './processPages'
import type { IssueAnalysisDeckPlan } from './deckPlan'

// 표준 템플릿 5번 슬라이드 실측 ID — docs/superpowers/plans/2026-08-02 파일 구조 맵 참조.
const TREE_TITLE_ID = '146'
const TREE_HEADLINE_ID = '145'
const TREE_TAG_ID = '100'
const TREE_MAJOR_BOX_IDS = ['116', '102', '111', '51', '70', '77', '103', '92'] as const
const TREE_CHEVRON_IDS = ['128', '125', '135', '126', '134', '127', '129', '130'] as const
const TREE_CHEVRON_ACTIVE_ID = '135'
const TREE_CHEVRON_INACTIVE_ID = '128'
const TREE_SUB_PROTOTYPE_ID = '108'
const TREE_SUB_SECOND_ID = '107'
// Sub 프로토타입(108)이 속한 열(2열)의 Major 슬롯 — 상대 오프셋 기준점.
const TREE_SUB_PROTOTYPE_COLUMN = 1
const TREE_SPINE_PROTOTYPE_ID = '101'
const TREE_CONNECTOR_IDS = [
  '55', '60', '63', '66', '69', '73', '76', '83', '91',
  '101', '105', '106', '114', '115', '117',
] as const
const TREE_SUB_BOX_IDS = [
  '53', '54', '71', '72', '78', '79', '80', '86', '87', '93', '94',
  '107', '108', '109', '110', '113', '118', '119', '120', '121', '123',
  '136', '137', '139',
] as const

function seriesSuffix(pageInSeries: number, pageCount: number): string {
  return pageCount > 1 ? ` (${pageInSeries}/${pageCount})` : ''
}

/**
 * 템플릿 5번 슬라이드의 8열 고정 지오메트리를 재사용한다. 셈플 도형(Sub·커넥터·
 * 체브론)을 전부 지우고 프로토타입 복제로 실데이터 열을 다시 세운다. 체브론 부채꼴
 * 커넥터는 활성 Mega가 영역마다 달라 재계산할 수 없으므로 직선 버스 배관(활성 체브론
 * 하강선 + 수평 버스 + 열 하강선 + 열 스파인)으로 대체한다.
 */
export function renderProcessTreeSlide(
  sourceXml: string,
  slide: IssueAnalysisDeckProcessTreeSlide,
  plan: IssueAnalysisDeckPlan,
  outputPage: number,
): string {
  if (slide.columns.length < 1 || slide.columns.length > TREE_MAJOR_BOX_IDS.length) {
    throw new Error('[issue-analysis] 프로세스 트리 열 수가 올바르지 않습니다.')
  }

  // 프로토타입·슬롯 좌표는 삭제 전에 원본에서 확보한다.
  const chevronSlots = TREE_CHEVRON_IDS.map(id =>
    readElementTransform(singleElementById(sourceXml, SHAPE_RE, id, 'shape')))
  const chevronActivePrototype =
    singleElementById(sourceXml, SHAPE_RE, TREE_CHEVRON_ACTIVE_ID, 'shape')
  const chevronInactivePrototype =
    singleElementById(sourceXml, SHAPE_RE, TREE_CHEVRON_INACTIVE_ID, 'shape')
  const majorSlots = TREE_MAJOR_BOX_IDS.map(id =>
    readElementTransform(singleElementById(sourceXml, SHAPE_RE, id, 'shape')))
  const subPrototype = singleElementById(sourceXml, SHAPE_RE, TREE_SUB_PROTOTYPE_ID, 'shape')
  const subBase = readElementTransform(subPrototype)
  const subPitch = readElementTransform(
    singleElementById(sourceXml, SHAPE_RE, TREE_SUB_SECOND_ID, 'shape'),
  ).y - subBase.y
  const subOffsetX = subBase.x - majorSlots[TREE_SUB_PROTOTYPE_COLUMN].x
  const linePrototype = withoutConnectorTargets(
    singleElementById(sourceXml, CONNECTOR_RE, TREE_SPINE_PROTOTYPE_ID, 'connector'),
  )
  const spineTop = readElementTransform(linePrototype).y
  if (subPitch < 1) {
    throw new Error('[issue-analysis] 프로세스 트리 Sub 행 간격을 읽을 수 없습니다.')
  }

  const activeIndex = ISSUE_MEGA_AREAS.findIndex(area => area.code === slide.megaCode)
  if (activeIndex < 0) {
    throw new Error(`[issue-analysis] 알 수 없는 Mega 코드입니다: ${slide.megaCode}`)
  }

  let xml = setPageFooter(sourceXml, outputPage, plan.meta.authorName)
  xml = setShapeText(
    xml,
    TREE_TITLE_ID,
    `As-Is 프로세스 체계 – ${slide.megaCode}_${slide.megaName}${seriesSuffix(slide.pageInSeries, slide.pageCount)}`,
    true,
  )
  xml = setShapeText(xml, TREE_TAG_ID, '2. 영역 별 이슈 및 원인 분석서')
  xml = setShapeText(xml, TREE_HEADLINE_ID, slide.headline, true)

  for (const id of TREE_CONNECTOR_IDS) xml = deleteShapeOrConnector(xml, id)
  for (const id of TREE_SUB_BOX_IDS) xml = deleteShapeOrConnector(xml, id)
  for (const id of TREE_CHEVRON_IDS) xml = deleteShapeOrConnector(xml, id)
  for (let slot = slide.columns.length; slot < TREE_MAJOR_BOX_IDS.length; slot += 1) {
    xml = deleteShapeOrConnector(xml, TREE_MAJOR_BOX_IDS[slot])
  }
  slide.columns.forEach((column, index) => {
    xml = setShapeText(xml, TREE_MAJOR_BOX_IDS[index], column.label, true)
  })

  let nextShapeId = 2_000
  const takeShapeId = () => {
    const id = nextShapeId
    nextShapeId += 1
    return id
  }
  const connectors: string[] = []
  const shapes: string[] = []

  // 체브론 8칸 — Mega 정본 라벨, 현재 영역만 활성 스타일 프로토타입.
  ISSUE_MEGA_AREAS.forEach((mega, index) => {
    const prototype = index === activeIndex
      ? chevronActivePrototype
      : chevronInactivePrototype
    let shape = withElementId(prototype, takeShapeId())
    shape = withElementTransform(shape, chevronSlots[index])
    shape = setShapeElementText(shape, `${mega.code}\n${mega.nameKo}`, true)
    shapes.push(shape)
  })

  // 배관 지오메트리 — 활성 체브론 하강선 + 수평 버스 + 열 하강선 + 열 스파인.
  const chevronBottom = chevronSlots[activeIndex].y + chevronSlots[activeIndex].cy
  const majorTop = majorSlots[0].y
  const busY = chevronBottom + Math.floor((majorTop - chevronBottom) / 2)
  const activeCenterX = chevronSlots[activeIndex].x
    + Math.floor(chevronSlots[activeIndex].cx / 2)
  const columnCenters = slide.columns.map((_, index) =>
    majorSlots[index].x + Math.floor(majorSlots[index].cx / 2))
  const line = (transform: { x: number; y: number; cx: number; cy: number }) => {
    let connector = withElementId(linePrototype, takeShapeId())
    connector = withElementTransform(connector, transform)
    connectors.push(connector)
  }
  line({ x: activeCenterX, y: chevronBottom, cx: 0, cy: busY - chevronBottom })
  const busStart = Math.min(activeCenterX, ...columnCenters)
  const busEnd = Math.max(activeCenterX, ...columnCenters)
  if (busEnd > busStart) line({ x: busStart, y: busY, cx: busEnd - busStart, cy: 0 })
  columnCenters.forEach((centerX, index) => {
    line({ x: centerX, y: busY, cx: 0, cy: majorSlots[index].y - busY })
  })

  // 열별 Sub 박스 + 스파인.
  slide.columns.forEach((column, index) => {
    const baseX = majorSlots[index].x + subOffsetX
    column.subs.forEach((sub, row) => {
      let shape = withElementId(subPrototype, takeShapeId())
      shape = withElementTransform(shape, {
        x: baseX,
        y: subBase.y + subPitch * row,
        cx: subBase.cx,
        cy: subBase.cy,
      })
      shape = setShapeElementText(shape, sub, true)
      shapes.push(shape)
    })
    if (column.subs.length) {
      const lastSubBottom = subBase.y + subPitch * (column.subs.length - 1) + subBase.cy
      line({
        x: columnCenters[index],
        y: spineTop,
        cx: 0,
        cy: Math.max(0, lastSubBottom - spineTop),
      })
    }
  })

  return appendShapeTreeElements(xml, [...connectors, ...shapes])
}

// 표준 템플릿 6번 슬라이드 실측 ID (7번은 6과 같은 레이아웃의 셈플 변형 — 미사용).
const DEFINITION_TITLE_ID = '146'
const DEFINITION_HEADLINE_ID = '145'
const DEFINITION_TAG_ID = '100'
const DEFINITION_MEGA_BOX_ID = '52'
const DEFINITION_MEGA_TEXT_ID = '49'
const DEFINITION_NAME_IDS = ['48', '56', '58', '60'] as const
const DEFINITION_TEXT_IDS = ['50', '57', '59', '61'] as const
const DEFINITION_CONNECTOR_IDS = ['65', '66', '67', '68'] as const

/** 템플릿 6번 슬라이드의 4행을 채우고 남는 행의 도형·커넥터를 지운다. */
export function renderProcessDefinitionSlide(
  sourceXml: string,
  slide: IssueAnalysisDeckProcessDefinitionSlide,
  plan: IssueAnalysisDeckPlan,
  outputPage: number,
): string {
  if (slide.rows.length < 1 || slide.rows.length > DEFINITION_NAME_IDS.length) {
    throw new Error('[issue-analysis] 프로세스 정의 행 수가 올바르지 않습니다.')
  }
  let xml = setPageFooter(sourceXml, outputPage, plan.meta.authorName)
  xml = setShapeText(
    xml,
    DEFINITION_TITLE_ID,
    `As-Is 프로세스 체계 – ${slide.megaCode}_${slide.megaName}${seriesSuffix(slide.pageInSeries, slide.pageCount)}`,
    true,
  )
  xml = setShapeText(xml, DEFINITION_TAG_ID, '2. 영역 별 이슈 및 원인 분석서')
  xml = setShapeText(xml, DEFINITION_HEADLINE_ID, slide.headline, true)
  xml = setShapeText(xml, DEFINITION_MEGA_BOX_ID, `${slide.megaCode}. ${slide.megaName}`, true)
  xml = setShapeText(xml, DEFINITION_MEGA_TEXT_ID, slide.megaDefinition, true)
  slide.rows.forEach((row, index) => {
    xml = setShapeText(xml, DEFINITION_NAME_IDS[index], `${row.seqLabel} ${row.name}`, true)
    xml = setShapeText(xml, DEFINITION_TEXT_IDS[index], row.definition, true)
  })
  for (let index = slide.rows.length; index < DEFINITION_NAME_IDS.length; index += 1) {
    xml = deleteShapeOrConnector(xml, DEFINITION_NAME_IDS[index])
    xml = deleteShapeOrConnector(xml, DEFINITION_TEXT_IDS[index])
    xml = deleteShapeOrConnector(xml, DEFINITION_CONNECTOR_IDS[index])
  }
  return xml
}
