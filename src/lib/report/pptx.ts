import PptxGenJS from 'pptxgenjs'
import type { WeeklyReportModel, WeeklyTaskRow, AttendanceRow } from './weekly'
import { statusKr } from './weekly'
import { PN, PN_STATUS } from './dkbrand'
import type { Status } from '@/lib/domain/types'

const FONT = 'Malgun Gothic' // KR 엔터프라이즈 호환(미설치 시 PowerPoint가 대체)
const COMPANY = '동국씨엠' // 보고 주체 — 표지 레터헤드 + 각 본문 슬라이드 헤더에 표기
const W = 10
const H = 5.625
const MX = 0.6
const HEADER_H = 0.98

type Slide = PptxGenJS.Slide

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n))
}

/** 모든 본문 슬라이드 공통: 흰 배경 + 상단 네이비 헤더바(제목/부제) + 페이지번호. */
function baseSlide(pptx: PptxGenJS, model: WeeklyReportModel, subtitle: string, page: number, totalPages: number, titleSize = 16): Slide {
  const slide = pptx.addSlide()
  slide.background = { color: PN.surface }
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: HEADER_H, fill: { color: PN.navy }, line: { type: 'none' } })
  // 네이비 헤더바 하단 얇은 동국 레드 룰 — 전 슬라이드 블루+레드 듀오톤 일관성(동국제강 그룹 CI)
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: HEADER_H, w: W, h: 0.045, fill: { color: PN.red }, line: { type: 'none' } })
  slide.addText(model.meta.projectName, {
    x: MX, y: 0.16, w: W - MX * 2 - 1.8, h: 0.42, fontFace: FONT, fontSize: titleSize, color: PN.white, bold: true, valign: 'middle',
  })
  // 헤더 우측 회사명 표기(각 본문 슬라이드 공통)
  slide.addText(COMPANY, {
    x: W - MX - 1.8, y: 0.16, w: 1.8, h: 0.42, fontFace: FONT, fontSize: 11, color: PN.subtle, bold: true, align: 'right', valign: 'middle',
  })
  slide.addText(subtitle, {
    x: MX, y: 0.58, w: W - MX * 2, h: 0.3, fontFace: FONT, fontSize: 10, color: PN.subtle, valign: 'middle',
  })
  slide.addText(`${page} / ${totalPages}`, {
    x: W - 1.4, y: H - 0.34, w: 1.0, h: 0.24, fontFace: FONT, fontSize: 8, color: PN.subtle, align: 'right', valign: 'middle',
  })
  return slide
}

/** 진척 막대(트랙 + 채움). */
function bar(pptx: PptxGenJS, slide: Slide, x: number, y: number, w: number, pct: number, color: string, h = 0.22) {
  const p = clampPct(pct)
  const r = h / 2
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill: { color: PN.line }, line: { type: 'none' }, rectRadius: r })
  if (p > 0) slide.addShape(pptx.ShapeType.roundRect, { x, y, w: Math.max((w * p) / 100, h), h, fill: { color }, line: { type: 'none' }, rectRadius: r })
}

