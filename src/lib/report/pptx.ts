import PptxGenJS from 'pptxgenjs'
import type { WeeklyReportModel } from './weekly'
import { buildWeeklyNarrative, type NarrativeGroup, type NarrativeModel } from './narrative'
import { PN } from './dkbrand'
import { LOGO_PNG, WATERMARK_PNG } from './assets/reportImages'

/* 동국씨엠 공식 주간보고 양식(참조 재현). A4 가로 · 본고딕 · DK 네이비/레드. */
const FONTS = { bold: '본고딕 Bold', medium: '본고딕 Medium', normal: '본고딕 Normal' } as const
const COMPANY = '동국씨엠'
const W = 10.833
const H = 7.5
const BODY_L = 0.30
const BODY_W = 10.23
const TABLE_Y = 0.75
const TABLE_BODY_H = 3.94        // 본문 활동 표 본체 행 높이(고정)
const LINE_BUDGET = 16           // 활동 컬럼 페이지당 최대 줄 수(초과 시 다음 슬라이드)
const ISSUE_CAP = 3              // 이슈 표시 최대 건수(초과분 '외 N건')
const EVENT_CAP = 4              // 주요 이벤트 표시 최대 건수(초과분 '외 N건')

type Slide = PptxGenJS.Slide

/** 항목 목록을 max개로 제한(초과분은 '외 N건'으로 요약) — 오버플로우 방지. */
export function capItems(items: string[], max: number): string[] {
  if (items.length <= max) return items
  return [...items.slice(0, max - 1), `외 ${items.length - (max - 1)}건`]
}

/** 각 Phase 그룹 항목 수를 제한(한 그룹이 한 페이지를 넘지 않도록). num은 그대로 보존. */
function capGroups(groups: NarrativeGroup[], maxItems: number): NarrativeGroup[] {
  return groups.map(g => ({ phase: g.phase, num: g.num, items: capItems(g.items, maxItems) }))
}

