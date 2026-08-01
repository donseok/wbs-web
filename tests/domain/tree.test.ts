import { describe, it, expect } from 'vitest'
import { buildTree, type BuildTreeOpts } from '@/lib/domain/tree'
import type { WbsRow } from '@/lib/domain/types'
import { DEFAULT_TEAM_CODES, teamOrderMap } from '@/lib/domain/teams'

const row = (over: Partial<WbsRow> & { id: string }): WbsRow => ({
  parentId: null, code: over.id, sortOrder: 0, name: over.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null,
  actualPct: null, owners: [], isOwnerSplit: false, ...over,
})

const OPTS: BuildTreeOpts = { subActTeamOrder: teamOrderMap(DEFAULT_TEAM_CODES) }

describe('buildTree', () => {
  it('parentId로 중첩하고 sortOrder로 정렬', () => {
    const rows = [
      row({ id: 'p', parentId: null, sortOrder: 1 }),
      row({ id: 'b', parentId: 'p', sortOrder: 2 }),
      row({ id: 'a', parentId: 'p', sortOrder: 1 }),
    ]
    const tree = buildTree(rows, OPTS)
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('p')
    expect(tree[0].children.map(c => c.id)).toEqual(['a', 'b'])
  })

  it('owner-split 자식은 주입된 팀 순위로 정렬된다 (level 무관)', () => {
    const rows = [
      row({ id: 'p', parentId: null }),
      row({ id: 'a', parentId: 'p', sortOrder: 1, isOwnerSplit: true, owners: [{ team: 'MES', kind: 'primary' }] }),
      row({ id: 'b', parentId: 'p', sortOrder: 2, isOwnerSplit: true, owners: [{ team: 'PMO', kind: 'primary' }] }),
    ]
    const t = buildTree(rows, { subActTeamOrder: new Map([['PMO', 0], ['MES', 1]]) })
    expect(t[0].children.map(c => c.id)).toEqual(['b', 'a'])
  })

  it('순위 맵에 없는 팀은 뒤로, 그 안에서는 sortOrder', () => {
    const rows = [
      row({ id: 'p', parentId: null }),
      row({ id: 'a', parentId: 'p', sortOrder: 1, isOwnerSplit: true, owners: [{ team: 'PMO', kind: 'primary' }] }),
      row({ id: 'x', parentId: 'p', sortOrder: 2, isOwnerSplit: true, owners: [{ team: 'ZZZ', kind: 'primary' }] }),
      row({ id: 'y', parentId: 'p', sortOrder: 1, isOwnerSplit: true, owners: [{ team: 'YYY', kind: 'primary' }] }),
    ]
    const t = buildTree(rows, { subActTeamOrder: new Map([['PMO', 0]]) })
    // ZZZ·YYY 는 순위 맵에 없어 뒤로 밀리고, 그 둘 사이는 sortOrder(y=1 < x=2)로 갈린다.
    expect(t[0].children.map(c => c.id)).toEqual(['a', 'y', 'x'])
  })

  it('owner-split 아닌 형제는 sortOrder 만 따른다 — 깊이 5단이어도', () => {
    const rows = [
      row({ id: 'l1', parentId: null, sortOrder: 1 }),
      row({ id: 'l2', parentId: 'l1', sortOrder: 1 }),
      row({ id: 'l3', parentId: 'l2', sortOrder: 1 }),
      row({ id: 'l4', parentId: 'l3', sortOrder: 1 }),
      // 담당 팀이 지정돼 있어도 isOwnerSplit=false 면 팀 순위가 아니라 sortOrder 만 따른다 —
      // '담당 있음'이 아니라 플래그가 유일한 판별 근거임을 확인.
      row({ id: 'l5b', parentId: 'l4', sortOrder: 2, owners: [{ team: 'PMO', kind: 'primary' }] }),
      row({ id: 'l5a', parentId: 'l4', sortOrder: 1, owners: [{ team: '가공', kind: 'primary' }] }),
    ]
    const t = buildTree(rows, OPTS)
    const l4 = t[0].children[0].children[0].children[0]
    expect(l4.id).toBe('l4')
    expect(l4.children.map(c => c.id)).toEqual(['l5a', 'l5b'])
  })

  it('buildTree가 트리 순회로 depth를 부여한다(0-based)', () => {
    const rows = [
      row({ id: 'p', parentId: null }),
      row({ id: 't', parentId: 'p' }),
      row({ id: 'a', parentId: 't' }),
      row({ id: 'a2', parentId: 'a' }),   // 4단
    ]
    const tree = buildTree(rows, OPTS)
    const depthOf = (id: string): number => {
      let found = -1
      const walk = (ns: typeof tree) => ns.forEach(n => { if (n.id === id) found = n.depth; walk(n.children) })
      walk(tree)
      return found
    }
    expect(depthOf('p')).toBe(0)
    expect(depthOf('t')).toBe(1)
    expect(depthOf('a')).toBe(2)
    expect(depthOf('a2')).toBe(3)
  })
})
