import { describe, it, expect } from 'vitest'
import { computeTree, overallProgress, overallPlannedAt, leafWeightShares } from '@/lib/domain/rollup'
import { makeBizDayIndex } from '@/lib/domain/dates'
import { plannedPct } from '@/lib/domain/progress'
import type { WbsRow } from '@/lib/domain/types'

const H = new Set<string>()
const row = (o: Partial<WbsRow> & { id: string }): WbsRow => ({
  parentId: null, level: 'activity', code: o.id, sortOrder: 0, name: o.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...o,
})

// P1(w .25) 07-01..07-10 · P2(w .75) 07-01..07-31, 각 리프 2개
const rows: WbsRow[] = [
  row({ id: 'P1', level: 'phase', weight: 0.25, plannedStart: '2026-07-01', plannedEnd: '2026-07-10' }),
  row({ id: 'P2', level: 'phase', weight: 0.75, plannedStart: '2026-07-01', plannedEnd: '2026-07-31', sortOrder: 1 }),
  row({ id: 'a', parentId: 'P1', plannedStart: '2026-07-01', plannedEnd: '2026-07-03', actualPct: 100 }),
  row({ id: 'b', parentId: 'P1', plannedStart: '2026-07-06', plannedEnd: '2026-07-10', sortOrder: 1 }),
  row({ id: 'c', parentId: 'P2', plannedStart: '2026-07-01', plannedEnd: '2026-07-31' }),
  row({ id: 'd', parentId: 'P2', plannedStart: '2026-07-20', plannedEnd: '2026-07-31', sortOrder: 1 }),
]

const idx = makeBizDayIndex('2026-07-01', '2026-07-31', H)

describe('overallPlannedAt', () => {
  it('불변식: 오늘 값이 overallProgress().planned 와 일치한다', () => {
    for (const today of ['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-31']) {
      const tree = computeTree(rows, today, H)
      expect(overallPlannedAt(tree, today, idx)).toBe(overallProgress(tree).planned)
    }
  })

  it('종점: 종료일에 100', () => {
    const tree = computeTree(rows, '2026-07-31', H)
    expect(overallPlannedAt(tree, '2026-07-31', idx)).toBe(100)
  })

  it('시작 전: 0', () => {
    const tree = computeTree(rows, '2026-07-01', H)
    expect(overallPlannedAt(tree, '2026-06-01', idx)).toBe(0)
  })

  it('단조 비감소', () => {
    const tree = computeTree(rows, '2026-07-31', H)
    const days = ['2026-07-01','2026-07-06','2026-07-13','2026-07-20','2026-07-27','2026-07-31']
    const vals = days.map(d => overallPlannedAt(tree, d, idx))
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1])
  })

  it('루트 자체 날짜 기준값과 롤업값은 다르다 — 롤업이 진실이다', () => {
    const tree = computeTree(rows, '2026-07-08', H)
    // P1 자체 날짜: 07-01..07-10 = 8업무일, 07-08까지 6일 경과 → 75%
    // P1 롤업: a(07-01..07-03, 이미 지남)=100, b(07-06..07-10, 5중 3일)=60 → (100+60)/2 = 80
    expect(plannedPct('2026-07-01', '2026-07-10', '2026-07-08', H)).toBe(75)
    expect(tree[0].plannedPct).toBe(80)
  })
})

describe('leafWeightShares', () => {
  it('모든 리프 몫의 합이 1이다', () => {
    const tree = computeTree(rows, '2026-07-08', H)
    const shares = leafWeightShares(tree)
    expect(shares.size).toBe(4)
    const sum = [...shares.values()].reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('형제 균등: P1의 두 리프가 각각 0.125', () => {
    const tree = computeTree(rows, '2026-07-08', H)
    const shares = leafWeightShares(tree)
    expect(shares.get('a')).toBeCloseTo(0.125, 10)
    expect(shares.get('b')).toBeCloseTo(0.125, 10)
    expect(shares.get('c')).toBeCloseTo(0.375, 10)
  })
})
