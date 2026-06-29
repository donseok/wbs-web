import { describe, it, expect } from 'vitest'
import { canEditActual, canEditWeight } from '@/lib/domain/permissions'
import type { ComputedItem, Membership } from '@/lib/domain/types'

const pmo: Membership = { role: 'pmo_admin', teamCode: 'PMO', teamId: 'p' }
const dtEditor: Membership = { role: 'team_editor', teamCode: 'DT', teamId: 'd' }

const item = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: 'a', parentId: null, level: 'activity', code: 'a', sortOrder: 1, name: 'a',
    biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: 0,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem

describe('canEditActual', () => {
  it('비로그인은 불가', () => {
    expect(canEditActual(item({}), null)).toBe(false)
  })
  it('PMO는 모든 activity 편집 가능', () => {
    expect(canEditActual(item({ owners: [] }), pmo)).toBe(true)
  })
  it('activity가 아니면 불가 (task/phase leaf 포함)', () => {
    expect(canEditActual(item({ level: 'task' }), pmo)).toBe(false)
    expect(canEditActual(item({ level: 'phase' }), pmo)).toBe(false)
  })
  it('자식이 있으면(롤업 항목) 불가', () => {
    expect(canEditActual(item({ children: [item({})] }), pmo)).toBe(false)
  })
  it('팀 편집자는 자기 팀 담당만 가능', () => {
    expect(canEditActual(item({ owners: [{ team: 'DT', kind: 'primary' }] }), dtEditor)).toBe(true)
    expect(canEditActual(item({ owners: [{ team: 'DT', kind: 'support' }] }), dtEditor)).toBe(true)
    expect(canEditActual(item({ owners: [{ team: 'ERP', kind: 'primary' }] }), dtEditor)).toBe(false)
    expect(canEditActual(item({ owners: [] }), dtEditor)).toBe(false)
  })
})

describe('canEditWeight', () => {
  it('PMO만 가능', () => {
    expect(canEditWeight(pmo)).toBe(true)
    expect(canEditWeight(dtEditor)).toBe(false)
    expect(canEditWeight(null)).toBe(false)
  })
})
