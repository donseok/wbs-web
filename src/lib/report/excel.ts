import ExcelJS from 'exceljs'
import type { WeeklyReportModel } from './weekly'
import { statusKr } from './weekly'
import { roundWeight } from '@/lib/domain/format'
import { PX, argb, asciiBar } from './dkbrand'

type Cell = ExcelJS.Cell
type Worksheet = ExcelJS.Worksheet
type Align = 'left' | 'center' | 'right'

const THIN = { style: 'thin' as const, color: { argb: argb(PX.line) } }
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN }

function fill(cell: Cell, hex: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } }
}
function setCell(
  cell: Cell, value: ExcelJS.CellValue,
  opts: { bg?: string; color?: string; size?: number; bold?: boolean; align?: Align; wrap?: boolean; border?: boolean } = {},
) {
  cell.value = value
  cell.font = { color: { argb: argb(opts.color ?? PX.ink) }, size: opts.size ?? 10, bold: opts.bold ?? false }
  if (opts.bg) fill(cell, opts.bg)
  cell.alignment = { vertical: 'middle', horizontal: opts.align ?? 'left', wrapText: opts.wrap ?? false }
  if (opts.border !== false) cell.border = BORDER
}
/** 섹션 머리띠(병합 + 퍼플 배경). */
function sectionBar(ws: Worksheet, row: number, lastCol: number, text: string) {
  ws.mergeCells(row, 1, row, lastCol)
  setCell(ws.getCell(row, 1), text, { bg: PX.purple, color: PX.white, size: 11, bold: true })
  ws.getRow(row).height = 20
}
function headerRow(ws: Worksheet, row: number, headers: { t: string; align?: Align }[]) {
  headers.forEach((h, i) => setCell(ws.getCell(row, i + 1), h.t, { bg: PX.purple, color: PX.white, size: 10, bold: true, align: h.align ?? 'center' }))
}
function fmtD(d: string | null): string {
  return d ?? ''
}

