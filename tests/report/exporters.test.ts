import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import { buildReportWorkbook } from '@/lib/report/excel'
import { buildReportDeck } from '@/lib/report/pptx'
import type { ComputedItem } from '@/lib/domain/types'

const node = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: Math.random().toString(36).slice(2), parentId: null, level: 'activity', code: '1', sortOrder: 1,
    name: 'n', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem
const phase = (name: string, children: ComputedItem[], over: Partial<ComputedItem> = {}): ComputedItem =>
  node({ level: 'phase', name, children, ...over })

const sampleItems: ComputedItem[] = [
  phase('착수', [
    node({ name: '킥오프', status: 'done', rolledActualPct: 100, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-01-20', plannedEnd: '2026-02-01' }),
  ], { weight: 1, plannedPct: 90, rolledActualPct: 100, status: 'done' }),
  phase('설계', [
    node({ name: 'TO-BE 설계', status: 'delayed', rolledActualPct: 30, owners: [{ team: '가공', kind: 'primary' }, { team: 'ERP', kind: 'support' }], plannedStart: '2026-04-01', plannedEnd: '2026-04-15' }),
    node({ name: '요구사항 정의', status: 'in_progress', rolledActualPct: 60, owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
  ], { weight: 1, plannedPct: 50, rolledActualPct: 45, status: 'delayed' }),
]
const project = { name: 'D-CUBE PI', description: 'PI Master Plan', start_date: '2026-01-01', end_date: '2026-12-31' }
const model = buildWeeklyReportModel(sampleItems, project, '2026-06-30', { generatedAt: '2026-06-30 13:20' })
const emptyModel = buildWeeklyReportModel([], { name: '빈 프로젝트' }, '2026-06-30')

describe('buildReportWorkbook (보라 공정보고 2시트)', () => {
  it('2개 시트(공정보고/WBS) — 프로그램개발현황 제외', async () => {
    const buf = await buildReportWorkbook(model)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    expect(wb.worksheets.map(w => w.name)).toEqual(['1.공정보고', '2.WBS'])
  })

  it('공정보고 제목/주차가 모델 값을 반영', async () => {
    const buf = await buildReportWorkbook(model)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.getWorksheet('1.공정보고')!
    expect(String(ws.getCell('A2').value)).toContain('D-CUBE PI')
    expect(String(ws.getCell('A2').value)).toContain('공정보고')
    expect(String(ws.getCell('B3').value)).toContain('6월 5주차')
  })

  it('WBS 시트에 전체 노드가 들어감(지연 항목명 포함)', async () => {
    const buf = await buildReportWorkbook(model)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const text = JSON.stringify(wb.getWorksheet('2.WBS')!.getSheetValues())
    expect(text).toContain('TO-BE 설계')
  })

  it('빈 모델도 깨지지 않고 2시트 생성', async () => {
    const buf = await buildReportWorkbook(emptyModel)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    expect(wb.worksheets.length).toBe(2)
  })
})

describe('buildReportDeck (네이비 주간보고)', () => {
  it('유효한 pptx(zip) — PK 시그니처', async () => {
    const buf = await buildReportDeck(model)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it('빈 모델도 깨지지 않음', async () => {
    const buf = await buildReportDeck(emptyModel)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf[0]).toBe(0x50)
  })

  it('모든 슬라이드가 브랜드 배경(<p:bg>) 유지 + 주간보고/근태 슬라이드 포함', async () => {
    const buf = await buildReportDeck(model)
    const zip = await JSZip.loadAsync(buf)
    const slidePaths = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    expect(slidePaths.length).toBeGreaterThanOrEqual(3) // 요약 + 상세 + 근태
    const xmls = await Promise.all(slidePaths.map(p => zip.files[p].async('string')))
    for (const [i, xml] of xmls.entries()) {
      expect(xml, `slide ${i + 1} 배경 누락`).toContain('<p:bg>')
    }
    const joined = xmls.join('')
    expect(joined).toContain('주간보고')
    expect(joined).toContain('근태현황')
  })
})
