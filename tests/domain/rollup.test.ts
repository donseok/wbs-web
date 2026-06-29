import { describe, it, expect } from 'vitest'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'

const leaf = (id: string, parentId: string, actual: number, weight: number | null = null): WbsRow => ({
  id, parentId, level: 'activity', code: id, sortOrder: 1, name: id,
  deliverable: null, plannedStart: '2026-07-06', plannedEnd: '2026-07-10',
  weight, actualPct: actual, owners: [],
})

describe('computeTree rollup', () => {
  it('균등 가중치 롤업 = 단순 평균', () => {
    const rows: WbsRow[] = [
      { id: 'P', parentId: null, level: 'phase', code: '1', sortOrder: 1, name: 'P',
        deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [] },
      leaf('a', 'P', 100), leaf('b', 'P', 0),
    ]
    const tree = computeTree(rows, '2026-07-20', new Set())
    expect(tree[0].rolledActualPct).toBe(50)
  })
  it('가중치 반영 롤업', () => {
    const rows: WbsRow[] = [
      { id: 'P', parentId: null, level: 'phase', code: '1', sortOrder: 1, name: 'P',
        deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [] },
      leaf('a', 'P', 100, 3), leaf('b', 'P', 0, 1),
    ]
    const tree = computeTree(rows, '2026-07-20', new Set())
    expect(tree[0].rolledActualPct).toBe(75) // (100*3+0*1)/4
  })
  it('leaf는 자기 actualPct, status 계산', () => {
    const rows: WbsRow[] = [leaf('a', 'ROOTLESS', 100)]
    // parent 없는 leaf는 root로 취급
    const tree = computeTree([{ ...rows[0], parentId: null }], '2026-07-20', new Set())
    expect(tree[0].rolledActualPct).toBe(100)
    expect(tree[0].status).toBe('done')
  })
})