/* ── 표지(1페이지) — 풀 네이비 겉표지. 헤더바·페이지번호 없이 제목/기간/작성일만. ── */
function coverSlide(pptx: PptxGenJS, model: WeeklyReportModel) {
  const { meta } = model
  const slide = pptx.addSlide()
  slide.background = { color: PN.navy }

  // 상단 동국 레드 브랜드 룰(듀오톤 시그니처) + 하단 얇은 네이비 바
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.11, fill: { color: PN.red }, line: { type: 'none' } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.16, w: W, h: 0.16, fill: { color: PN.navy2 }, line: { type: 'none' } })

  // 상단 회사 레터헤드 — 레드 스퀘어 악센트(CI 'D·K' 라이트 모티프) + 그룹명
  slide.addShape(pptx.ShapeType.rect, { x: MX, y: 0.56, w: 0.14, h: 0.30, fill: { color: PN.red }, line: { type: 'none' } })
  slide.addText(COMPANY, { x: MX + 0.24, y: 0.5, w: 6, h: 0.42, fontFace: FONT, fontSize: 17, color: PN.white, bold: true, charSpacing: 1, valign: 'middle' })

  // 좌측 세로 강조선 — 동국 레드(블루 배경 위 듀오톤)
  slide.addShape(pptx.ShapeType.rect, { x: MX, y: 1.95, w: 0.09, h: 1.72, fill: { color: PN.red }, line: { type: 'none' } })

  // eyebrow + 리포트 유형
  slide.addText('WEEKLY REPORT', { x: MX + 0.28, y: 1.95, w: W - MX * 2, h: 0.3, fontFace: FONT, fontSize: 12, color: PN.subtle, bold: true, charSpacing: 3 })
  slide.addText('주간 보고서', { x: MX + 0.26, y: 2.3, w: W - MX * 2, h: 0.4, fontFace: FONT, fontSize: 15, color: PN.line, bold: true })

  // 프로젝트명(대형)
  slide.addText(meta.projectName, { x: MX + 0.26, y: 2.78, w: W - MX * 2 - 0.26, h: 1.0, fontFace: FONT, fontSize: 30, color: PN.white, bold: true, valign: 'top' })

  // 대상 주차(기간)
  slide.addText(meta.weekLabel, { x: MX + 0.28, y: 3.8, w: W - MX * 2, h: 0.35, fontFace: FONT, fontSize: 14, color: PN.subtle })

  // 하단: 작성 기준일(좌) / 브랜드(우)
  slide.addShape(pptx.ShapeType.line, { x: MX, y: 4.92, w: W - MX * 2, h: 0, line: { color: PN.navy2, width: 1 } })
  slide.addText(`작성 기준일 · ${meta.generatedAt}`, { x: MX, y: 5.05, w: 6, h: 0.3, fontFace: FONT, fontSize: 10, color: PN.subtle, valign: 'middle' })
  slide.addText("D'Flow", { x: W - MX - 3, y: 5.05, w: 3, h: 0.3, fontFace: FONT, fontSize: 12, color: PN.white, bold: true, align: 'right', valign: 'middle' })
}

