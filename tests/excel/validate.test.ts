import { describe, it, expect } from 'vitest'
import { validateAndLink } from '@/lib/excel/validate'
import type { ParsedWbs } from '@/lib/excel/parse'

const base = (over: Partial<ParsedWbs['rows'][0]>): ParsedWbs['rows'][0] => ({
  level: 'activity' as const, code: 'x', name: 'n', biz: null, deliverable: null,
  plannedStart: '2026-07-01', plannedEnd: '2026-07-07', weight: null, actualPct: null,
  owners: [], excelRow: 1, ...over,
})

describe('validateAndLink', () => {
  it('정상 계층 연결', () => {
    const p: ParsedWbs = { holidays: [], rows: [
      base({ level: 'phase', name: '1. 준비', excelRow: 4 }),
      base({ level: 'task', name: '1-1', excelRow: 5 }),
      base({ level: 'activity', name: 'a', excelRow: 6 }),
    ] }
    const res = validateAndLink(p)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.items[2].parentTempId).toBe(res.items[1].tempId)
      expect(res.items[1].parentTempId).toBe(res.items[0].tempId)
    }
  })
  it('상위 없는 activity는 오류', () => {
    const p: ParsedWbs = { holidays: [], rows: [base({ level: 'activity', excelRow: 6 })] }
    const res = validateAndLink(p)
    expect(res.ok).toBe(false)
  })
  it('start>end 오류', () => {
    const p: ParsedWbs = { holidays: [], rows: [
      base({ level: 'phase', excelRow: 4 }),
      base({ level: 'task', excelRow: 5 }),
      base({ level: 'activity', plannedStart: '2026-07-10', plannedEnd: '2026-07-01', excelRow: 6 }),
    ] }
    const res = validateAndLink(p)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors[0].excelRow).toBe(6)
  })
})
