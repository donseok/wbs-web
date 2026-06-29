import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseWbsWorkbook } from '@/lib/excel/parse'

function makeBook(): ArrayBuffer {
  const wbs = XLSX.utils.aoa_to_sheet([
    ['Biz.', 'Phase', 'Task', 'Activity', '', '', '담당', '', '', '', 'Status', '산출물', '계획'],
    ['', '', '', '', '', '', 'PMO', 'DT', 'ERP', 'MES', '', '', 'Start', 'End'],
    ['타이틀', '', '', '', '', '', 'PMO', 'DT', 'ERP', 'MES', '', '', 'Start', 'End'],
    ['', '1. 준비', '', '', '', '', '', '', '', '', '', '', new Date(2026,6,1), new Date(2026,6,9)],
    ['', '', '1-1. 거버넌스', '', '', '', '', '', '', '', '', '', new Date(2026,6,1), new Date(2026,6,7)],
    ['', '', '', 'TFT R&R 확정', '', '', '●', '', '', '', '', '업무분장표', new Date(2026,6,1), new Date(2026,6,7)],
    ['', '', '', '현황 파악', '', '', '', '●', '△', '△', '', '', new Date(2026,6,13), new Date(2026,6,24)],
  ])
  const hol = XLSX.utils.aoa_to_sheet([
    ['Holiday'], [new Date(2026,6,17), '제헌절'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wbs, 'WBS')
  XLSX.utils.book_append_sheet(wb, hol, 'Holiday')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

describe('parseWbsWorkbook', () => {
  const parsed = parseWbsWorkbook(makeBook())

  it('Phase/Task/Activity level 판정', () => {
    const levels = parsed.rows.map(r => r.level)
    expect(levels).toEqual(['phase', 'task', 'activity', 'activity'])
  })
  it('담당 ●=primary, △=support 추출', () => {
    const tft = parsed.rows.find(r => r.name === 'TFT R&R 확정')!
    expect(tft.owners).toEqual([{ team: 'PMO', kind: 'primary' }])
    const sang = parsed.rows.find(r => r.name === '현황 파악')!
    expect(sang.owners).toEqual([
      { team: 'DT', kind: 'primary' },
      { team: 'ERP', kind: 'support' },
      { team: 'MES', kind: 'support' },
    ])
  })
  it('계획 일자 ISO 변환', () => {
    const tft = parsed.rows.find(r => r.name === 'TFT R&R 확정')!
    expect(tft.plannedStart).toBe('2026-07-01')
    expect(tft.plannedEnd).toBe('2026-07-07')
  })
  it('산출물 추출', () => {
    const tft = parsed.rows.find(r => r.name === 'TFT R&R 확정')!
    expect(tft.deliverable).toBe('업무분장표')
  })
  it('공휴일 시트 파싱', () => {
    expect(parsed.holidays).toContainEqual({ date: '2026-07-17', name: '제헌절' })
  })
})