/* ── S2: 요약 ── */
function summarySlide(pptx: PptxGenJS, model: WeeklyReportModel, totalPages: number) {
  const { meta, kpi } = model
  const slide = baseSlide(pptx, model, `주간보고 · ${meta.weekLabel} · ${meta.generatedAt} 기준`, 2, totalPages, 20)

  // KPI 4 타일
  const tiles = [
    { label: '전체 작업', value: `${kpi.total}건` },
    { label: '완료', value: `${kpi.done}건` },
    { label: '실적 공정율', value: `${kpi.actual}%` },
    { label: '지연', value: `${kpi.delayed}건` },
  ]
  const gap = 0.2
  const tileW = (W - MX * 2 - gap * 3) / 4
  tiles.forEach((t, i) => {
    const x = MX + i * (tileW + gap)
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 1.22, w: tileW, h: 0.82, fill: { color: PN.zebra }, line: { color: PN.line, width: 1 }, rectRadius: 0.06 })
    slide.addText(t.label, { x: x + 0.18, y: 1.31, w: tileW - 0.3, h: 0.22, fontFace: FONT, fontSize: 8, color: PN.gray, bold: true })
    slide.addText(t.value, { x: x + 0.18, y: 1.52, w: tileW - 0.3, h: 0.4, fontFace: FONT, fontSize: 18, color: PN.ink, bold: true })
  })

  // 좌: 계획 vs 실적
  slide.addText('계획 vs 실적', { x: MX, y: 2.22, w: 4, h: 0.3, fontFace: FONT, fontSize: 11, color: PN.ink, bold: true })
  const rows = [
    { label: '계획 공정율', pct: kpi.planned, color: PN.gray },
    { label: '실적 공정율', pct: kpi.actual, color: PN.navy2 },
  ]
  rows.forEach((rw, i) => {
    const y = 2.57 + i * 0.6
    slide.addText(`${rw.label}   ${rw.pct}%`, { x: MX, y, w: 4, h: 0.2, fontFace: FONT, fontSize: 9, color: PN.body2 })
    bar(pptx, slide, MX, y + 0.24, 4, rw.pct, rw.color, 0.16)
  })

  // 우: 상태 분포
  const rx = 5.2
  slide.addText('상태 분포', { x: rx, y: 2.22, w: 4.2, h: 0.3, fontFace: FONT, fontSize: 11, color: PN.ink, bold: true })
  const dist: { label: string; value: number; color: string }[] = [
    { label: '진행중', value: kpi.inProgress, color: PN_STATUS.in_progress },
    { label: '대기', value: kpi.notStarted, color: PN_STATUS.not_started },
    { label: '지연', value: kpi.delayed, color: PN_STATUS.delayed },
    { label: '완료', value: kpi.done, color: PN_STATUS.done },
  ]
  const dw = (4.2 - 0.15 * 3) / 4
  dist.forEach((d, i) => {
    const x = rx + i * (dw + 0.15)
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 2.57, w: dw, h: 0.86, fill: { color: PN.zebra }, line: { color: PN.line, width: 1 }, rectRadius: 0.06 })
    slide.addShape(pptx.ShapeType.rect, { x, y: 2.57, w: 0.06, h: 0.86, fill: { color: d.color }, line: { type: 'none' } })
    slide.addText(d.label, { x: x + 0.16, y: 2.66, w: dw - 0.2, h: 0.2, fontFace: FONT, fontSize: 8, color: PN.gray, bold: true })
    slide.addText(`${d.value}`, { x: x + 0.16, y: 2.86, w: dw - 0.2, h: 0.45, fontFace: FONT, fontSize: 18, color: PN.ink, bold: true })
  })

  // 이슈 / 리스크
  slide.addText('이슈 / 리스크', { x: MX, y: 3.79, w: 8, h: 0.3, fontFace: FONT, fontSize: 11, color: PN.red, bold: true })
  model.issues.slice(0, 3).forEach((it, i) => {
    slide.addText(`${i + 1}. ${it.content}`, { x: MX + 0.2, y: 4.14 + i * 0.28, w: W - MX * 2 - 0.2, h: 0.25, fontFace: FONT, fontSize: 9, color: PN.body })
  })

  // 하단 미니 KPI
  const mini = [
    { label: '금주 실적', value: `${kpi.inProgress}건` },
    { label: '금주 완료', value: `${kpi.doneThisWeek}건` },
    { label: '차주 계획', value: `${kpi.nextWeekPlanCount}건` },
    { label: '지연 작업', value: `${kpi.delayed}건` },
  ]
  const mw = (W - MX * 2 - 0.2 * 3) / 4
  slide.addShape(pptx.ShapeType.line, { x: MX, y: 5.06, w: W - MX * 2, h: 0, line: { color: PN.line, width: 1 } })
  mini.forEach((t, i) => {
    const x = MX + i * (mw + 0.2)
    slide.addText(t.label, { x, y: 5.15, w: mw, h: 0.2, fontFace: FONT, fontSize: 8, color: PN.gray, bold: true })
    slide.addText(t.value, { x, y: 5.33, w: mw, h: 0.26, fontFace: FONT, fontSize: 12, color: PN.ink, bold: true })
  })
}

