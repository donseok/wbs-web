import { describe, it, expect } from 'vitest'
import {
  roleIn, isProjectAdmin, isProjectMember, isAnyProjectAdmin, hasAnyProjectRole,
  toProjectActorView, actorFromView, canSeeProject, type Actor,
} from '@/lib/domain/authz'

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

describe('isAnyProjectAdmin / hasAnyProjectRole — 전역 성격 리소스용', () => {
  it('isAnyProjectAdmin: 슈퍼유저·어느 프로젝트든 관리자면 true', () => {
    expect(isAnyProjectAdmin(superuser)).toBe(true)
    expect(isAnyProjectAdmin(admin)).toBe(true)
    expect(isAnyProjectAdmin(member)).toBe(false)
    expect(isAnyProjectAdmin(viewer)).toBe(false)
    expect(isAnyProjectAdmin(null)).toBe(false)
  })
  it('hasAnyProjectRole: 역할이 하나라도 있으면 true — 조회 전용만 false', () => {
    expect(hasAnyProjectRole(superuser)).toBe(true)
    expect(hasAnyProjectRole(admin)).toBe(true)
    expect(hasAnyProjectRole(member)).toBe(true)
    expect(hasAnyProjectRole(viewer)).toBe(false)
    expect(hasAnyProjectRole(null)).toBe(false)
  })
})

describe('effectiveLegacyRole — 옛 컴포넌트 계약용 표시 shim', () => {
  it('프로젝트 스코프: admin→pmo_admin, member→team_editor, viewer→null', async () => {
    const { effectiveLegacyRole } = await import('@/lib/domain/authz')
    expect(effectiveLegacyRole(superuser, P)).toBe('pmo_admin')
    expect(effectiveLegacyRole(admin, P)).toBe('pmo_admin')
    expect(effectiveLegacyRole(member, P)).toBe('team_editor')
    expect(effectiveLegacyRole(viewer, P)).toBe(null)
    expect(effectiveLegacyRole(null, P)).toBe(null)
  })
  it('전역(projectId 생략): 어느 프로젝트든 역할 기준 — DB app_role() 과 같은 의미', async () => {
    const { effectiveLegacyRole } = await import('@/lib/domain/authz')
    expect(effectiveLegacyRole(superuser)).toBe('pmo_admin')
    expect(effectiveLegacyRole(admin)).toBe('pmo_admin')
    expect(effectiveLegacyRole(member)).toBe('team_editor')
    expect(effectiveLegacyRole(viewer)).toBe(null)
  })
})

describe('toProjectActorView / actorFromView', () => {
  it('왕복해도 프로젝트 판정이 보존된다', () => {
    for (const a of [superuser, admin, member, viewer]) {
      const restored = actorFromView(toProjectActorView(a, P), P)
      expect(roleIn(restored, P)).toBe(roleIn(a, P))
      expect(isProjectAdmin(restored, P)).toBe(isProjectAdmin(a, P))
      expect(isProjectMember(restored, P)).toBe(isProjectMember(a, P))
    }
  })
  it('다른 프로젝트의 역할은 뷰에 실리지 않는다 — 뷰는 한 프로젝트 스코프다', () => {
    const restored = actorFromView(toProjectActorView(admin, Q), Q)
    expect(roleIn(restored, P)).toBe('viewer')
    expect(roleIn(restored, Q)).toBe('viewer')
  })
  it('null 은 null', () => {
    expect(toProjectActorView(null, P)).toBe(null)
    expect(actorFromView(null, P)).toBe(null)
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

describe('canSeeProject — 비공개 프로젝트 UI 숨김 (0070)', () => {
  const pub = { id: P, is_private: false }
  const priv = { id: P, is_private: true }
  it('공개 프로젝트는 비로그인 포함 전원에게 보인다 (기존 동작 유지)', () => {
    expect(canSeeProject(null, pub)).toBe(true)
    expect(canSeeProject(viewer, pub)).toBe(true)
  })
  it('is_private 미지정(구 데이터·컬럼 미적용)은 공개로 본다', () => {
    expect(canSeeProject(viewer, { id: P })).toBe(true)
    expect(canSeeProject(viewer, { id: P, is_private: null })).toBe(true)
  })
  it('비공개는 역할 보유자(admin/member)와 슈퍼유저에게만 보인다', () => {
    expect(canSeeProject(superuser, priv)).toBe(true)
    expect(canSeeProject(admin, priv)).toBe(true)
    expect(canSeeProject(member, priv)).toBe(true)
  })
  it('비공개는 viewer·비로그인에게 숨긴다 — fail-closed', () => {
    expect(canSeeProject(viewer, priv)).toBe(false)
    expect(canSeeProject(null, priv)).toBe(false)
  })
  it('다른 프로젝트의 역할로는 볼 수 없다', () => {
    expect(canSeeProject(admin, { id: Q, is_private: true })).toBe(false)
    expect(canSeeProject(member, { id: Q, is_private: true })).toBe(false)
  })
})
