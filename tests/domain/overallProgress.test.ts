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

  it('weight가 일부만 있으면 null은 명시값의 평균을 받는다', () => {
    const r = overallProgress([
      root({ rolledActualPct: 100, plannedPct: 100, weight: 2 }),
      root({ rolledActualPct: 50, plannedPct: 50, weight: null }),
    ])
    // null → avg([2]) = 2 → totalEff=4 → (100*2 + 50*2)/4 = 75
    //
    // 과거엔 null→0 이라 두 번째 Phase 가 전체 공정율에서 통째로 사라졌고(=100),
    // 같은 데이터를 computeNode 는 null→1 로 계산해 서로 다른 답을 냈다.
    // 이제 effectiveWeights 한 곳에서만 정의한다. (weight.ts 참조)
    expect(r.actual).toBe(75)
    expect(r.planned).toBe(75)
  })

  it('null 폴백은 스케일 불변 — 0~1 과 0~100 이 같은 결과', () => {
    const mk = (w1: number) => [
      root({ rolledActualPct: 100, plannedPct: 100, weight: w1 }),
      root({ rolledActualPct: 0, plannedPct: 0, weight: null }),
    ]
    expect(overallProgress(mk(0.5))).toEqual(overallProgress(mk(50)))
  })
})