/* ── 상세 작업 테이블(한 컬럼) ── */
function detailTable(pptx: PptxGenJS, slide: Slide, x: number, label: string, rows: WeeklyTaskRow[]) {
  const w = 4.4
  slide.addShape(pptx.ShapeType.rect, { x, y: 1.2, w, h: 0.34, fill: { color: PN.navy2 }, line: { type: 'none' } })
  slide.addText(label, { x: x + 0.12, y: 1.2, w: w - 0.24, h: 0.34, fontFace: FONT, fontSize: 11, color: PN.white, bold: true, valign: 'middle' })

  const head: PptxGenJS.TableRow = ['작업명', '담당자', '상태', '공정율'].map((t, i) => ({
    text: t,
    options: { fill: { color: PN.ink }, color: PN.white, bold: true, fontSize: 9, align: (i === 0 ? 'left' : 'center') as 'left' | 'center', valign: 'middle' as const },
  }))
  const body: PptxGenJS.TableRow[] = rows.length
    ? rows.map((r, ri) => {
        const zebra = ri % 2 === 1 ? PN.zebra : PN.white
        return [
          { text: [
            { text: r.name, options: { color: PN.ink, fontSize: 9, bold: false } },
            { text: `\n(${r.phaseName})`, options: { color: PN.subtle, fontSize: 7.5 } },
          ], options: { fill: { color: zebra }, align: 'left' as const, valign: 'middle' as const } },
          { text: r.ownerText, options: { fill: { color: zebra }, color: PN.body, fontSize: 9, align: 'center' as const, valign: 'middle' as const } },
          { text: statusKr(r.status), options: { fill: { color: PN.chip }, color: PN_STATUS[r.status as Status], fontSize: 8.5, bold: true, align: 'center' as const, valign: 'middle' as const } },
          { text: `${r.actualPct}%`, options: { fill: { color: zebra }, color: PN.ink, fontSize: 9, bold: true, align: 'center' as const, valign: 'middle' as const } },
        ]
      })
    : [[{ text: '해당 작업 없음', options: { fill: { color: PN.zebra }, color: PN.gray, fontSize: 9, colspan: 4, align: 'center' as const } }]]

  slide.addTable([head, ...body], {
    x, y: 1.62, w, colW: [2.15, 1.05, 0.7, 0.5],
    border: { type: 'solid', color: PN.line, pt: 1 }, fontFace: FONT, rowH: 0.34, valign: 'middle', autoPage: false,
  })
}

function paginate<T>(arr: T[], size: number): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < arr.length; i += size) pages.push(arr.slice(i, i + size))
  return pages.length ? pages : [[]]
}

/* ── S2~: 상세 작업 현황 ──
 * 금주 실적·차주 계획을 각각 독립 페이지네이션 → 행이 많으면 다음 페이지로 이어짐(잘림 방지).
 * 2~3줄로 접히는 긴 작업명을 고려해 페이지당 5행으로 제한. */
const DETAIL_PER = 5

function detailSlides(pptx: PptxGenJS, model: WeeklyReportModel, totalPages: number, startPage: number): void {
  const thisWeek = model.planActual.flatMap(p => p.thisWeek)
  const nextWeek = model.planActual.flatMap(p => p.nextWeek)
  const thisPages = paginate(thisWeek, DETAIL_PER)
  const nextPages = paginate(nextWeek, DETAIL_PER)
  const nPages = Math.max(thisPages.length, nextPages.length)
  for (let i = 0; i < nPages; i++) {
    const slide = baseSlide(pptx, model, `상세 작업 현황 (${i + 1}/${nPages}) · ${model.meta.weekLabel}`, startPage + i, totalPages)
    detailTable(pptx, slide, 0.4, `금주 실적 (${model.meta.weekRange})`, thisPages[i] ?? [])
    detailTable(pptx, slide, 5.2, `차주 계획 (${model.meta.nextWeekRange})`, nextPages[i] ?? [])
  }
}

function detailPageCount(model: WeeklyReportModel): number {
  const thisWeek = model.planActual.reduce((s, p) => s + p.thisWeek.length, 0)
  const nextWeek = model.planActual.reduce((s, p) => s + p.nextWeek.length, 0)
  return Math.max(1, Math.ceil(thisWeek / DETAIL_PER), Math.ceil(nextWeek / DETAIL_PER))
}

