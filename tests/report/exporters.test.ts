import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { buildReportModel } from '@/lib/report/model'
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
    node({ name: '킥오프', status: 'done', rolledActualPct: 100, owners: [{ team: 'PMO', kind: 'primary' }], plannedEnd: '2026-02-01' }),
  ], { plannedPct: 90, rolledActualPct: 100, status: 'done' }),
  phase('설계', [
    node({ name: 'TO-BE 설계', status: 'delayed', rolledActualPct: 30, owners: [{ team: 'DT', kind: 'primary' }, { team: 'ERP', kind: 'support' }], plannedEnd: '2026-04-15' }),
    node({ name: '요구사항 정의', status: 'in_progress', rolledActualPct: 60, owners: [{ team: 'ERP', kind: 'primary' }], plannedEnd: '2026-05-01' }),
  ], { plannedPct: 50, rolledActualPct: 45, status: 'delayed' }),
]
const project = { name: 'D-CUBE PI', description: 'PI Master Plan', start_date: '2026-01-01', end_date: '2026-12-31' }
const model = buildReportModel(sampleItems, project, '2026-06-30')
const emptyModel = buildReportModel([], { name: '빈 프로젝트' }, '2026-06-30')

describe('buildReportWorkbook', () => {
  it('두 시트(현황요약/지연작업)를 가진 유효한 xlsx 생성', async () => {
    const buf = await buildReportWorkbook(model)
    expect(buf.byteLength).toBeGreaterThan(0)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    expect(wb.worksheets.map(w => w.name)).toEqual(['현황요약', '지연작업'])
  })

  it('요약 시트 제목/KPI 셀이 모델 값을 반영', async () => {
    const buf = await buildReportWorkbook(model)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.getWorksheet('현황요약')!
    expect(String(ws.getCell('A1').value)).toContain('D-CUBE PI')
    expect(String(ws.getCell('A1').value)).toContain('현황 보고서')
  })

  it('지연작업 시트에 지연 항목명이 들어감', async () => {
    const buf = await buildReportWorkbook(model)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.getWorksheet('지연작업')!
    const text = JSON.stringify(ws.getSheetValues())
    expect(text).toContain('TO-BE 설계')
  })

  it('빈 모델도 깨지지 않고 두 시트 생성', async () => {
    const buf = await buildReportWorkbook(emptyModel)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    expect(wb.worksheets.length).toBe(2)
  })
})

describe('buildReportDeck', () => {
  it('유효한 pptx(zip) 버퍼 생성 — PK 시그니처', async () => {
    const buf = await buildReportDeck(model)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf[0]).toBe(0x50) // 'P'
    expect(buf[1]).toBe(0x4b) // 'K'
  })

  it('빈 모델 / 지연 0건도 깨지지 않음', async () => {
    const buf = await buildReportDeck(emptyModel)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf[0]).toBe(0x50)
  })

  it('표가 넘쳐 슬라이드가 분할돼도 모든 슬라이드가 브랜드 유지(배경 존재) — 빈 화이트 슬라이드 없음', async () => {
    // 지연 30건 + Phase 25개 → 표 오버플로 → 다중 페이지
    const manyDelayed: ComputedItem[] = Array.from({ length: 25 }, (_, i) =>
      phase(`Phase ${i + 1}`, [
        node({ name: `지연작업 ${i + 1}`, status: 'delayed', rolledActualPct: i % 100, plannedEnd: `2026-${String((i % 12) + 1).padStart(2, '0')}-15`, owners: [{ team: 'DT', kind: 'primary' }] }),
      ], { plannedPct: 50, rolledActualPct: 20, status: 'delayed' }),
    )
    const model = buildReportModel(manyDelayed, { name: '대형 프로젝트' }, '2026-06-30')
    expect(model.delayed.length).toBe(25)
    expect(model.phases.length).toBe(25)

    const buf = await buildReportDeck(model)
    const zip = await JSZip.loadAsync(buf)
    const slidePaths = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    expect(slidePaths.length).toBeGreaterThan(5) // 분할 발생

    for (const p of slidePaths) {
      const xml = await zip.files[p].async('string')
      // 모든 슬라이드는 배경(<p:bg>)을 가져야 한다 → 브랜드 유실(빈 화이트) 없음
      expect(xml, `${p} 배경 누락(빈 화이트 슬라이드)`).toContain('<p:bg>')
      // 푸터의 D'Flow 표기도 모든 본문 슬라이드에 존재
    }
  })
})
