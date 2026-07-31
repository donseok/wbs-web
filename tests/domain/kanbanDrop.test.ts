import { describe, it, expect } from 'vitest'
import type { ComputedItem } from '@/lib/domain/types'
import { resolveDrop } from '@/lib/domain/kanban-drop'

function card(rolledActualPct: number): ComputedItem {
  return {
    id: 'c', parentId: null, level: 'activity', code: 'c', sortOrder: 0, name: 'c',
    biz: null, deliverable: null, plannedStart: '2026-09-01', plannedEnd: '2026-09-30',
    weight: null, actualPct: rolledActualPct, owners: [], isOwnerSplit: false, plannedPct: 0,
    rolledActualPct, achievement: null, status: 'in_progress', children: [],
  }
}

describe('resolveDrop', () => {
  it('시작전 대상: 이미 0%면 noop, 진척>0이면 확인 요청', () => {
    expect(resolveDrop(card(0), 'not_started')).toEqual({ kind: 'noop' })
    expect(resolveDrop(card(40), 'not_started')).toEqual({ kind: 'confirm-reset' })
  })
  it('완료 대상: 이미 100이면 noop, 아니면 100 설정', () => {
    expect(resolveDrop(card(100), 'done')).toEqual({ kind: 'noop' })
    expect(resolveDrop(card(40), 'done')).toEqual({ kind: 'set', pct: 100 })
  })
  it('진행중 대상: 1~99면 noop(재정렬), 0에서 오면 30 제안, 100에서 오면 90 제안', () => {
    expect(resolveDrop(card(45), 'in_progress')).toEqual({ kind: 'noop' })
    expect(resolveDrop(card(0), 'in_progress')).toEqual({ kind: 'prompt', suggested: 30 })
    expect(resolveDrop(card(100), 'in_progress')).toEqual({ kind: 'prompt', suggested: 90 })
  })
})