/* ── 마지막: 근태현황 ── */
function attendanceTable(pptx: PptxGenJS, slide: Slide, y: number, label: string, dayDates: string[], rows: AttendanceRow[]) {
  const x = 0.4
  const w = 9.2
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.32, fill: { color: PN.navy2 }, line: { type: 'none' } })
  slide.addText(label, { x: x + 0.12, y, w: w - 0.24, h: 0.32, fontFace: FONT, fontSize: 10, color: PN.white, bold: true, valign: 'middle' })

  const wd = ['월', '화', '수', '목', '금']
  const head: PptxGenJS.TableRow = ['담당자', ...wd.map((d, i) => `${d} (${dayDates[i].slice(5).replace('-', '/')})`), '소계'].map((t, i) => ({
    text: t,
    options: { fill: { color: PN.ink }, color: PN.white, bold: true, fontSize: 9, align: (i === 0 ? 'left' : 'center') as 'left' | 'center', valign: 'middle' as const },
  }))
  const body: PptxGenJS.TableRow[] = rows.length
    ? rows.map((r, ri) => {
        const zebra = ri % 2 === 1 ? PN.zebra : PN.white
        return [
          { text: r.memberName, options: { fill: { color: zebra }, color: PN.ink, fontSize: 9, align: 'left' as const, valign: 'middle' as const } },
          ...r.perDay.map(v => ({ text: v ?? '·', options: { fill: { color: v ? PN.chip : zebra }, color: v ? PN.navy2 : PN.line, fontSize: 9, bold: !!v, align: 'center' as const, valign: 'middle' as const } })),
          { text: `${r.count}`, options: { fill: { color: zebra }, color: PN.ink, fontSize: 9, bold: true, align: 'center' as const, valign: 'middle' as const } },
        ]
      })
    : [[{ text: '특이 근태 없음 (전원 출근)', options: { fill: { color: PN.zebra }, color: PN.gray, fontSize: 9, colspan: 7, align: 'center' as const } }]]

  slide.addTable([head, ...body], {
    x, y: y + 0.34, w, colW: [2.0, 1.16, 1.16, 1.16, 1.16, 1.16, 1.0], border: { type: 'solid', color: PN.line, pt: 1 },
    fontFace: FONT, rowH: 0.32, valign: 'middle', autoPage: false,
  })
}

function attendanceSlide(pptx: PptxGenJS, model: WeeklyReportModel, totalPages: number) {
  const slide = baseSlide(pptx, model, `근태현황 · ${model.meta.weekLabel}`, totalPages, totalPages)
  attendanceTable(pptx, slide, 1.2, '금주 근태현황', model.meta.weekDays, model.attendance.thisWeek)
  attendanceTable(pptx, slide, 3.0, '차주 근태현황', model.meta.nextWeekDays, model.attendance.nextWeek)
}

