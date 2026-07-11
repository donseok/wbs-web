import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import { buildReportWorkbook } from '@/lib/report/excel'
import type { ComputedItem } from '@/lib/domain/types'

const node = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: Math.random().toString(36).slice(2), parentId: null, level: 'activity', code: '1', sortOrder: 1,
    name: 'n', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem

// 대시보드 롤업과 동일한 소수 1자리 공정율이 엑셀 셀에 그대로 담기는지 검증한다.
const items: ComputedItem[] = [
  node({
    level: 'phase', name: '설계', weight: 1, plannedPct: 43.7, rolledActualPct: 21.3, status: 'in_progress',
    children: [
      node({ name: '화면 설계', status: 'in_progress', plannedPct: 43.7, rolledActualPct: 21.3, plannedStart: '2026-06-01', plannedEnd: '2026-07-31' }),
    ],
  }),
]
const project = { name: 'D-CUBE PI', description: null, start_date: null, end_date: null }

async function loadWorkbook(): Promise<ExcelJS.Workbook> {
  const model = buildWeeklyReportModel(items, project, '2026-06-30')
  const buf = await buildReportWorkbook(model)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  return wb
}

describe('buildReportWorkbook — 공정율 소수 1자리 표기', () => {
  it('핵심 지표: 프로젝트 진척·계획·격차가 소수 1자리 문자열', async () => {
    const ws = (await loadWorkbook()).getWorksheet('1.공정보고')!
    expect(ws.getCell(7, 1).value).toBe('21.3%')          // 프로젝트 진척
    expect(ws.getCell(8, 1).value).toBe('계획 43.7%')      // 진척 sub
    expect(ws.getCell(7, 2).value).toBe('-22.4%p')        // 계획-실적 격차 (노이즈 없음)
  })

  it('공정 진도 표: 계획/실적/격차 셀은 숫자 + 소수 1자리 서식(0.0)', async () => {
    const ws = (await loadWorkbook()).getWorksheet('1.공정보고')!
    // Phase 행(12행): 계획 43.7 / 실적 21.3 / 격차 22.4
    expect(ws.getCell(12, 4).value).toBe(43.7)
    expect(ws.getCell(12, 5).value).toBe(21.3)
    expect(ws.getCell(12, 6).value).toBe(22.4)
    expect(ws.getCell(12, 4).numFmt).toBe('0.0')
    // 합계 행(13행)
    expect(ws.getCell(13, 4).value).toBe(43.7)
    expect(ws.getCell(13, 5).value).toBe(21.3)
    expect(ws.getCell(13, 6).value).toBe(22.4)
    // 진척 막대 라벨도 소수 1자리
    expect(String(ws.getCell(12, 9).value)).toContain('21.3%')
  })

  it('WBS 시트: 계획(%)/실적(%)/격차(%p)가 소수 1자리 서식으로 담긴다', async () => {
    const ws = (await loadWorkbook()).getWorksheet('2.WBS')!
    // 4행 = Phase 루트
    expect(ws.getCell(4, 9).value).toBe(43.7)
    expect(ws.getCell(4, 12).value).toBe(21.3)
    expect(ws.getCell(4, 13).value).toBe(22.4)
    expect(ws.getCell(4, 12).numFmt).toBe('0.0')
  })
})
