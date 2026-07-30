import { describe, it, expect } from 'vitest'
import { canEditActual, canEditWeight, canEditDeliverable } from '@/lib/domain/permissions'
import type { Actor } from '@/lib/domain/authz'
import type { ComputedItem } from '@/lib/domain/types'

const P = 'proj-1'

const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map(), ...over,
})
const superuser = actor({ isSuperuser: true })
const admin = actor({ projectRoles: new Map([[P, 'admin' as const]]) })
const gagongMember = actor({ teamCode: '가공', teamId: 'd', projectRoles: new Map([[P, 'member' as const]]) })
const viewer = actor({ teamCode: '가공', teamId: 'd' })

const item = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: 'a', parentId: null, level: 'activity', code: 'a', sortOrder: 1, name: 'a',
    biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: 0,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem

describe('canEditActual', () => {
  it('비로그인은 불가', () => {
    expect(canEditActual(item({}), null, P)).toBe(false)
  })
  it('관리자·슈퍼유저는 담당이 없는 말단도 편집 가능', () => {
    expect(canEditActual(item({ owners: [] }), admin, P)).toBe(true)
    expect(canEditActual(item({ owners: [] }), superuser, P)).toBe(true)
  })
  // 롤업(computeNode)이 자식 유무로 말단을 판정하므로, 자식 없는 task/phase 도 자기
  // actual_pct 를 그대로 상위로 올린다. 입력을 막으면 그 항목은 영영 0% 로 남는다.
  it('자식 없는 task/phase(단독 항목)도 편집 가능', () => {
    expect(canEditActual(item({ level: 'task' }), admin, P)).toBe(true)
    expect(canEditActual(item({ level: 'phase' }), admin, P)).toBe(true)
  })
  it('멤버는 자기 팀 담당(primary/support)만 가능', () => {
    expect(canEditActual(item({ owners: [{ team: '가공', kind: 'primary' }] }), gagongMember, P)).toBe(true)
    expect(canEditActual(item({ owners: [{ team: '가공', kind: 'support' }] }), gagongMember, P)).toBe(true)
    expect(canEditActual(item({ owners: [{ team: 'ERP', kind: 'primary' }] }), gagongMember, P)).toBe(false)
    expect(canEditActual(item({ owners: [] }), gagongMember, P)).toBe(false)
  })
  it('조회 전용은 담당 팀이어도 불가', () => {
    expect(canEditActual(item({ owners: [{ team: '가공', kind: 'primary' }] }), viewer, P)).toBe(false)
  })
  it('다른 프로젝트의 멤버는 불가', () => {
    expect(canEditActual(item({ owners: [{ team: '가공', kind: 'primary' }] }), gagongMember, 'proj-2')).toBe(false)
  })
  it('자식이 있으면(롤업 항목) 불가 — level 무관', () => {
    expect(canEditActual(item({ children: [item({})] }), admin, P)).toBe(false)
    expect(canEditActual(item({ level: 'task', children: [item({})] }), admin, P)).toBe(false)
    expect(canEditActual(item({ level: 'phase', children: [item({})] }), superuser, P)).toBe(false)
    expect(canEditActual(item({ level: 'task', children: [item({})], owners: [{ team: '가공', kind: 'primary' }] }), gagongMember, P)).toBe(false)
  })
})

describe('canEditWeight', () => {
  it('관리자 이상만 가능', () => {
    expect(canEditWeight(superuser, P)).toBe(true)
    expect(canEditWeight(admin, P)).toBe(true)
    expect(canEditWeight(gagongMember, P)).toBe(false)
    expect(canEditWeight(viewer, P)).toBe(false)
    expect(canEditWeight(null, P)).toBe(false)
  })
})

describe('canEditDeliverable', () => {
  it('관리자 이상은 상위 항목도 가능', () => {
    expect(canEditDeliverable(item({ children: [item({})] }), admin, P)).toBe(true)
  })
  it('멤버는 말단 + 자기 팀 담당만', () => {
    expect(canEditDeliverable(item({ owners: [{ team: '가공', kind: 'primary' }] }), gagongMember, P)).toBe(true)
    expect(canEditDeliverable(item({ children: [item({})], owners: [{ team: '가공', kind: 'primary' }] }), gagongMember, P)).toBe(false)
  })
  it('조회 전용은 불가', () => {
    expect(canEditDeliverable(item({ owners: [{ team: '가공', kind: 'primary' }] }), viewer, P)).toBe(false)
  })
})