/* ── 회의일정 (근태와 동일 양식: 라벨바 + 표) ── */
const MEETING_CAP = 5 // 페이지당(테이블당) 최대 표시 행 — 초과분은 '외 N건' 요약
function meetingTable(pptx: PptxGenJS, slide: Slide, y: number, label: string, rows: WeeklyReportModel['meetings']['thisWeek']) {
  const x = 0.4
  const w = 9.2
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.32, fill: { color: PN.navy2 }, line: { type: 'none' } })
  slide.addText(label, { x: x + 0.12, y, w: w - 0.24, h: 0.32, fontFace: FONT, fontSize: 10, color: PN.white, bold: true, valign: 'middle' })

  const head: PptxGenJS.TableRow = ['일자', '시간', '회의명', '장소', '참석'].map((t, i) => ({
    text: t,
    options: { fill: { color: PN.ink }, color: PN.white, bold: true, fontSize: 9, align: (i === 2 ? 'left' : 'center') as 'left' | 'center', valign: 'middle' as const },
  }))
  const shown = rows.slice(0, MEETING_CAP)
  const body: PptxGenJS.TableRow[] = rows.length
    ? shown.map((r, ri) => {
        const zebra = ri % 2 === 1 ? PN.zebra : PN.white
        return [
          { text: r.date, options: { fill: { color: zebra }, color: PN.ink, fontSize: 9, align: 'center' as const, valign: 'middle' as const } },
          { text: r.time, options: { fill: { color: zebra }, color: PN.body2, fontSize: 9, align: 'center' as const, valign: 'middle' as const } },
          { text: r.title, options: { fill: { color: zebra }, color: PN.ink, fontSize: 9, align: 'left' as const, valign: 'middle' as const } },
          { text: r.location, options: { fill: { color: zebra }, color: PN.body, fontSize: 8.5, align: 'center' as const, valign: 'middle' as const } },
          { text: `${r.attendeeCount}명`, options: { fill: { color: zebra }, color: PN.body, fontSize: 9, align: 'center' as const, valign: 'middle' as const } },
        ]
      })
    : [[{ text: '예정된 회의 없음', options: { fill: { color: PN.zebra }, color: PN.gray, fontSize: 9, colspan: 5, align: 'center' as const } }]]
  if (rows.length > MEETING_CAP) {
    body.push([{ text: `… 외 ${rows.length - MEETING_CAP}건`, options: { fill: { color: PN.chip }, color: PN.gray, fontSize: 8.5, colspan: 5, align: 'center' as const } }])
  }

  slide.addTable([head, ...body], {
    x, y: y + 0.34, w, colW: [1.15, 1.35, 4.3, 1.6, 0.8], border: { type: 'solid', color: PN.line, pt: 1 },
    fontFace: FONT, rowH: 0.32, valign: 'middle', autoPage: false,
  })
}

// 표시 행수(플레이스홀더/‘외 N건’ 포함) → 표 높이 산정용
function meetingTableRows(n: number): number {
  return Math.max(1, Math.min(n, MEETING_CAP) + (n > MEETING_CAP ? 1 : 0))
}
function meetingSlide(pptx: PptxGenJS, model: WeeklyReportModel, page: number, totalPages: number) {
  const slide = baseSlide(pptx, model, `회의일정 · ${model.meta.weekLabel}`, page, totalPages)
  const y1 = 1.15
  meetingTable(pptx, slide, y1, `금주 회의일정 (${model.meta.weekRange})`, model.meetings.thisWeek)
  // 차주 표는 금주 표의 실제 높이(라벨+헤더+행) 아래에 동적 배치 → 행이 많아도 겹치지 않음
  const y2 = y1 + 0.34 + 0.34 + meetingTableRows(model.meetings.thisWeek.length) * 0.32 + 0.24
  meetingTable(pptx, slide, y2, `차주 회의일정 (${model.meta.nextWeekRange})`, model.meetings.nextWeek)
}

/** 주간 공정보고 모델 → 동국씨엠 네이비(블루+레드 듀오톤) PPTX 버퍼(nodebuffer). */
export async function buildReportDeck(model: WeeklyReportModel): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'DK_WIDE', width: W, height: H })
  pptx.layout = 'DK_WIDE'
  pptx.author = "D'Flow"
  pptx.company = "D'Flow"
  pptx.title = `${model.meta.projectName} 주간보고`

  const detailPages = detailPageCount(model)
  const hasMeetings = model.meetings.total > 0
  // 표지 + 요약 + 상세(N) + [회의일정(회의 있을 때만)] + 근태
  const totalPages = 1 + 1 + detailPages + (hasMeetings ? 1 : 0) + 1

  coverSlide(pptx, model) // 1페이지: 겉표지(페이지번호 없음)
  summarySlide(pptx, model, totalPages) // 2페이지
  detailSlides(pptx, model, totalPages, 3) // 3페이지~
  if (hasMeetings) meetingSlide(pptx, model, 3 + detailPages, totalPages) // 회의 있을 때만
  attendanceSlide(pptx, model, totalPages) // 마지막

  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
}
