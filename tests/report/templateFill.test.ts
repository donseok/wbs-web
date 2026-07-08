import { describe, it, expect } from 'vitest'
import { capItems, capGroupsToBudget } from '@/lib/report/templateFill'

describe('capItems', () => {
  it('max 이하는 그대로', () => expect(capItems(['a', 'b'], 3)).toEqual(['a', 'b']))
  it('초과분은 마지막을 "외 N건"으로', () =>
    expect(capItems(['a', 'b', 'c', 'd'], 3)).toEqual(['a', 'b', '외 2건']))
})

describe('capGroupsToBudget', () => {
  it('총 줄수(헤더1+항목)가 예산 이내가 되도록 그룹별 항목 캡', () => {
    const groups = [
      { phase: 'P1', num: 1, items: ['a', 'b', 'c', 'd', 'e'] },
      { phase: 'P2', num: 2, items: ['x', 'y', 'z'] },
    ]
    const out = capGroupsToBudget(groups, 8)
    const lines = out.reduce((s, g) => s + 1 + g.items.length, 0)
    expect(lines).toBeLessThanOrEqual(8)
    expect(out).toHaveLength(2)
  })
  it('예산이 헤더 수 이하면 항목 0', () => {
    const groups = [{ phase: 'P1', num: 1, items: ['a', 'b'] }, { phase: 'P2', num: 2, items: ['c'] }]
    const out = capGroupsToBudget(groups, 2)
    expect(out.every(g => g.items.length === 0)).toBe(true)
  })
})
