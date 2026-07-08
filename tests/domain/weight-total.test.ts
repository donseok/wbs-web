import { describe, it, expect } from 'vitest'
import { WEIGHT_TOTAL, totalWeight } from '@/lib/domain/weight'
import { computeTree, overallProgress } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'

const row = (over: Partial<WbsRow>): WbsRow =>
  ({
    id: 'x', parentId: null, level: 'activity', code: '1', sortOrder: 0, name: 'n',
    biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
    weight: null, actualPct: null, owners: [],
    ...over,
  }) as WbsRow

/**
 * 가중치는 "전역 절대 지분" — 프로젝트 전체 leaf 합이 100 이고,
 * 형제 그룹의 합은 부모의 가중치와 같다. (형제 합 = 100 이 아니다)
 */
describe('가중치 전역 합 = 100', () => {
  // Phase1(60) = T1-1(40) + T1-2(20) / Phase2(40) = T2-1(40)
  const rows: WbsRow[] = [
    row({ id: 'p1', level: 'phase', code: '1', sortOrder: 0, weight: 60 }),
    row({ id: 't11', parentId: 'p1', level: 'task', code: '1-1', sortOrder: 1, weight: 40, actualPct: 100 }),
    row({ id: 't12', parentId: 'p1', level: 'task', code: '1-2', sortOrder: 2, weight: 20, actualPct: 0 }),
    row({ id: 'p2', level: 'phase', code: '2', sortOrder: 3, weight: 40 }),
    row({ id: 't21', parentId: 'p2', level: 'task', code: '2-1', sortOrder: 4, weight: 40, actualPct: 50 }),
  ]
  const leaves = rows.filter(r => !rows.some(c => c.parentId === r.id))
  const roots = rows.filter(r => r.parentId == null)

  it('leaf 가중치의 전역 합이 100', () => {
    expect(totalWeight(leaves)).toBe(WEIGHT_TOTAL)
  })

  it('루트(Phase) 가중치의 합도 100', () => {
    expect(totalWeight(roots)).toBe(WEIGHT_TOTAL)
  })

  it('형제 합은 100 이 아니라 부모의 가중치와 같다', () => {
    const p1Kids = rows.filter(r => r.parentId === 'p1')
    expect(totalWeight(p1Kids)).toBe(60) // 100 이 아님
    expect(totalWeight(p1Kids)).toBe(rows.find(r => r.id === 'p1')!.weight)
  })

  it('100 스케일 롤업이 기대값과 맞는다', () => {
    const tree = computeTree(rows, '2026-07-08', new Set())
    // Phase1 = (100*40 + 0*20) / 60 = 67
    expect(tree.find(n => n.id === 'p1')!.rolledActualPct).toBe(67)
    // Phase2 = 50
    expect(tree.find(n => n.id === 'p2')!.rolledActualPct).toBe(50)
    // 전체 = (67*60 + 50*40) / 100 = 60.2 → 60
    expect(overallProgress(tree).actual).toBe(60)
  })

  it('스케일 불변 — 0~1 로 축소해도 롤업 결과가 동일', () => {
    const scaled = rows.map(r => ({ ...r, weight: r.weight == null ? null : r.weight / 100 }))
    const a = computeTree(rows, '2026-07-08', new Set())
    const b = computeTree(scaled, '2026-07-08', new Set())
    expect(overallProgress(b).actual).toBe(overallProgress(a).actual)
    expect(b.find(n => n.id === 'p1')!.rolledActualPct).toBe(a.find(n => n.id === 'p1')!.rolledActualPct)
  })
})