/* ════════════════════ 시트 1: 공정보고 ════════════════════ */
function buildProcessSheet(ws: Worksheet, model: WeeklyReportModel) {
  const { meta, kpi } = model
  ws.columns = [{ width: 11 }, { width: 12 }, { width: 14 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 8 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }]
  const LAST = 12

  // 제목
  ws.mergeCells('A2:L2')
  setCell(ws.getCell('A2'), `${meta.projectName} ${meta.weekLabel} 공정보고`, { bg: PX.purple, color: PX.white, size: 18, bold: true })
  ws.getRow(2).height = 30
  // 메타
  setCell(ws.getCell('A3'), '기준주', { bg: PX.purpleLight, color: PX.gray, size: 9, bold: true })
  setCell(ws.getCell('B3'), meta.weekLabel, { size: 10 })
  setCell(ws.getCell('E3'), '생성일', { bg: PX.purpleLight, color: PX.gray, size: 9, bold: true })
  setCell(ws.getCell('F3'), meta.generatedAt, { size: 10 })
  setCell(ws.getCell('I3'), '프로젝트', { bg: PX.purpleLight, color: PX.gray, size: 9, bold: true })
  ws.mergeCells('J3:L3')
  setCell(ws.getCell('J3'), meta.projectName, { size: 10 })

  // ── 핵심 지표 ──
  sectionBar(ws, 5, LAST, '▣ 핵심 지표')
  const red = { bg: PX.redBg, color: PX.red }
  const purp = { bg: PX.zebra, color: PX.ink }
  const grn = { bg: PX.greenBg, color: PX.green }
  type K = { label: string; value: ExcelJS.CellValue; sub: string; tone: { bg: string; color: string }; merge?: boolean }
  const ks: K[] = [
    { label: '프로젝트 진척', value: `${kpi.actual}%`, sub: `계획 ${kpi.planned}%`, tone: red },
    { label: '계획-실적 격차', value: `${kpi.variance > 0 ? '+' : ''}${kpi.variance}%p`, sub: kpi.variance < 0 ? '미달' : '양호', tone: kpi.variance < 0 ? red : grn },
    { label: '전체 작업', value: kpi.total, sub: `${meta.phaseCount}개 Phase`, tone: purp },
    { label: '완료', value: kpi.done, sub: `${kpi.doneRatio}%`, tone: grn },
    { label: '진행중', value: kpi.inProgress, sub: `${kpi.inProgressRatio}%`, tone: purp },
    { label: '대기', value: kpi.notStarted, sub: '미착수', tone: purp },
    { label: '보류', value: kpi.onHold, sub: 'on hold', tone: purp },
    { label: '지연', value: kpi.delayed, sub: `${kpi.delayedRatio}%`, tone: red },
    { label: '금주 완료', value: kpi.doneThisWeek, sub: `신규 ${kpi.doneThisWeek}`, tone: grn, merge: true },
  ]
  ks.forEach((k, i) => {
    const col = i + 1
    if (k.merge) { ws.mergeCells(6, col, 6, LAST); ws.mergeCells(7, col, 7, LAST); ws.mergeCells(8, col, 8, LAST) }
    setCell(ws.getCell(6, col), k.label, { bg: k.tone.bg, color: PX.gray, size: 9, bold: true, align: 'center' })
    setCell(ws.getCell(7, col), k.value, { bg: k.tone.bg, color: k.tone.color, size: 20, bold: true, align: 'center' })
    setCell(ws.getCell(8, col), k.sub, { bg: k.tone.bg, color: k.tone.color, size: 9, align: 'center' })
  })
  ws.getRow(7).height = 28

  // ── 1) 공정 진도 현황 ──
  sectionBar(ws, 10, LAST, '1) 공정 진도 현황')
  ws.mergeCells('I11:L11')
  headerRow(ws, 11, [{ t: '구분', align: 'left' }, { t: '항목', align: 'left' }, { t: '점유율(%)' }, { t: '계획(%)' }, { t: '실적(%)' }, { t: '격차(%p)' }, { t: '완료/전체' }, { t: '지연' }, { t: '비고', align: 'left' }])
  let r = 12
  for (const p of model.phases) {
    const zebra = r % 2 === 0 ? PX.zebra : PX.white
    setCell(ws.getCell(r, 1), p.name, { bg: zebra })
    setCell(ws.getCell(r, 2), p.name, { bg: zebra })
    setCell(ws.getCell(r, 3), p.weightPct, { bg: zebra, align: 'center' })
    setCell(ws.getCell(r, 4), p.plannedPct, { bg: zebra, align: 'center' })
    setCell(ws.getCell(r, 5), p.actualPct, { bg: zebra, align: 'center' })
    const gapTone = p.gap > 0 ? PX.red : p.gap < 0 ? PX.green : PX.ink
    setCell(ws.getCell(r, 6), p.gap, { bg: zebra, color: gapTone, bold: p.gap !== 0, align: 'center' })
    setCell(ws.getCell(r, 7), `${p.doneCount}/${p.totalCount}`, { bg: zebra, align: 'center' })
    setCell(ws.getCell(r, 8), p.delayedCount, { bg: p.delayedCount > 0 ? PX.redBg : zebra, color: p.delayedCount > 0 ? PX.red : PX.ink, bold: p.delayedCount > 0, align: 'center' })
    ws.mergeCells(r, 9, r, LAST)
    setCell(ws.getCell(r, 9), asciiBar(p.actualPct), { bg: zebra, align: 'left' })
    r++
  }
  // 합계
  setCell(ws.getCell(r, 1), '합계', { bg: PX.purpleLight, bold: true })
  setCell(ws.getCell(r, 2), '', { bg: PX.purpleLight })
  setCell(ws.getCell(r, 3), 100, { bg: PX.purpleLight, bold: true, align: 'center' })
  setCell(ws.getCell(r, 4), kpi.planned, { bg: PX.purpleLight, bold: true, align: 'center' })
  setCell(ws.getCell(r, 5), kpi.actual, { bg: PX.purpleLight, bold: true, align: 'center' })
  setCell(ws.getCell(r, 6), kpi.planned - kpi.actual, { bg: PX.purpleLight, bold: true, align: 'center' })
  setCell(ws.getCell(r, 7), `${kpi.done}/${kpi.total}`, { bg: PX.purpleLight, bold: true, align: 'center' })
  setCell(ws.getCell(r, 8), kpi.delayed, { bg: PX.purpleLight, bold: true, align: 'center' })
  ws.mergeCells(r, 9, r, LAST)
  setCell(ws.getCell(r, 9), asciiBar(kpi.actual), { bg: PX.purpleLight, bold: true, align: 'left' })
  r += 2

  // ── 2) 공정 실적 및 계획 ──
  sectionBar(ws, r, LAST, '2) 공정 실적 및 계획'); r++
  ws.mergeCells(r, 1, r, 2); ws.mergeCells(r, 3, r, 4); ws.mergeCells(r, 5, r, 7)
  setCell(ws.getCell(r, 1), '구분', { bg: PX.purple, color: PX.white, size: 11, bold: true })
  setCell(ws.getCell(r, 3), '항목', { bg: PX.purple, color: PX.white, size: 11, bold: true })
  setCell(ws.getCell(r, 5), '금주 실적', { bg: PX.purple, color: PX.white, size: 11, bold: true })
  setCell(ws.getCell(r, 8), '계획', { bg: PX.purple, color: PX.white, size: 11, bold: true, align: 'center' })
  setCell(ws.getCell(r, 9), '실적', { bg: PX.purple, color: PX.white, size: 11, bold: true, align: 'center' })
  r++
  model.planActual.forEach((p, i) => {
    const zebra = i % 2 === 1 ? PX.purpleLight : PX.zebra
    ws.mergeCells(r, 1, r, 2); ws.mergeCells(r, 3, r, 4); ws.mergeCells(r, 5, r, 7)
    setCell(ws.getCell(r, 1), p.phaseName, { bg: zebra, size: 9 })
    setCell(ws.getCell(r, 3), p.phaseName, { bg: zebra, size: 9 })
    const work = p.thisWeek.length ? p.thisWeek.map(t => `▸ ${t.name} (${t.ownerText})`).join('\n') : '(해당 없음)'
    setCell(ws.getCell(r, 5), work, { bg: zebra, size: 9, wrap: true })
    setCell(ws.getCell(r, 8), p.plannedPct, { bg: zebra, color: PX.ink, size: 10, bold: true, align: 'center' })
    setCell(ws.getCell(r, 9), p.actualPct, { bg: zebra, color: p.actualPct < p.plannedPct ? PX.red : PX.ink, size: 10, bold: true, align: 'center' })
    if (p.thisWeek.length > 1) ws.getRow(r).height = Math.min(14 * p.thisWeek.length + 6, 80)
    r++
  })
  r++

  // ── 4) 담당자별 워크로드 ──
  sectionBar(ws, r, LAST, '4) 담당자별 워크로드'); r++
  headerRow(ws, r, [{ t: '#' }, { t: '담당자', align: 'left' }, { t: '월' }, { t: '화' }, { t: '수' }, { t: '목' }, { t: '금' }, { t: '합계' }, { t: '비고', align: 'left' }])
  r++
  model.workload.forEach((w, i) => {
    const zebra = i % 2 === 1 ? PX.zebra : PX.white
    setCell(ws.getCell(r, 1), i + 1, { bg: zebra, align: 'center' })
    setCell(ws.getCell(r, 2), w.name, { bg: zebra })
    w.perDay.forEach((v, d) => setCell(ws.getCell(r, 3 + d), v, { bg: PX.workload, color: PX.ink, bold: true, align: 'center' }))
    setCell(ws.getCell(r, 8), w.total, { bg: zebra, bold: true, align: 'center' })
    setCell(ws.getCell(r, 9), w.note, { bg: zebra })
    r++
  })
  r++

  // ── 5) 이슈 / 리스크 ──
  sectionBar(ws, r, LAST, '5) 이슈 / 리스크'); r++
  ws.mergeCells(r, 3, r, 7); ws.mergeCells(r, 8, r, LAST)
  setCell(ws.getCell(r, 1), '#', { bg: PX.purple, color: PX.white, size: 10, bold: true, align: 'center' })
  setCell(ws.getCell(r, 2), '등급', { bg: PX.purple, color: PX.white, size: 10, bold: true, align: 'center' })
  setCell(ws.getCell(r, 3), '내용', { bg: PX.purple, color: PX.white, size: 10, bold: true, align: 'center' })
  setCell(ws.getCell(r, 8), '대응방안', { bg: PX.purple, color: PX.white, size: 10, bold: true, align: 'center' })
  r++
  model.issues.forEach((it, i) => {
    const tone = it.grade === '높음' ? { bg: PX.redBg, color: PX.red } : it.grade === '중간' ? { bg: PX.amberBg, color: PX.amber } : { bg: PX.greenBg, color: PX.green }
    setCell(ws.getCell(r, 1), i + 1, { align: 'center' })
    setCell(ws.getCell(r, 2), it.grade, { bg: tone.bg, color: tone.color, bold: true, align: 'center' })
    ws.mergeCells(r, 3, r, 7); ws.mergeCells(r, 8, r, LAST)
    setCell(ws.getCell(r, 3), it.content)
    setCell(ws.getCell(r, 8), it.action)
    r++
  })
}

