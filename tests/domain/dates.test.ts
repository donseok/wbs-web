import { describe, it, expect } from 'vitest'
import { businessDaysBetween, isBusinessDay } from '@/lib/domain/dates'

describe('isBusinessDay', () => {
  it('주말은 영업일 아님', () => {
    expect(isBusinessDay('2026-07-04', new Set())).toBe(false) // 토
    expect(isBusinessDay('2026-07-05', new Set())).toBe(false) // 일
  })
  it('평일은 영업일', () => {
    expect(isBusinessDay('2026-07-06', new Set())).toBe(true)  // 월
  })
  it('공휴일은 영업일 아님', () => {
    expect(isBusinessDay('2026-07-17', new Set(['2026-07-17']))).toBe(false)
  })
})

describe('businessDaysBetween', () => {
  it('월~금 5영업일 (양끝 포함)', () => {
    expect(businessDaysBetween('2026-07-06', '2026-07-10', new Set())).toBe(5)
  })
  it('주말 포함 한 주는 5', () => {
    expect(businessDaysBetween('2026-07-06', '2026-07-12', new Set())).toBe(5)
  })
  it('공휴일(7/17 제헌절) 제외', () => {
    // 7/13(월)~7/17(금) 중 7/17 공휴일 → 4
    expect(businessDaysBetween('2026-07-13', '2026-07-17', new Set(['2026-07-17']))).toBe(4)
  })
  it('end<start면 0', () => {
    expect(businessDaysBetween('2026-07-10', '2026-07-06', new Set())).toBe(0)
  })
})
