import { describe, it, expect } from 'vitest'
import { roleIn, isProjectAdmin, isProjectMember, type Actor } from '@/lib/domain/authz'

const P = 'proj-1'
const Q = 'proj-2'

const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map(), ...over,
})

const superuser = actor({ isSuperuser: true })
const admin = actor({ projectRoles: new Map([[P, 'admin' as const]]) })
const member = actor({ projectRoles: new Map([[P, 'member' as const]]) })
const viewer = actor({})

describe('roleIn', () => {
  it('비로그인은 null', () => {
    expect(roleIn(null, P)).toBe(null)
  })
  it('슈퍼유저는 어느 프로젝트에서도 superuser', () => {
    expect(roleIn(superuser, P)).toBe('superuser')
    expect(roleIn(superuser, Q)).toBe('superuser')
  })
  it('관리자는 지정된 프로젝트에서만 admin, 다른 프로젝트에서는 viewer', () => {
    expect(roleIn(admin, P)).toBe('admin')
    expect(roleIn(admin, Q)).toBe('viewer')
  })
  it('멤버는 지정된 프로젝트에서만 member', () => {
    expect(roleIn(member, P)).toBe('member')
    expect(roleIn(member, Q)).toBe('viewer')
  })
  it('역할이 없으면 viewer', () => {
    expect(roleIn(viewer, P)).toBe('viewer')
  })
  // 프로젝트 미지정 대상(예: project_id 가 null 인 회의록)은 프로젝트로 판정할 수 없다.
  // 슈퍼유저만 superuser 로 보고 나머지는 viewer — fail-closed.
  it('projectId 가 null 이면 슈퍼유저 외 전원 viewer', () => {
    expect(roleIn(superuser, null)).toBe('superuser')
    expect(roleIn(admin, null)).toBe('viewer')
    expect(roleIn(member, null)).toBe('viewer')
  })
})

describe('isProjectAdmin', () => {
  it('슈퍼유저·해당 프로젝트 관리자만 true', () => {
    expect(isProjectAdmin(superuser, P)).toBe(true)
    expect(isProjectAdmin(admin, P)).toBe(true)
    expect(isProjectAdmin(admin, Q)).toBe(false)
    expect(isProjectAdmin(member, P)).toBe(false)
    expect(isProjectAdmin(viewer, P)).toBe(false)
    expect(isProjectAdmin(null, P)).toBe(false)
  })
})

describe('isProjectMember', () => {
  it('멤버 이상이면 true (관리자·슈퍼유저 포함)', () => {
    expect(isProjectMember(superuser, P)).toBe(true)
    expect(isProjectMember(admin, P)).toBe(true)
    expect(isProjectMember(member, P)).toBe(true)
    expect(isProjectMember(viewer, P)).toBe(false)
    expect(isProjectMember(null, P)).toBe(false)
  })
  it('다른 프로젝트에는 전이되지 않는다', () => {
    expect(isProjectMember(member, Q)).toBe(false)
    expect(isProjectMember(admin, Q)).toBe(false)
  })
})