/* ════════════════════ 시트 2: WBS ════════════════════ */
function buildWbsSheet(ws: Worksheet, model: WeeklyReportModel) {
  ws.columns = [
    { width: 5 }, { width: 9 }, { width: 42 }, { width: 18 }, { width: 12 }, { width: 8 }, { width: 12 }, { width: 12 },
    { width: 8 }, { width: 12 }, { width: 12 }, { width: 8 }, { width: 9 }, { width: 7 }, { width: 16 }, { width: 9 },
  ]
  ws.mergeCells('A1:P1')
  setCell(ws.getCell('A1'), `${model.meta.projectName} WBS`, { bg: PX.purple, color: PX.white, size: 15, bold: true })
  ws.getRow(1).height = 26
  ws.mergeCells('A2:F2'); ws.mergeCells('G2:O2')
  setCell(ws.getCell('A2'), `기준주 ${model.meta.weekLabel}`, { bg: PX.phaseRow, color: PX.ink, size: 9 })
  setCell(ws.getCell('G2'), `전체 ${model.kpi.total} · 완료 ${model.kpi.done} · 진행중 ${model.kpi.inProgress} · 지연 ${model.kpi.delayed}`, { bg: PX.phaseRow, color: PX.ink, size: 9 })
  setCell(ws.getCell('P2'), `생성 ${model.meta.generatedAt}`, { bg: PX.phaseRow, color: PX.ink, size: 9, align: 'center' })

  headerRow(ws, 3, [
    { t: 'No' }, { t: 'Lv' }, { t: '작업명', align: 'left' }, { t: '산출물', align: 'left' }, { t: '담당자', align: 'left' }, { t: '가중치' },
    { t: '계획시작' }, { t: '계획종료' }, { t: '계획(%)' }, { t: '실적시작' }, { t: '실적종료' }, { t: '실적(%)' }, { t: '격차(%p)' }, { t: '지연일' }, { t: '선행작업', align: 'left' }, { t: '상태' },
  ])
  let r = 4
  for (const row of model.wbs) {
    const bg = row.level === 'phase' ? PX.phaseRow : row.level === 'task' ? PX.actRow : r % 2 === 0 ? PX.zebra : PX.white
    const bold = row.level === 'phase' || row.level === 'task'
    setCell(ws.getCell(r, 1), row.no, { bg, bold, align: 'center' })
    setCell(ws.getCell(r, 2), row.levelLabel, { bg, bold })
    setCell(ws.getCell(r, 3), `${'  '.repeat(row.depth)}${row.name}`, { bg, bold })
    setCell(ws.getCell(r, 4), row.deliverable, { bg, bold })
    setCell(ws.getCell(r, 5), row.ownerText, { bg, bold })
    setCell(ws.getCell(r, 6), row.weight == null ? '' : roundWeight(row.weight), { bg, bold, align: 'center' })
    setCell(ws.getCell(r, 7), fmtD(row.plannedStart), { bg, bold, align: 'center' })
    setCell(ws.getCell(r, 8), fmtD(row.plannedEnd), { bg, bold, align: 'center' })
    setCell(ws.getCell(r, 9), row.plannedPct, { bg, bold, align: 'center' })
    setCell(ws.getCell(r, 10), '', { bg, bold, align: 'center' })
    setCell(ws.getCell(r, 11), '', { bg, bold, align: 'center' })
    setCell(ws.getCell(r, 12), row.actualPct, { bg, bold, align: 'center' })
    setCell(ws.getCell(r, 13), row.gap, { bg, color: row.gap > 0 ? PX.red : row.gap < 0 ? PX.green : PX.ink, bold, align: 'center' })
    setCell(ws.getCell(r, 14), row.delayDays || '', { bg, color: row.delayDays > 0 ? PX.red : PX.ink, bold, align: 'center' })
    setCell(ws.getCell(r, 15), '', { bg, bold })
    setCell(ws.getCell(r, 16), statusKr(row.status), { bg, bold, align: 'center' })
    r++
  }
  ws.views = [{ state: 'frozen', ySplit: 3 }]
}

/** 주간 공정보고 모델 → 동국제강 보라 2시트 xlsx 버퍼(공정보고 + WBS). */
export async function buildReportWorkbook(model: WeeklyReportModel): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "D'Flow"
  wb.created = new Date(model.meta.today + 'T00:00:00Z')

  buildProcessSheet(wb.addWorksheet('1.공정보고', { views: [{ showGridLines: false }] }), model)
  buildWbsSheet(wb.addWorksheet('2.WBS', { views: [{ showGridLines: false }] }), model)
  // 3.프로그램개발현황 시트는 요청에 따라 제외(프로그램 리스트 불필요).

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
