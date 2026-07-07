import { describe, it, expect } from 'vitest'
import { capItems, packGroups, hexLerp } from '@/lib/report/pptx'

describe('pptx pure helpers', () => {
  it('capItems: max 이하면 그대로', () => {
    expect(capItems(['a', 'b', 'c'], 5)).toEqual(['a', 'b', 'c'])
  })
  it('capItems: 초과분은 외 N건으로 요약', () => {
    expect(capItems(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'b', '외 3건'])
  })
  it('packGroups: 빈 입력도 페이지 1장 보장', () => {
    expect(packGroups([], [], 16)).toHaveLength(1)
  })
  it('packGroups: 예산 초과 시 여러 페이지로 분할', () => {
    const groups = Array.from({ length: 12 }, (_, i) => ({ phase: `P${i}`, items: ['x'] }))
    expect(packGroups(groups, [], 4).length).toBeGreaterThan(1)
  })
  it('packGroups: prev/curr Phase를 합집합으로 배치', () => {
    const pages = packGroups([{ phase: 'A', items: ['1'] }], [{ phase: 'B', items: ['2'] }], 16)
    const phases = pages.flatMap(pg => [...pg.prev, ...pg.curr].map(g => g.phase))
    expect(phases).toContain('A')
    expect(phases).toContain('B')
  })
  it('hexLerp: 양끝 값', () => {
    expect(hexLerp('000000', 'ffffff', 0)).toBe('000000')
    expect(hexLerp('000000', 'ffffff', 1)).toBe('ffffff')
  })
})
