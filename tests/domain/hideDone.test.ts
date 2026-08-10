import { describe, it, expect } from 'vitest'
import { computeHideDone } from '@/lib/domain/hideDone'
import { statusOf } from '@/lib/domain/progress'
import { round1 } from '@/lib/domain/format'
import type { ComputedItem } from '@/lib/domain/types'

let seq = 0
function node(id: string, actualPct: number | null, children: ComputedItem[] = []): ComputedItem {
  seq += 1
  return {
    id,
    parentId: null,
    code: id,
    sortOrder: seq,
    name: id,
    biz: null,
    deliverable: null,
    plannedStart: null,
    plannedEnd: null,
    weight: null,
    actualPct,
    owners: [],
    isOwnerSplit: false,
    plannedPct: 0,
    rolledActualPct: actualPct ?? 0,
    achievement: null,
    status: (actualPct ?? 0) >= 100 ? 'done' : 'in_progress',
    children,
    depth: 0,
  }
}

describe('computeHideDone', () => {
  it('부분완료 부모(4/5 완료) — 아무것도 숨기지 않고 완료 리프만 흐림 대상', () => {
    const done = ['a', 'b', 'c', 'd'].map(id => node(id, 100))
    const open = node('e', 0)
    const tree = [node('p', null, [...done, open])]
    const r = computeHideDone(tree)
    expect(r.hiddenIds.size).toBe(0)
    expect(r.hiddenCount).toBe(0)
    expect([...r.dimIds].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(r.dimIds.has('p')).toBe(false)
    expect(r.dimIds.has('e')).toBe(false)
  })

  it('전부 완료된 최상위 구간 — 서브트리 통째 숨김', () => {
    const tree = [node('p', null, [node('l1', 100), node('l2', 100)])]
    const r = computeHideDone(tree)
    expect([...r.hiddenIds].sort()).toEqual(['l1', 'l2', 'p'])
    expect(r.hiddenCount).toBe(3)
  })

  it('중간 깊이의 전부 완료 구간(부분완료 phase 아래) — 그 서브트리만 숨김', () => {
    const g = node('g', null, [node('g1', 100), node('g2', 100)])
    const tree = [node('phase', null, [g, node('x', 50)])]
    const r = computeHideDone(tree)
    expect([...r.hiddenIds].sort()).toEqual(['g', 'g1', 'g2'])
    expect(r.hiddenIds.has('phase')).toBe(false)
    expect(r.hiddenIds.has('x')).toBe(false)
    // 검색으로 g 가 드러나면 흐려져야 하므로 dim 에는 포함
    expect(r.dimIds.has('g')).toBe(true)
  })

  it('가중치 0 미완 자식 엣지 — 부모 status 가 done 이어도 숨기지 않음', () => {
    // 엣지 실재 확인: weight 0 자식은 가중평균에서 소거된다(rollup.ts siblingWeight)
    const rolled = round1((1 * 100 + 0 * 50) / (1 + 0 || 1))
    expect(statusOf(rolled, 100, null, '2026-08-10')).toBe('done')
    const a = node('a', 100)
    a.weight = 1
    const b = node('b', 50)
    b.weight = 0
    const tree = [node('p', null, [a, b])]
    const r = computeHideDone(tree)
    expect(r.hiddenIds.size).toBe(0)
    expect(r.dimIds.has('a')).toBe(true)
    expect(r.dimIds.has('b')).toBe(false)
    expect(r.dimIds.has('p')).toBe(false)
  })

  it('round1 반올림 엣지 — 리프 99.8 + 완료 4개(부모 status done)여도 숨기지 않음', () => {
    // 엣지 실재 확인: (400+99.8)/5 = 99.96 → round1 = 100 → statusOf done
    expect(statusOf(round1((100 * 4 + 99.8) / 5), 100, null, '2026-08-10')).toBe('done')
    const done = ['a', 'b', 'c', 'd'].map(id => node(id, 100))
    const near = node('e', 99.8)
    const r = computeHideDone([node('p', null, [...done, near])])
    expect(r.hiddenIds.size).toBe(0)
    expect(r.dimIds.has('e')).toBe(false)
    expect([...r.dimIds].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('원시값 계약 — 99.5 리프와 null 리프는 완료 아님(숨김·흐림 모두 제외)', () => {
    const r = computeHideDone([node('p', null, [node('a', 99.5), node('b', null), node('c', 100)])])
    expect(r.hiddenIds.size).toBe(0)
    expect(r.dimIds.has('a')).toBe(false)
    expect(r.dimIds.has('b')).toBe(false)
    expect(r.dimIds.has('c')).toBe(true)
  })

  it('최상위 완료 리프 — 흐림만, 숨김 아님', () => {
    const r = computeHideDone([node('solo', 100)])
    expect(r.hiddenIds.size).toBe(0)
    expect(r.dimIds.has('solo')).toBe(true)
  })

  it('전량 완료(최상위 리프 없는 픽스처) — 전 행 숨김', () => {
    const tree = [
      node('p1', null, [node('a', 100), node('b', 100)]),
      node('p2', null, [node('c', 100)]),
    ]
    const r = computeHideDone(tree)
    expect(r.hiddenCount).toBe(5)
    expect([...r.hiddenIds].sort()).toEqual(['a', 'b', 'c', 'p1', 'p2'])
  })

  it('전량 완료 + 최상위 완료 리프 존재 — 리프는 흐림으로 잔존', () => {
    const tree = [node('p1', null, [node('a', 100)]), node('solo', 100)]
    const r = computeHideDone(tree)
    expect([...r.hiddenIds].sort()).toEqual(['a', 'p1'])
    expect(r.hiddenIds.has('solo')).toBe(false)
    expect(r.dimIds.has('solo')).toBe(true)
  })

  it('빈 트리 — 숨김·흐림·카운트 전부 빈 결과', () => {
    const r = computeHideDone([])
    expect(r.hiddenIds.size).toBe(0)
    expect(r.dimIds.size).toBe(0)
    expect(r.hiddenCount).toBe(0)
  })
})
