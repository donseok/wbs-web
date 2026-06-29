import { describe, it, expect } from 'vitest'
import { buildTree } from '@/lib/domain/tree'
import type { WbsRow } from '@/lib/domain/types'

const row = (id: string, parentId: string | null, order: number): WbsRow => ({
  id, parentId, level: 'activity', code: id, sortOrder: order, name: id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null,
  actualPct: null, owners: [],
})

describe('buildTree', () => {
  it('parentId로 중첩하고 sortOrder로 정렬', () => {
    const rows = [row('p', null, 1), row('b', 'p', 2), row('a', 'p', 1)]
    const tree = buildTree(rows)
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('p')
    expect(tree[0].children.map(c => c.id)).toEqual(['a', 'b'])
  })
})
