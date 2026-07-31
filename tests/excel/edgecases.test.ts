import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseWbsWorkbook } from '@/lib/excel/parse'
import { validateAndLink } from '@/lib/excel/validate'
import type { ParsedWbs } from '@/lib/excel/parse'

// 4단+ 깊이 회귀 케이스는 여기 없음 — validateAndLink 는 level 이 phase/task 가 아니면 무조건
// lastTask 에 매달리는 3분기 구조라(3열 고정 양식, Plan B 전) 4단 입력 자체를 표현할 수 없다.
// 도메인 통과 지점(buildTree→computeTree)의 4단 케이스는 tests/domain/edgecases.test.ts
// 'computeTree 4단+ 롤업' 참조.

const base = (over: Partial<ParsedWbs['rows'][0]>): ParsedWbs['rows'][0] => ({
  level: 'activity', code: 'x', name: 'n', biz: null, deliverable: null,
  plannedStart: '2026-07-01', plannedEnd: '2026-07-07', weight: null, actualPct: null,
  owners: [], excelRow: 1, ...over,
})

describe('validateAndLink edge cases', () => {
  it('Phase 없는 Task는 오류', () => {
    const res = validateAndLink({ holidays: [], rows: [base({ level: 'task', excelRow: 4 })] })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors[0].message).toContain('Phase')
  })
  it('시작일만 있고 종료일 없으면 오류', () => {
    const res = validateAndLink({ holidays: [], rows: [
      base({ level: 'phase', excelRow: 4 }),
      base({ level: 'task', excelRow: 5 }),
      base({ level: 'activity', plannedStart: '2026-07-01', plannedEnd: null, excelRow: 6 }),
    ] })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.some(e => e.excelRow === 6)).toBe(true)
  })
})

describe('parseWbsWorkbook edge cases', () => {
  it('Holiday 시트가 없으면 holidays는 빈 배열', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Biz', 'Phase', 'Task', 'Activity', '', '', '담당'],
      ['', '', '', '', '', '', 'PMO', 'ERP', 'MES', '가공'],
      ['타이틀', '', '', '', '', '', '', '', '', ''],
      ['', '1. 준비', '', ''],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'WBS')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const parsed = parseWbsWorkbook(buf)
    expect(parsed.holidays).toEqual([])
    expect(parsed.rows.map(r => r.level)).toEqual(['phase'])
  })

  it('WBS 시트가 없어도 예외 없이 빈 행 반환', () => {
    const ws = XLSX.utils.aoa_to_sheet([['Holiday'], [new Date(Date.UTC(2026, 6, 17)), '제헌절']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Holiday')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const parsed = parseWbsWorkbook(buf)
    expect(parsed.rows).toEqual([])
    expect(parsed.holidays).toContainEqual({ date: '2026-07-17', name: '제헌절' })
  })
})
