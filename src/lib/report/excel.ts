import ExcelJS from 'exceljs'
import type { ReportModel } from './model'
import { C, STATUS_LABEL, TEAM_COLOR, argb, ownersText } from './brand'

type Cell = ExcelJS.Cell
type Worksheet = ExcelJS.Worksheet

const THIN = { style: 'thin' as const, color: { argb: argb(C.line) } }
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN }

function fill(cell: Cell, hex: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } }
}

/** 헤더 셀: 브랜드 배경 + 흰 굵은 글씨 + 테두리. */
function headerCell(cell: Cell, text: string, align: 'left' | 'center' | 'right' = 'left') {
  cell.value = text
  cell.font = { bold: true, color: { argb: argb(C.white) }, size: 10 }
  fill(cell, C.brand)
  cell.alignment = { vertical: 'middle', horizontal: align }
  cell.border = BORDER
}

function bodyCell(cell: Cell, value: ExcelJS.CellValue, align: 'left' | 'center' | 'right' = 'left') {
  cell.value = value
  cell.font = { color: { argb: argb(C.ink) }, size: 10 }
  cell.alignment = { vertical: 'middle', horizontal: align }
  cell.border = BORDER
}

/** 'YYYY-MM-DD' → '2026.09.15' (없으면 '-') */
function fmtDate(d: string | null): string {
  return d ? d.replace(/-/g, '.') : '-'
}
/** 'YYYY-MM-DD' → '2026년 9월 15일' */
function fmtFull(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${y}년 ${Number(m)}월 ${Number(day)}일`
}

function buildSummarySheet(ws: Worksheet, model: ReportModel) {
  const { meta, kpi, phases, teams } = model
  ws.columns = [{ width: 34 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }]
  ws.getColumn(1).alignment = { vertical: 'middle' }

  // ── 제목 ──
  ws.mergeCells('A1:E1')
  const title = ws.getCell('A1')
  title.value = `${meta.projectName} — 현황 보고서`
  title.font = { bold: true, size: 16, color: { argb: argb(C.ink) } }
  title.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 26

  ws.mergeCells('A2:E2')
  const sub = ws.getCell('A2')
  const period = meta.startDate || meta.endDate ? `기간 ${fmtFull(meta.startDate)} ~ ${fmtFull(meta.endDate)}   ·   ` : ''
  sub.value = `${period}생성일 ${fmtFull(meta.today)}   ·   전체 작업 ${meta.totalLeaves}건`
  sub.font = { size: 10, color: { argb: argb(C.inkSubtle) } }
  if (meta.description) {
    ws.mergeCells('A3:E3')
    const desc = ws.getCell('A3')
    desc.value = meta.description
    desc.font = { size: 10, color: { argb: argb(C.inkMuted) }, italic: true }
  }

  let r = 5
  // ── KPI ──
  ws.getCell(`A${r}`).value = '전체 요약'
  ws.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: argb(C.brand) } }
  r += 1
  const kpiCols = [
    { label: '전체 실적', value: `${kpi.actual}%`, hex: C.brand },
    { label: '전체 계획', value: `${kpi.planned}%`, hex: C.inkSubtle },
    { label: '계획 대비 편차', value: `${kpi.variance > 0 ? '+' : ''}${kpi.variance}%p`, hex: kpi.variance >= 0 ? C.done : C.delayed },
    { label: '지연 작업', value: `${kpi.delayedCount}건`, hex: C.delayed },
  ]
  kpiCols.forEach((k, i) => {
    const labelCell = ws.getCell(r, i + 1)
    headerCell(labelCell, k.label, 'center')
    const valueCell = ws.getCell(r + 1, i + 1)
    valueCell.value = k.value
    valueCell.font = { bold: true, size: 14, color: { argb: argb(k.hex) } }
    valueCell.alignment = { vertical: 'middle', horizontal: 'center' }
    valueCell.border = BORDER
  })
  ws.getRow(r + 1).height = 24
  r += 3

  // ── Phase별 진척 ──
  ws.getCell(`A${r}`).value = 'Phase별 진척'
  ws.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: argb(C.brand) } }
  r += 1
  const phaseHeaderRow = r
  ;['Phase', '계획', '실적', '편차', '상태'].forEach((h, i) =>
    headerCell(ws.getCell(phaseHeaderRow, i + 1), h, i === 0 ? 'left' : i === 4 ? 'center' : 'right'),
  )
  r += 1
  if (phases.length === 0) {
    ws.mergeCells(r, 1, r, 5)
    bodyCell(ws.getCell(r, 1), '표시할 Phase가 없습니다.', 'left')
    r += 1
  } else {
    for (const p of phases) {
      bodyCell(ws.getCell(r, 1), p.name, 'left')
      const planned = ws.getCell(r, 2)
      bodyCell(planned, p.plannedPct / 100, 'right'); planned.numFmt = '0%'
      const actual = ws.getCell(r, 3)
      bodyCell(actual, p.actualPct / 100, 'right'); actual.numFmt = '0%'; actual.font = { bold: true, color: { argb: argb(C.ink) }, size: 10 }
      const variance = ws.getCell(r, 4)
      bodyCell(variance, `${p.variance > 0 ? '+' : ''}${p.variance}%p`, 'right')
      variance.font = { color: { argb: argb(p.variance >= 0 ? C.done : C.delayed) }, size: 10, bold: true }
      const status = ws.getCell(r, 5)
      bodyCell(status, STATUS_LABEL[p.status], 'center')
      status.font = { color: { argb: argb(C.white) }, size: 9, bold: true }
      fill(status, STATUS_LABEL[p.status] === '완료' ? C.done : p.status === 'delayed' ? C.delayed : p.status === 'in_progress' ? C.progress : C.pending)
      r += 1
    }
  }
  r += 1

  // ── 팀별 진척 ──
  ws.getCell(`A${r}`).value = '팀별 진척'
  ws.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: argb(C.brand) } }
  r += 1
  ;['팀', '담당 작업수', '평균 실적'].forEach((h, i) =>
    headerCell(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'),
  )
  r += 1
  for (const t of teams) {
    const teamCell = ws.getCell(r, 1)
    bodyCell(teamCell, t.team, 'left')
    teamCell.font = { bold: true, color: { argb: argb(TEAM_COLOR[t.team]) }, size: 10 }
    bodyCell(ws.getCell(r, 2), `${t.count}개`, 'right')
    const pct = ws.getCell(r, 3)
    if (t.pct == null) bodyCell(pct, '-', 'right')
    else { bodyCell(pct, t.pct / 100, 'right'); pct.numFmt = '0%' }
    r += 1
  }
}

function buildDelayedSheet(ws: Worksheet, model: ReportModel) {
  const { delayed } = model
  ws.columns = [{ width: 40 }, { width: 22 }, { width: 16 }, { width: 12 }]

  ws.mergeCells('A1:D1')
  const title = ws.getCell('A1')
  title.value = '지연 작업 목록'
  title.font = { bold: true, size: 14, color: { argb: argb(C.ink) } }
  ws.getRow(1).height = 22

  const headerRow = 3
  ;['작업명', '담당', '종료일', '실적'].forEach((h, i) =>
    headerCell(ws.getCell(headerRow, i + 1), h, i === 0 || i === 1 ? 'left' : 'right'),
  )
  let r = headerRow + 1
  if (delayed.length === 0) {
    ws.mergeCells(r, 1, r, 4)
    const none = ws.getCell(r, 1)
    bodyCell(none, '현재 지연된 작업이 없습니다.', 'left')
    none.font = { color: { argb: argb(C.done) }, size: 10, bold: true }
    return
  }
  for (const d of delayed) {
    bodyCell(ws.getCell(r, 1), d.name, 'left')
    bodyCell(ws.getCell(r, 2), ownersText(d.owners), 'left')
    const end = ws.getCell(r, 3)
    bodyCell(end, fmtDate(d.plannedEnd), 'right')
    end.font = { color: { argb: argb(C.delayed) }, size: 10 }
    const actual = ws.getCell(r, 4)
    bodyCell(actual, d.actualPct / 100, 'right'); actual.numFmt = '0%'; actual.font = { bold: true, color: { argb: argb(C.ink) }, size: 10 }
    r += 1
  }
}

/** 현황 보고서 모델 → 스타일 적용 xlsx 버퍼. */
export async function buildReportWorkbook(model: ReportModel): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "D'Flow"
  wb.created = new Date(model.meta.today + 'T00:00:00Z')

  buildSummarySheet(wb.addWorksheet('현황요약', { views: [{ showGridLines: false }] }), model)
  buildDelayedSheet(wb.addWorksheet('지연작업', { views: [{ showGridLines: false }] }), model)

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
