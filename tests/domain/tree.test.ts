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

  it('act 하위 sub-act는 sortOrder와 무관하게 PMO→ERP→MES→가공 순', () => {
    const sub = (id: string, order: number, team: '가공' | 'PMO' | 'ERP' | 'MES'): WbsRow => ({
      ...row(id, 'act', order),
      owners: [{ team, kind: 'primary' }],
    })
    const rows = [
      row('act', null, 1),
      sub('s가공', 2, '가공'),
      sub('sERP', 3, 'ERP'),
      sub('sMES', 4, 'MES'),
      sub('sPMO', 5, 'PMO'),
    ]
    const tree = buildTree(rows)
    expect(tree[0].children.map(c => c.id)).toEqual(['sPMO', 'sERP', 'sMES', 's가공'])
  })

  it('activity가 아닌 부모의 자식은 sortOrder 순 유지', () => {
    const rows = [
      { ...row('t', null, 1), level: 'task' as const },
      { ...row('b', 't', 2), owners: [{ team: 'PMO' as const, kind: 'primary' as const }] },
      { ...row('a', 't', 1), owners: [{ team: '가공' as const, kind: 'primary' as const }] },
    ]
    const tree = buildTree(rows)
    expect(tree[0].children.map(c => c.id)).toEqual(['a', 'b'])
  })
})
