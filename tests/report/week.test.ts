import { describe, it, expect } from 'vitest'
import { mondayIso, shiftWeeks, sheetWeekMeta } from '@/lib/report/week'

describe('mondayIso', () => {
  it('임의 요일을 그 주 월요일로 정규화(UTC)', () => {
    expect(mondayIso('2026-07-10')).toBe('2026-07-06') // 금 → 월
    expect(mondayIso('2026-07-06')).toBe('2026-07-06') // 월 그대로
    expect(mondayIso('2026-07-12')).toBe('2026-07-06') // 일 → 그 주 월
  })
})

describe('shiftWeeks', () => {
  it('주 단위 이동', () => {
    expect(shiftWeeks('2026-07-06', 1)).toBe('2026-07-13')
    expect(shiftWeeks('2026-07-06', -1)).toBe('2026-06-29')
  })
})

describe('sheetWeekMeta', () => {
  it('그 달의 몇 번째 월요일로 N주차 산정 + 월~금 범위', () => {
    // 2026-07-06 = 7월의 첫 월요일
    expect(sheetWeekMeta('2026-07-06')).toEqual({
      weekTag: '7월1주차', label: '7월 1주차', thisRange: '7/6~7/10', nextRange: '7/13~7/17',
    })
  })
  it('월 경계 주는 월요일 소속 달 기준', () => {
    // 2026-06-29(월)~7/3 → 6월의 다섯 번째 월요일 = 6월 5주차
    const m = sheetWeekMeta('2026-06-29')
    expect(m.weekTag).toBe('6월5주차')
    expect(m.thisRange).toBe('6/29~7/3')
  })
  it('월요일이 아닌 입력도 정규화 후 산정', () => {
    expect(sheetWeekMeta('2026-07-08').weekTag).toBe('7월1주차')
  })
})
