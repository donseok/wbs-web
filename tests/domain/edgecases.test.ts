import { describe, it, expect } from 'vitest'
import { plannedPct, achievementOf, statusOf } from '@/lib/domain/progress'
import { buildTree } from '@/lib/domain/tree'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'

const H = new Set<string>()
const row = (over: Partial<WbsRow>): WbsRow => ({
  id: 'x', parentId: null, level: 'activity', code: 'x', sortOrder: 0, name: 'x',
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], ...over,
})

describe('plannedPct edge cases', () => {
  it('start/end가 모두 주말이면 총 영업일 0 → 0%', () => {
    expect(plannedPct('2026-07-04', '2026-07-05', '2026-07-10', H)).toBe(0) // 토~일
  })
  it('start만 있고 end 없으면 0', () => {
    expect(plannedPct('2026-07-06', null, '2026-07-10', H)).toBe(0)
  })
})

describe('statusOf edge cases', () => {
  it('actual 100이면 시작 전이라도 done', () => {
    expect(statusOf(100, 0, '2026-08-01', '2026-07-01')).toBe('done')
  })
  it('start null이고 계획·실적 0이면 not_started', () => {
    expect(statusOf(0, 0, null, '2026-07-10')).toBe('not_started')
  })
  it('계획>0, 실적 0, 시작 도래 → delayed', () => {
    expect(statusOf(0, 40, '2026-07-01', '2026-07-10')).toBe('delayed')
  })
  it('실적==계획(>0) → in_progress', () => {
    expect(statusOf(60, 60, '2026-07-01', '2026-07-10')).toBe('in_progress')
  })
  it('시작 전이라도 실적>0이면 in_progress', () => {
    expect(statusOf(50, 0, '2026-07-13', '2026-07-02')).toBe('in_progress')
  })
  it('시작 전 + 실적 0이면 not_started 유지', () => {
    expect(statusOf(0, 0, '2026-07-13', '2026-07-02')).toBe('not_started')
  })
  it('시작 전 + 실적 100이면 done', () => {
    expect(statusOf(100, 0, '2026-07-13', '2026-07-02')).toBe('done')
  })
})

describe('achievementOf edge cases', () => {
  it('계획 0이면 null', () => { expect(achievementOf(50, 0)).toBeNull() })
  it('반올림', () => { expect(achievementOf(1, 3)).toBe(33) })
})

describe('buildTree edge cases', () => {
  it('부모가 없는 parentId는 루트로 승격', () => {
    const tree = buildTree([row({ id: 'a', parentId: 'ghost', sortOrder: 1 })])
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('a')
  })
  it('여러 루트는 sortOrder로 정렬', () => {
    const tree = buildTree([
      row({ id: 'b', parentId: null, sortOrder: 2 }),
      row({ id: 'a', parentId: null, sortOrder: 1 }),
    ])
    expect(tree.map(t => t.id)).toEqual(['a', 'b'])
  })
})

describe('computeTree multi-level rollup', () => {
  const rows: WbsRow[] = [
    row({ id: 'P', parentId: null, level: 'phase', code: '1', sortOrder: 0 }),
    row({ id: 'T', parentId: 'P', level: 'task', code: '1-1', sortOrder: 1 }),
    row({ id: 'A1', parentId: 'T', level: 'activity', sortOrder: 2, plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 100 }),
    row({ id: 'A2', parentId: 'T', level: 'activity', sortOrder: 3, plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 0 }),
  ]
  const tree = computeTree(rows, '2026-07-20', H) // 기간 종료 후

  it('Phase는 자식(Task)의 롤업을 그대로 받는다', () => {
    const p = tree[0]
    expect(p.rolledActualPct).toBe(50) // (100+0)/2
    expect(p.plannedPct).toBe(100) // 기간 종료 → 100
  })
  it('상위 노드의 achievement·status 계산', () => {
    const p = tree[0]
    expect(p.achievement).toBe(50) // 50/100
    expect(p.status).toBe('delayed') // 실적 50 < 계획 100
  })
})