/** '#'없는 6자리 hex 선형보간. */
export function hexLerp(a: string, b: string, t: number): string {
  const ai = parseInt(a, 16), bi = parseInt(b, 16)
  const ar = (ai >> 16) & 255, ag = (ai >> 8) & 255, ab = ai & 255
  const br = (bi >> 16) & 255, bg = (bi >> 8) & 255, bb = bi & 255
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return ((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')
}

/** 상단 red→navy 그라데이션 룰(스텝 사각형; pptxgenjs 4.0.1은 gradient 미지원). */
function gradientRule(pptx: PptxGenJS, slide: Slide, y: number, h: number) {
  const steps = 20
  const rampEnd = 0.40 // 40% 지점까지 red→navy, 이후 navy
  const seg = W / steps
  for (let i = 0; i < steps; i++) {
    const t = Math.min(1, (i / (steps - 1)) / rampEnd)
    slide.addShape(pptx.ShapeType.rect, { x: i * seg, y, w: seg + 0.02, h, fill: { color: hexLerp(PN.red, PN.navy, t) }, line: { type: 'none' } })
  }
}

/** 하위 불릿 런들을 runs에 추가(Phase/이슈/이벤트 공용).
 *  bullet + indentLevel로 내어쓰기(hanging indent) → 넘친 줄이 글머리표가 아니라 본문 시작선에 정렬. */
function pushItems(runs: PptxGenJS.TextProps[], items: string[]) {
  items.forEach(it => runs.push({
    text: it,
    options: {
      fontFace: FONTS.normal, fontSize: 9.5, color: PN.body,
      bullet: { characterCode: '2013', indent: 10 }, indentLevel: 1,
      breakLine: true,
    },
  }))
}

/** '▐ 라벨' 헤더 런을 runs에 추가. */
function pushHeader(runs: PptxGenJS.TextProps[], label: string, color: string, size: number, spaceBefore: number) {
  runs.push({ text: label, options: { fontFace: FONTS.medium, fontSize: size, color, bold: true, breakLine: true, paraSpaceBefore: spaceBefore } })
}

/** Phase 그룹들 → addText 런 배열(▐ Phase / ‒ 작업). */
function groupsToRuns(groups: NarrativeGroup[]): PptxGenJS.TextProps[] {
  if (!groups.length) return [{ text: '(해당 없음)', options: { fontFace: FONTS.normal, fontSize: 10, color: PN.subtle } }]
  const runs: PptxGenJS.TextProps[] = []
  groups.forEach((g, gi) => {
    pushHeader(runs, `▐ ${g.num}. ${g.phase}`, PN.navy, 11, gi ? 4 : 0)
    pushItems(runs, g.items)
  })
  return runs
}

export interface PageContent { prev: NarrativeGroup[]; curr: NarrativeGroup[] }

/** prev/curr Phase 그룹을 줄 예산 기준으로 페이지 분할(보통 1페이지).
 *  각 그룹은 capGroups로 budget 이내로 제한되어 한 그룹이 페이지를 넘지 않음. */
export function packGroups(prev: NarrativeGroup[], curr: NarrativeGroup[], budget: number): PageContent[] {
  const phases: string[] = []
  for (const g of prev) if (!phases.includes(g.phase)) phases.push(g.phase)
  for (const g of curr) if (!phases.includes(g.phase)) phases.push(g.phase)
  const pMap = new Map(prev.map(g => [g.phase, g]))
  const cMap = new Map(curr.map(g => [g.phase, g]))
  const cost = (g?: NarrativeGroup) => (g ? 1 + g.items.length : 0)
  const pages: PageContent[] = []
  let draft: PageContent = { prev: [], curr: [] }
  let lines = 0
  for (const ph of phases) {
    const pg = pMap.get(ph)
    const cg = cMap.get(ph)
    const c = Math.max(cost(pg), cost(cg))
    if (lines > 0 && lines + c > budget) { pages.push(draft); draft = { prev: [], curr: [] }; lines = 0 }
    if (pg) draft.prev.push(pg)
    if (cg) draft.curr.push(cg)
    lines += c
  }
  pages.push(draft) // 마지막(또는 유일한) 페이지 — phases가 비어도 빈 페이지 1장 보장
  return pages
}

/* ── 표지 ── 흰 배경 + 상단 red→navy 룰 + 우측 워터마크 + 대형 네이비 제목 + 하단 로고. */
function coverSlide(pptx: PptxGenJS, model: WeeklyReportModel) {
  const { meta } = model
  const slide = pptx.addSlide()
  slide.background = { color: PN.white }
  gradientRule(pptx, slide, 0, 0.045)
  slide.addImage({ data: WATERMARK_PNG, x: 8.251, y: 2.684, w: 2.583, h: 3.570 })
  slide.addText(`${meta.projectName} 주간보고`, { x: 0.484, y: 2.489, w: 5.903, h: 1.046, fontFace: FONTS.bold, fontSize: 32, color: PN.navy, bold: true, valign: 'bottom', charSpacing: -0.5 })
  slide.addText(`${COMPANY} · ${meta.weekLabel}`, { x: 0.484, y: 4.017, w: 5.865, h: 0.30, fontFace: FONTS.medium, fontSize: 14, color: PN.body, valign: 'middle' })
  slide.addImage({ data: LOGO_PNG, x: 4.896, y: 7.079, w: 1.041, h: 0.218 })
}

/* ── 내지 크롬 ── 헤더 제목 + 구분선 + 좌하단 로고 + 우하단 작성자/페이지. */
function contentChrome(pptx: PptxGenJS, model: WeeklyReportModel, page: number, totalPages: number): Slide {
  const slide = pptx.addSlide()
  slide.background = { color: PN.white }
  slide.addText(`${model.meta.projectName} 주간보고`, { x: 0.298, y: 0.187, w: 6.75, h: 0.404, fontFace: FONTS.medium, fontSize: 19, color: PN.navy, valign: 'middle' })
  slide.addShape(pptx.ShapeType.line, { x: 0.295, y: 0.591, w: 10.239, h: 0, line: { color: PN.divider, width: 0.5 } })
  slide.addImage({ data: LOGO_PNG, x: 0.299, y: 7.214, w: 0.828, h: 0.174 })
  slide.addText(`작성자_${COMPANY}`, { x: 7.6, y: 7.22, w: 2.0, h: 0.163, fontFace: FONTS.normal, fontSize: 8, color: PN.footerGray, align: 'right', valign: 'middle' })
  slide.addText(`${page} / ${totalPages}`, { x: 9.7, y: 7.22, w: 0.83, h: 0.161, fontFace: FONTS.normal, fontSize: 8, color: PN.footerGray, align: 'right', valign: 'middle' })
  return slide
}

/* ── 본문 활동 표 ── 전주/금주 2단. */
function activityTable(pptx: PptxGenJS, slide: Slide, content: PageContent, model: WeeklyReportModel) {
  const labelW = 0.9
  const colW = (BODY_W - labelW) / 2
  // pptxgenjs .d.ts는 TableCell.text를 string|TableCell[]로만 선언하지만, 런타임은
  // rich-text 런 배열({text,options})을 지원(공식 표 API). 그래서 캐스트로 우회한다.
  const cell = (runs: PptxGenJS.TextProps[] | string, opts: PptxGenJS.TableCellProps): PptxGenJS.TableCell =>
    ({ text: runs as PptxGenJS.TableCell['text'], options: opts })
  const headOpt: PptxGenJS.TableCellProps = { fill: { color: PN.navy }, color: PN.white, bold: true, align: 'center', valign: 'middle', fontFace: FONTS.medium, fontSize: 11 }
  const head: PptxGenJS.TableRow = [
    cell('구분', headOpt),
    cell(`전주 주요활동 (${model.meta.prevWeekRange})`, headOpt),
    cell(`금주 주요활동 (${model.meta.weekRange})`, headOpt),
  ]
  const body: PptxGenJS.TableRow = [
    cell('내용', { fill: { color: PN.zebra }, color: PN.gray, bold: true, align: 'center', valign: 'middle', fontFace: FONTS.medium, fontSize: 10 }),
    cell(groupsToRuns(content.prev), { fill: { color: PN.white }, valign: 'top', margin: 6 }),
    cell(groupsToRuns(content.curr), { fill: { color: PN.white }, valign: 'top', margin: 6 }),
  ]
  slide.addTable([head, body], {
    x: BODY_L, y: TABLE_Y, w: BODY_W, colW: [labelW, colW, colW], rowH: [0.36, TABLE_BODY_H],
    border: { type: 'solid', color: PN.line, pt: 1 }, valign: 'top', fontFace: FONTS.normal, autoPage: false,
  })
}

/* ── 이슈·주요이벤트 밴드(마지막 본문 페이지만). 표시 건수는 capItems로 제한 → 밴드 오버플로우 방지. */
function issuesEventsBand(pptx: PptxGenJS, slide: Slide, narr: NarrativeModel) {
  const yi = 5.15
  slide.addShape(pptx.ShapeType.rect, { x: BODY_L, y: yi, w: BODY_W, h: 0.32, fill: { color: PN.navy2 }, line: { type: 'none' } })
  slide.addText('이슈사항 및 주요 이벤트', { x: BODY_L + 0.12, y: yi, w: BODY_W - 0.24, h: 0.32, fontFace: FONTS.medium, fontSize: 11, color: PN.white, bold: true, valign: 'middle' })
  const issues = capItems(narr.issues.length ? narr.issues : ['특이 이슈 없음'], ISSUE_CAP)
  const events = capItems(narr.events.length ? narr.events : ['예정된 주요 이벤트 없음'], EVENT_CAP)
  const runs: PptxGenJS.TextProps[] = []
  pushHeader(runs, '▐ 이슈', PN.red, 10.5, 0)
  pushItems(runs, issues)
  pushHeader(runs, '▐ 주요 이벤트', PN.navy, 10.5, 6)
  pushItems(runs, events)
  slide.addText(runs, { x: BODY_L, y: yi + 0.42, w: BODY_W, h: 1.45, valign: 'top' })
}

/** 주간 공정보고 모델 → 동국씨엠 공식 양식 PPTX(nodebuffer). */
export async function buildReportDeck(model: WeeklyReportModel): Promise<Buffer> {
  const narr = buildWeeklyNarrative(model)
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'DK_A4', width: W, height: H })
  pptx.layout = 'DK_A4'
  pptx.author = COMPANY
  pptx.company = COMPANY
  pptx.title = `${model.meta.projectName} 주간보고`

  // 각 그룹을 budget 이내로 캡 → packGroups가 페이지 분할. 한 페이지도 표 행을 넘기지 않음.
  const pages = packGroups(capGroups(narr.prev, LINE_BUDGET - 1), capGroups(narr.curr, LINE_BUDGET - 1), LINE_BUDGET)
  const totalPages = 1 + pages.length // 표지 + 본문 N

  coverSlide(pptx, model)
  pages.forEach((pg, i) => {
    const slide = contentChrome(pptx, model, i + 2, totalPages)
    activityTable(pptx, slide, pg, model)
    if (i === pages.length - 1) issuesEventsBand(pptx, slide, narr)
  })

  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
}
