import PptxGenJS from 'pptxgenjs'
import type { ReportModel } from './model'
import { C, STATUS_COLOR, STATUS_LABEL, TEAM_COLOR, ownersText } from './brand'

const FONT = 'Malgun Gothic' // KR 엔터프라이즈 호환(미설치 시 PowerPoint가 대체)
const ACCENT = '32B6AB' // 다크 배경용 밝은 브랜드 틸

// LAYOUT_WIDE: 13.33 x 7.5 inch
const W = 13.33
const H = 7.5
const MX = 0.7 // 좌우 여백

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n))
}
function fmtFull(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${y}년 ${Number(m)}월 ${Number(day)}일`
}
function fmtDate(d: string | null): string {
  return d ? d.replace(/-/g, '.') : '-'
}

type Slide = PptxGenJS.Slide

/** 본문 슬라이드 공통: 밝은 배경 + 상단 제목 + 하단 푸터. */
function contentSlide(pptx: PptxGenJS, model: ReportModel, eyebrow: string, title: string): Slide {
  const slide = pptx.addSlide()
  slide.background = { color: C.surface }
  // 상단 브랜드 바
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: C.brand } })
  slide.addText(eyebrow.toUpperCase(), {
    x: MX, y: 0.4, w: W - MX * 2, h: 0.3, fontFace: FONT, fontSize: 11, color: C.brand, bold: true, charSpacing: 2,
  })
  slide.addText(title, {
    x: MX, y: 0.7, w: W - MX * 2, h: 0.6, fontFace: FONT, fontSize: 26, color: C.ink, bold: true,
  })
  addFooter(pptx, slide, model)
  return slide
}

function addFooter(pptx: PptxGenJS, slide: Slide, model: ReportModel) {
  slide.addText(
    [
      { text: "D'Flow", options: { bold: true, color: C.brand } },
      { text: `   ·   ${model.meta.projectName}   ·   ${fmtFull(model.meta.today)}`, options: { color: C.inkSubtle } },
    ],
    { x: MX, y: H - 0.45, w: W - MX * 2, h: 0.3, fontFace: FONT, fontSize: 9, align: 'left', valign: 'middle' },
  )
}

/** 표 본문을 페이지 크기로 분할. 빈 입력은 1빈페이지. */
const ROWS_PER_PAGE = 11
function paginate<T>(arr: T[], size: number): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < arr.length; i += size) pages.push(arr.slice(i, i + size))
  return pages.length ? pages : [[]]
}

/** 표를 페이지마다 '완전히 브랜드된' 슬라이드로 출력(autoPage 미사용 — 연속 슬라이드의
 *  배경·브랜드바·타이틀·푸터 유실 방지). 여러 페이지면 타이틀에 (n/m) 표기. */
function tableSlides(
  pptx: PptxGenJS, model: ReportModel,
  eyebrow: string, baseTitle: string,
  header: PptxGenJS.TableRow, body: PptxGenJS.TableRow[],
  colW: number[],
) {
  const pages = paginate(body, ROWS_PER_PAGE)
  pages.forEach((rows, i) => {
    const title = pages.length > 1 ? `${baseTitle} (${i + 1}/${pages.length})` : baseTitle
    const slide = contentSlide(pptx, model, eyebrow, title)
    slide.addTable([header, ...rows], {
      x: MX, y: 1.7, w: W - MX * 2, colW,
      border: { type: 'solid', color: C.line, pt: 1 },
      fontFace: FONT, fontSize: 12, rowH: 0.42, valign: 'middle',
      autoPage: false,
    })
  })
}

/** 진척 막대(트랙 + 채움 + 라벨). */
function progressBar(
  pptx: PptxGenJS, slide: Slide,
  x: number, y: number, w: number, pct: number, color: string,
) {
  const p = clampPct(pct)
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.26, fill: { color: C.surface2 }, line: { type: 'none' }, rectRadius: 0.13 })
  if (p > 0) {
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w: Math.max((w * p) / 100, 0.26), h: 0.26, fill: { color }, line: { type: 'none' }, rectRadius: 0.13 })
  }
}

// ── S1: 표지 ──
function titleSlide(pptx: PptxGenJS, model: ReportModel) {
  const { meta } = model
  const slide = pptx.addSlide()
  slide.background = { color: C.dark1 }
  // 장식 — 우측 브랜드 글로우 느낌의 반투명 원형 대용 직사각
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: H, fill: { color: C.brand } })
  // 표지 이름은 너무 길면 말줄임(레이아웃 깨짐 방지). 폰트·여백으로 부제와 겹침 방지.
  const coverName = meta.projectName.length > 42 ? meta.projectName.slice(0, 41) + '…' : meta.projectName
  slide.addText("D'FLOW · STATUS REPORT", {
    x: MX, y: 1.4, w: W - MX * 2, h: 0.4, fontFace: FONT, fontSize: 14, color: ACCENT, bold: true, charSpacing: 3,
  })
  slide.addText(coverName, {
    x: MX, y: 2.0, w: W - MX * 2, h: 1.5, fontFace: FONT, fontSize: 32, color: C.heroInk, bold: true, valign: 'top',
  })
  slide.addText('현황 보고서', {
    x: MX, y: 3.7, w: W - MX * 2, h: 0.6, fontFace: FONT, fontSize: 22, color: C.heroInkMuted,
  })
  const periodText = meta.startDate || meta.endDate ? `기간  ${fmtFull(meta.startDate)} ~ ${fmtFull(meta.endDate)}` : '기간 미설정'
  slide.addText(
    [
      { text: `생성일  ${fmtFull(meta.today)}`, options: { color: C.heroInk } },
      { text: `        ${periodText}`, options: { color: C.heroInkMuted } },
      { text: `        전체 작업  ${meta.totalLeaves}건`, options: { color: C.heroInkMuted } },
    ],
    { x: MX, y: 5.6, w: W - MX * 2, h: 0.4, fontFace: FONT, fontSize: 13, valign: 'middle' },
  )
}

// ── S2: 요약 KPI ──
function kpiSlide(pptx: PptxGenJS, model: ReportModel) {
  const { kpi, meta } = model
  const slide = contentSlide(pptx, model, 'Summary', '전체 요약')
  const tiles = [
    { label: '전체 실적', value: `${kpi.actual}%`, color: C.brand },
    { label: '전체 계획', value: `${kpi.planned}%`, color: C.inkSubtle },
    { label: '계획 대비 편차', value: `${kpi.variance > 0 ? '+' : ''}${kpi.variance}%p`, color: kpi.variance >= 0 ? C.done : C.delayed },
    { label: '지연 작업', value: `${kpi.delayedCount}건`, color: C.delayed },
  ]
  const gap = 0.3
  const tileW = (W - MX * 2 - gap * 3) / 4
  const tileY = 1.7
  const tileH = 1.7
  tiles.forEach((t, i) => {
    const x = MX + i * (tileW + gap)
    slide.addShape(pptx.ShapeType.roundRect, { x, y: tileY, w: tileW, h: tileH, fill: { color: C.white }, line: { color: C.line, width: 1 }, rectRadius: 0.08 })
    slide.addText(t.label, { x: x + 0.2, y: tileY + 0.25, w: tileW - 0.4, h: 0.4, fontFace: FONT, fontSize: 12, color: C.inkSubtle, bold: true })
    slide.addText(t.value, { x: x + 0.2, y: tileY + 0.7, w: tileW - 0.4, h: 0.8, fontFace: FONT, fontSize: 30, color: t.color, bold: true })
  })

  // 실적 vs 계획 비교 바
  const barY = 4.2
  slide.addText('실적 vs 계획', { x: MX, y: barY - 0.45, w: 4, h: 0.35, fontFace: FONT, fontSize: 13, color: C.ink, bold: true })
  const labelW = 1.2
  const barW = W - MX * 2 - labelW - 1.3
  const rows = [
    { label: '실적', pct: kpi.actual, color: C.brand },
    { label: '계획', pct: kpi.planned, color: C.inkSubtle },
  ]
  rows.forEach((rw, i) => {
    const y = barY + i * 0.7
    slide.addText(rw.label, { x: MX, y: y - 0.05, w: labelW, h: 0.35, fontFace: FONT, fontSize: 12, color: C.inkMuted, bold: true, valign: 'middle' })
    progressBar(pptx, slide, MX + labelW, y, barW, rw.pct, rw.color)
    slide.addText(`${rw.pct}%`, { x: MX + labelW + barW + 0.15, y: y - 0.05, w: 1, h: 0.35, fontFace: FONT, fontSize: 12, color: C.ink, bold: true, valign: 'middle' })
  })
  void meta
}

// ── S3: Phase별 진척 (행 많으면 브랜드 슬라이드로 자동 분할) ──
function phaseSlide(pptx: PptxGenJS, model: ReportModel) {
  const header: PptxGenJS.TableRow = ['Phase', '계획', '실적', '편차', '상태'].map(t => ({
    text: t,
    options: { fill: { color: C.brand }, color: C.white, bold: true, align: (t === 'Phase' ? 'left' : 'center') as 'left' | 'center', valign: 'middle' as const },
  }))
  const body: PptxGenJS.TableRow[] = model.phases.length
    ? model.phases.map(p => [
        { text: p.name, options: { color: C.ink, align: 'left' as const, valign: 'middle' as const } },
        { text: `${p.plannedPct}%`, options: { color: C.inkMuted, align: 'center' as const, valign: 'middle' as const } },
        { text: `${p.actualPct}%`, options: { color: C.ink, bold: true, align: 'center' as const, valign: 'middle' as const } },
        { text: `${p.variance > 0 ? '+' : ''}${p.variance}%p`, options: { color: p.variance >= 0 ? C.done : C.delayed, bold: true, align: 'center' as const, valign: 'middle' as const } },
        { text: STATUS_LABEL[p.status], options: { fill: { color: STATUS_COLOR[p.status] }, color: C.white, bold: true, align: 'center' as const, valign: 'middle' as const } },
      ])
    : [[{ text: '표시할 Phase가 없습니다.', options: { color: C.inkMuted, colspan: 5, align: 'center' as const } }]]

  tableSlides(pptx, model, 'By phase', 'Phase별 진척', header, body, [5.6, 1.6, 1.6, 1.6, 1.5])
}

// ── S4: 지연 작업 (행 많으면 브랜드 슬라이드로 자동 분할) ──
function delayedSlide(pptx: PptxGenJS, model: ReportModel) {
  if (model.delayed.length === 0) {
    const slide = contentSlide(pptx, model, 'At risk', '지연 작업 목록')
    slide.addShape(pptx.ShapeType.roundRect, { x: MX, y: 2.6, w: W - MX * 2, h: 1.6, fill: { color: C.doneWeak }, line: { type: 'none' }, rectRadius: 0.1 })
    slide.addText('✓  현재 지연된 작업이 없습니다.', {
      x: MX, y: 2.6, w: W - MX * 2, h: 1.6, fontFace: FONT, fontSize: 20, color: C.done, bold: true, align: 'center', valign: 'middle',
    })
    return
  }
  const header: PptxGenJS.TableRow = ['작업명', '담당', '종료일', '실적'].map((t, i) => ({
    text: t,
    options: { fill: { color: C.brand }, color: C.white, bold: true, align: (i <= 1 ? 'left' : 'center') as 'left' | 'center', valign: 'middle' as const },
  }))
  const body: PptxGenJS.TableRow[] = model.delayed.map(d => [
    { text: d.name, options: { color: C.ink, align: 'left' as const, valign: 'middle' as const } },
    { text: ownersText(d.owners), options: { color: C.inkMuted, align: 'left' as const, valign: 'middle' as const } },
    { text: fmtDate(d.plannedEnd), options: { color: C.delayed, align: 'center' as const, valign: 'middle' as const } },
    { text: `${d.actualPct}%`, options: { color: C.ink, bold: true, align: 'center' as const, valign: 'middle' as const } },
  ])
  tableSlides(pptx, model, 'At risk', '지연 작업 목록', header, body, [6.2, 3.0, 1.5, 1.2])
}

// ── S5: 팀별 진척 ──
function teamSlide(pptx: PptxGenJS, model: ReportModel) {
  const slide = contentSlide(pptx, model, 'By owner', '팀별 진척')
  const startY = 2.0
  const rowH = 0.95
  const labelW = 1.4
  const countW = 1.6
  const pctW = 1.0
  const barW = W - MX * 2 - labelW - countW - pctW - 0.4
  model.teams.forEach((t, i) => {
    const y = startY + i * rowH
    slide.addShape(pptx.ShapeType.rect, { x: MX, y: y + 0.02, w: 0.14, h: 0.4, fill: { color: TEAM_COLOR[t.team] } })
    slide.addText(t.team, { x: MX + 0.25, y, w: labelW, h: 0.44, fontFace: FONT, fontSize: 15, color: TEAM_COLOR[t.team], bold: true, valign: 'middle' })
    slide.addText(`${t.count}개 작업`, { x: MX + 0.25 + labelW, y, w: countW, h: 0.44, fontFace: FONT, fontSize: 11, color: C.inkSubtle, valign: 'middle' })
    progressBar(pptx, slide, MX + 0.25 + labelW + countW, y + 0.08, barW, t.pct ?? 0, TEAM_COLOR[t.team])
    slide.addText(t.pct == null ? '-' : `${t.pct}%`, { x: MX + 0.25 + labelW + countW + barW + 0.15, y, w: pctW, h: 0.44, fontFace: FONT, fontSize: 13, color: C.ink, bold: true, valign: 'middle' })
  })
}

/** 현황 보고서 모델 → D'Flow 브랜드 PPTX 버퍼(nodebuffer). */
export async function buildReportDeck(model: ReportModel): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'DFLOW_WIDE', width: W, height: H })
  pptx.layout = 'DFLOW_WIDE'
  pptx.author = "D'Flow"
  pptx.company = "D'Flow"
  pptx.title = `${model.meta.projectName} 현황 보고서`

  titleSlide(pptx, model)
  kpiSlide(pptx, model)
  phaseSlide(pptx, model)
  delayedSlide(pptx, model)
  teamSlide(pptx, model)

  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
}
