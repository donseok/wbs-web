import { describe, it, expect } from 'vitest'
import { aggregateTaskStats } from '@/lib/domain/workspace'
import type { ComputedItem, Status } from '@/lib/domain/types'

const leaf = (status: Status): ComputedItem =>
  ({
    id: Math.random().toString(36).slice(2), parentId: null, level: 'activity', code: '1', sortOrder: 1,
    name: 'n', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status, children: [],
  }) as ComputedItem
const phase = (children: ComputedItem[]): ComputedItem =>
  ({ ...leaf('not_started'), level: 'phase', children }) as ComputedItem

describe('aggregateTaskStats', () => {
  it('빈 입력 → 0/0/0', () => {
    expect(aggregateTaskStats([])).toEqual({ tasks: 0, done: 0, donePct: 0 })
  })

  it('리프(자식 없는 항목)만 작업으로 카운트, 상위 노드 제외', () => {
    const tree = [phase([leaf('done'), leaf('in_progress')])]
    expect(aggregateTaskStats([tree])).toEqual({ tasks: 2, done: 1, donePct: 50 })
  })

  it('여러 프로젝트를 합산', () => {
    const p1 = [phase([leaf('done')])]
    const p2 = [phase([leaf('done'), leaf('delayed'), leaf('not_started')])]
    expect(aggregateTaskStats([p1, p2])).toEqual({ tasks: 4, done: 2, donePct: 50 })
  })

  it('donePct는 정수 반올림', () => {
    const tree = [phase([leaf('done'), leaf('not_started'), leaf('not_started')])]
    // 1/3 = 33.33… → 33
    expect(aggregateTaskStats([tree])).toEqual({ tasks: 3, done: 1, donePct: 33 })
  })

  it('done이 없으면 0%', () => {
    const tree = [phase([leaf('delayed'), leaf('in_progress')])]
    expect(aggregateTaskStats([tree])).toEqual({ tasks: 2, done: 0, donePct: 0 })
  })
})
