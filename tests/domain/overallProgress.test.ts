import { describe, it, expect } from 'vitest'
import { overallProgress } from '@/lib/domain/rollup'
import type { ComputedItem } from '@/lib/domain/types'

const root = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: 'r', parentId: null, level: 'phase', code: '1', sortOrder: 1, name: 'r',
    biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem

describe('overallProgress', () => {
  it('weight 모두 null이면 단순 평균', () => {
    const r = overallProgress([
      root({ rolledActualPct: 100, plannedPct: 80 }),
      root({ rolledActualPct: 0, plannedPct: 40 }),
    ])
    expect(r.actual).toBe(50)
    expect(r.planned).toBe(60)
  })

  it('weight가 있으면 가중 평균 (단순 평균과 달라짐)', () => {
    const r = overallProgress([
      root({ rolledActualPct: 100, plannedPct: 100, weight: 3 }),
      root({ rolledActualPct: 0, plannedPct: 0, weight: 1 }),
    ])
    expect(r.actual).toBe(75) // (100*3 + 0*1) / 4
    expect(r.planned).toBe(75)
  })

  it('빈 배열이면 0', () => {
    expect(overallProgress([])).toEqual({ actual: 0, planned: 0 })
  })

  it('weight가 일부만 있으면 null은 0으로 취급(균등 분기 아님)', () => {
    const r = overallProgress([
      root({ rolledActualPct: 100, plannedPct: 100, weight: 2 }),
      root({ rolledActualPct: 50, plannedPct: 50, weight: null }),
    ])
    // allNull=false → eff(null)=0 → totalEff=2 → (100*2 + 50*0)/2 = 100
    expect(r.actual).toBe(100)
  })
})
