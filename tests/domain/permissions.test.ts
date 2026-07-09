import { describe, it, expect } from 'vitest'
import { canEditActual, canEditWeight } from '@/lib/domain/permissions'
import type { ComputedItem, Membership } from '@/lib/domain/types'

const pmo: Membership = { role: 'pmo_admin', teamCode: 'PMO', teamId: 'p' }
const dtEditor: Membership = { role: 'team_editor', teamCode: '가공', teamId: 'd' }

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
  it('PMO는 담당이 없는 말단도 편집 가능', () => {
    expect(canEditActual(item({ owners: [] }), pmo)).toBe(true)
  })
  // 롤업(computeNode)이 자식 유무로 말단을 판정하므로, 자식 없는 task/phase 도 자기 actual_pct 를
  // 그대로 상위로 올린다. 입력을 막으면 그 항목은 영영 0% 로 남는다.
  it('자식 없는 task/phase(단독 항목)도 편집 가능', () => {
    expect(canEditActual(item({ level: 'task' }), pmo)).toBe(true)
    expect(canEditActual(item({ level: 'phase' }), pmo)).toBe(true)
  })
  it('자식 없는 task도 담당 팀이면 팀 편집자가 편집 가능', () => {
    expect(canEditActual(item({ level: 'task', owners: [{ team: '가공', kind: 'primary' }] }), dtEditor)).toBe(true)
    expect(canEditActual(item({ level: 'task', owners: [{ team: 'ERP', kind: 'primary' }] }), dtEditor)).toBe(false)
  })
  it('자식이 있으면(롤업 항목) 불가 — level 무관', () => {
    expect(canEditActual(item({ children: [item({})] }), pmo)).toBe(false)
    expect(canEditActual(item({ level: 'task', children: [item({})] }), pmo)).toBe(false)
    expect(canEditActual(item({ level: 'phase', children: [item({})] }), pmo)).toBe(false)
    expect(canEditActual(item({ level: 'task', children: [item({})], owners: [{ team: '가공', kind: 'primary' }] }), dtEditor)).toBe(false)
  })
  it('팀 편집자는 자기 팀 담당만 가능', () => {
    expect(canEditActual(item({ owners: [{ team: '가공', kind: 'primary' }] }), dtEditor)).toBe(true)
    expect(canEditActual(item({ owners: [{ team: '가공', kind: 'support' }] }), dtEditor)).toBe(true)
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
