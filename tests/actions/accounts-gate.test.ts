import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/cache · authz 가드 · admin 클라이언트를 모킹해 게이트 로직만 검증한다.
// vi.mock 팩토리는 파일 최상단으로 호이스팅되므로, 스파이는 vi.hoisted 로 먼저 만든다.
const { createAdminClient, requireProjectAdmin, requireSuperuser, getActor } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => {
    throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다')
  }),
  requireProjectAdmin: vi.fn(),
  requireSuperuser: vi.fn(),
  getActor: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, requireSuperuser, getActor }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import { createAccount, bulkCreateAccounts, resetPassword, listAccounts } from '@/app/actions/accounts'
import { setProjectRole, setSuperuser } from '@/app/actions/projectRoles'

const DENIED = { ok: false as const, error: '권한 없음' }
const P1 = 'p1'
const memberActor = {
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map([[P1, 'member' as const]]),
}
const adminActor = { ...memberActor, projectRoles: new Map([[P1, 'admin' as const]]) }

beforeEach(() => {
  createAdminClient.mockClear()
  requireProjectAdmin.mockReset()
  requireSuperuser.mockReset()
  getActor.mockReset()
})

describe('계정 서버액션 권한 게이트', () => {
  it('프로젝트 관리자가 아니면 createAccount 거부 — admin client 미생성', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await createAccount({
      email: 'a@b.com', password: 'password1', teamCode: 'PMO', role: 'member', projectId: P1, name: null,
    })
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('관리자 역할(admin) 계정 생성은 슈퍼유저 전용 — 계정 생성 경로로 규칙을 우회하지 못한다', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    const res = await createAccount({
      email: 'a@b.com', password: 'password1', teamCode: 'PMO', role: 'admin', projectId: P1, name: null,
    })
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(requireSuperuser).toHaveBeenCalled()
    expect(requireProjectAdmin).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('프로젝트 관리자가 아니면 bulkCreateAccounts 거부', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await bulkCreateAccounts('a@b.com,PMO,member,password1', P1)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('권한 없음')
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  // 등급 경계 회귀 방어: 이 검사가 없으면 어느 한 프로젝트의 관리자가 슈퍼유저 계정의
  // 비밀번호를 초기화해 그 계정으로 로그인할 수 있다 — '관리자 슬롯은 슈퍼유저만' 불변식이 무의미해진다.
  it('관리자는 슈퍼유저 계정의 비밀번호를 초기화할 수 없다', async () => {
    getActor.mockResolvedValue(adminActor)
    const maybeSingle = vi.fn(async () => ({ data: { is_superuser: true }, error: null }))
    const updateUserById = vi.fn()
    createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
      auth: { admin: { updateUserById } },
    } as never)
    const res = await resetPassword('u-superuser', 'password1')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('슈퍼유저')
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('관리자는 다른 관리자 계정도 만질 수 없다 — 동급 탈취 차단', async () => {
    getActor.mockResolvedValue(adminActor)
    const updateUserById = vi.fn()
    createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'memberships') {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: async () => ({ data: { is_superuser: false }, error: null }) })) })) }
        }
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: async () => ({ data: [{ project_id: 'p9' }], error: null }) })) })) }
      }),
      auth: { admin: { updateUserById } },
    } as never)
    const res = await resetPassword('u-other-admin', 'password1')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('관리자')
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('대상 등급 조회가 실패하면 비밀번호 초기화를 중단한다 — fail-closed', async () => {
    getActor.mockResolvedValue(adminActor)
    const updateUserById = vi.fn()
    createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) })) })) })),
      auth: { admin: { updateUserById } },
    } as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await resetPassword('u2', 'password1')
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('슈퍼유저는 누구의 비밀번호든 초기화할 수 있다', async () => {
    getActor.mockResolvedValue({ ...adminActor, isSuperuser: true })
    const updateUserById = vi.fn(async () => ({ error: null }))
    createAdminClient.mockReturnValue({
      from: vi.fn(() => { throw new Error('슈퍼유저는 등급 조회 없이 통과한다') }),
      auth: { admin: { updateUserById } },
    } as never)
    expect(await resetPassword('u-superuser', 'password1')).toEqual({ ok: true })
    expect(updateUserById).toHaveBeenCalled()
  })

  it('listAccounts 는 권한 거부를 빈 배열로 위장하지 않는다', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await listAccounts(P1)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('멤버(관리자 아님)는 resetPassword 거부 — 계정 조작은 관리자 이상', async () => {
    getActor.mockResolvedValue(memberActor)
    expect(await resetPassword('u1', 'password1')).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('권한 조회 실패는 resetPassword 를 중단한다 — 관대한 폴백 금지', async () => {
    getActor.mockRejectedValue(new Error('boom'))
    expect(await resetPassword('u1', 'password1'))
      .toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('projectRoles 서버액션 권한 게이트', () => {
  it('관리자 슬롯 부여는 슈퍼유저 전용 — 프로젝트 관리자는 거부', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    const res = await setProjectRole(P1, 'u2', 'admin')
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    // 관리자 슬롯 경로는 requireSuperuser 만 부른다 — 관리자 가드로 우회되면 안 된다.
    expect(requireSuperuser).toHaveBeenCalled()
    expect(requireProjectAdmin).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('멤버 슬롯 부여는 프로젝트 관리자 이상 — 거부 시 admin client 미생성', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await setProjectRole(P1, 'u2', 'member')
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('기존 역할이 admin 인 사람의 강등도 슈퍼유저가 필요하다', async () => {
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: adminActor })
    const maybeSingle = vi.fn(async () => ({ data: { role: 'admin' }, error: null }))
    createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })) })),
    } as never)
    const res = await setProjectRole(P1, 'u2', 'member')
    expect(res).toEqual({ ok: false, error: '권한 없음' })
  })

  it('setSuperuser 는 슈퍼유저 전용', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    expect(await setSuperuser('u2', true)).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('마지막 슈퍼유저 해제는 거부한다 — 전역 관리 잠금 방지', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: { ...adminActor, isSuperuser: true } })
    const eq = vi.fn(async () => ({ data: [{ user_id: 'u1' }], error: null }))
    createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
    } as never)
    const res = await setSuperuser('u1', false)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('마지막 슈퍼유저')
  })

  it('슈퍼유저 목록 조회 실패는 해제를 중단한다 — 0명 폴백 금지(fail-closed)', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: { ...adminActor, isSuperuser: true } })
    const eq = vi.fn(async () => ({ data: null, error: { message: 'boom' } }))
    createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
    } as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await setSuperuser('u1', false)
    spy.mockRestore()
    expect(res.ok).toBe(false)
    expect(res.error).toContain('확인할 수 없어')
  })
})
