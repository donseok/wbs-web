import { describe, it, expect } from 'vitest'
import { businessDaysBetween, makeBizDayIndex } from '@/lib/domain/dates'

const H = new Set(['2026-07-17'])          // 제헌절 (금)
const idx = makeBizDayIndex('2026-07-01', '2026-07-31', H)

function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

describe('makeBizDayIndex', () => {
  it('창 안의 모든 (a,b) 쌍에서 businessDaysBetween과 동일하다', () => {
    const days = eachDay('2026-07-01', '2026-07-31')
    for (const a of days) for (const b of days) {
      expect(idx.between(a, b)).toBe(businessDaysBetween(a, b, H))
    }
  })

  it('b < a 이면 0', () => {
    expect(idx.between('2026-07-10', '2026-07-01')).toBe(0)
  })

  it('같은 날: 평일 1, 주말 0, 공휴일 0', () => {
    expect(idx.between('2026-07-01', '2026-07-01')).toBe(1)   // 수
    expect(idx.between('2026-07-04', '2026-07-04')).toBe(0)   // 토
    expect(idx.between('2026-07-17', '2026-07-17')).toBe(0)   // 공휴일
  })

  it('창 밖 날짜는 businessDaysBetween으로 폴백한다', () => {
    expect(idx.between('2026-06-29', '2026-07-03')).toBe(businessDaysBetween('2026-06-29', '2026-07-03', H))
    expect(idx.between('2026-07-28', '2026-08-05')).toBe(businessDaysBetween('2026-07-28', '2026-08-05', H))
  })

  it('창 안이어도 정규화되지 않은 키는 권위 구현으로 폴백한다 (NaN 금지)', () => {
    const v = idx.between('2026-07-01', '2026-07-2')   // 일 자리 0-padding 누락
    expect(Number.isNaN(v)).toBe(false)
    expect(v).toBe(businessDaysBetween('2026-07-01', '2026-07-2', H))
  })

  it('Date 객체를 재할당하지 않는다 — 184일 창을 1000회 조회해도 10ms 미만', () => {
    const big = makeBizDayIndex('2026-07-01', '2026-12-31', H)
    const t0 = performance.now()
    for (let i = 0; i < 1000; i++) big.between('2026-07-01', '2026-12-31')
    expect(performance.now() - t0).toBeLessThan(10)
  })
})
