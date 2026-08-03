import { describe, it, expect, vi, beforeEach } from 'vitest'

// 공개 redeem 액션은 인증 게이트가 없다 — 세션·초대 행·소비 RPC 세 방어선만 검증하면 되므로
// DB 는 전부 모킹한다. vi.mock 팩토리는 호이스팅되므로 스파이는 vi.hoisted 로 먼저 만든다.
const { createAdminClient, getSession, listAllAuthUsers } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => {
    throw new Error('createAdminClient 는 선검증 전에 호출되면 안 된다')
  }),
  getSession: vi.fn(),
  listAllAuthUsers: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/data/accounts', () => ({ listAllAuthUsers }))

import {
  getInvitePreview, getInviteSessionState, redeemInvite, redeemInviteWithSignup,
} from '@/app/actions/inviteRedeem'

const TOKEN = '11111111-2222-4333-8444-555555555555'
const PROJECT = 'p-1'
const USER = { id: 'u-1', email: 'nam.yu@dongkuk.com' }
const SIGNUP = { name: '유남규', password: 'password1', passwordConfirmation: 'password1' }

const INVITE = {
  project_id: PROJECT,
  team_id: 't-1',
  email: 'nam.yu@dongkuk.com',
  created_by: 'admin-1',
  expires_at: '2999-01-01T00:00:00.000Z',
  revoked_at: null,
  redeemed_at: null,
}
const CONSUMED = [{
  project_id: PROJECT, team_id: 't-1', invite_email: INVITE.email, created_by: 'admin-1',
}]

interface Fixtures {
  invite?: { data: unknown; error: unknown }
  existingRole?: { data: unknown; error: unknown }
  roleUpsert?: { error: unknown }
  consume?: { data: unknown; error: unknown }
  /** 기존 계정의 memberships 행 유무 — 기본은 '있음'(팀 소속을 초대가 덮어쓰지 않는 경로). */
  membership?: { data: unknown; error: unknown }
  membershipInsert?: { error: unknown }
  inviteUpdate?: { error: unknown }
  createUser?: { data: unknown; error: unknown }
}

/** supabase 체인 모킹 + 호출 인자 기록. 예상 밖 테이블 접근은 즉시 실패시킨다. */
function makeAdmin(f: Fixtures = {}) {
  // 인자 검증은 테스트 본문의 toHaveBeenCalledWith 로 한다 — 여기서는 반환값만 정해 준다.
  const spies = {
    rpc: vi.fn(), roleUpsert: vi.fn(), inviteUpdate: vi.fn(), membershipInsert: vi.fn(),
    memberLink: vi.fn(), createUser: vi.fn(), deleteUser: vi.fn(),
  }
  spies.rpc.mockResolvedValue(f.consume ?? { data: CONSUMED, error: null })
  spies.roleUpsert.mockResolvedValue(f.roleUpsert ?? { error: null })
  spies.inviteUpdate.mockResolvedValue(f.inviteUpdate ?? { error: null })
  spies.membershipInsert.mockResolvedValue(f.membershipInsert ?? { error: null })
  spies.memberLink.mockResolvedValue({ error: null })
  spies.createUser.mockResolvedValue(f.createUser ?? { data: { user: { id: 'u-new' } }, error: null })
  spies.deleteUser.mockResolvedValue({ error: null })
  const client = {
    from(table: string) {
      if (table === 'project_invites') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => f.invite ?? { data: INVITE, error: null } }),
          }),
          update: (patch: unknown) => ({ eq: () => spies.inviteUpdate(patch) }),
        }
      }
      if (table === 'project_roles') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => f.existingRole ?? { data: null, error: null } }),
            }),
          }),
          upsert: (row: unknown, opts: unknown) => spies.roleUpsert(row, opts),
        }
      }
      if (table === 'memberships') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => f.membership ?? { data: { user_id: USER.id }, error: null },
            }),
          }),
          insert: (row: unknown) => spies.membershipInsert(row),
        }
      }
      if (table === 'project_members') {
        return { update: () => ({ is: () => ({ eq: () => spies.memberLink() }) }) }
      }
      throw new Error('예상치 못한 테이블 접근: ' + table)
    },
    rpc: (fn: string, args: unknown) => spies.rpc(fn, args),
    auth: {
      admin: {
        createUser: (input: unknown) => spies.createUser(input),
        deleteUser: (id: string) => spies.deleteUser(id),
      },
    },
  }
  createAdminClient.mockReturnValue(client as never)
  return spies
}

function silenceConsole() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

beforeEach(() => {
  createAdminClient.mockReset()
  createAdminClient.mockImplementation(() => {
    throw new Error('createAdminClient 는 선검증 전에 호출되면 안 된다')
  })
  getSession.mockReset()
  listAllAuthUsers.mockReset()
})

describe('redeemInvite — 로그인 사용자 합류', () => {
  it('토큰 형식이 틀리면 미존재와 같은 문구로 거부하고 DB 에 닿지 않는다', async () => {
    getSession.mockResolvedValue(USER)
    expect(await redeemInvite('not-a-uuid')).toEqual({ ok: false, error: '초대를 찾을 수 없습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비로그인이면 로그인을 요구하고 admin client 에 도달하지 않는다', async () => {
    getSession.mockResolvedValue(null)
    expect(await redeemInvite(TOKEN)).toEqual({ ok: false, error: '로그인이 필요합니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('세션 확인이 실패하면 비로그인으로 폴백하지 않고 중단한다 — fail-closed', async () => {
    getSession.mockRejectedValue(new Error('boom'))
    const spy = silenceConsole()
    expect(await redeemInvite(TOKEN)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('초대 조회 실패를 미존재로 위장하지 않는다', async () => {
    getSession.mockResolvedValue(USER)
    makeAdmin({ invite: { data: null, error: { message: 'boom' } } })
    const spy = silenceConsole()
    expect(await redeemInvite(TOKEN)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
  })

  it('세션 이메일이 초대 이메일과 다르면 소비 전에 거부한다', async () => {
    getSession.mockResolvedValue({ id: 'u-2', email: 'other@dongkuk.com' })
    const spies = makeAdmin()
    const res = await redeemInvite(TOKEN)
    expect(res).toEqual({
      ok: false,
      error: '이 초대는 다른 이메일 주소를 위한 것입니다. 초대받은 계정으로 로그인해 주세요.',
    })
    expect(spies.rpc).not.toHaveBeenCalled()
    expect(spies.roleUpsert).not.toHaveBeenCalled()
  })

  it('이미 프로젝트 역할이 있으면 초대를 태우지 않는다', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin({ existingRole: { data: { user_id: USER.id }, error: null } })
    expect(await redeemInvite(TOKEN)).toEqual({ ok: true, projectId: PROJECT, alreadyMember: true })
    expect(spies.rpc).not.toHaveBeenCalled()
    expect(spies.roleUpsert).not.toHaveBeenCalled()
  })

  it('기존 역할 조회가 실패하면 소비하지 않고 중단한다', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin({ existingRole: { data: null, error: { message: 'boom' } } })
    const spy = silenceConsole()
    expect(await redeemInvite(TOKEN)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
    expect(spies.rpc).not.toHaveBeenCalled()
  })

  it('소비 RPC 가 0행이면 만료·사용됨과 구분하지 않고 거부한다', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin({ consume: { data: [], error: null } })
    expect(await redeemInvite(TOKEN))
      .toEqual({ ok: false, error: '만료되었거나 사용할 수 없는 초대입니다.' })
    expect(spies.roleUpsert).not.toHaveBeenCalled()
  })

  it('정상 합류 — 소비 RPC 는 (토큰·이메일·사용자) 3인자, 역할 upsert 는 ignoreDuplicates', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin()
    expect(await redeemInvite(TOKEN)).toEqual({ ok: true, projectId: PROJECT, alreadyMember: false })
    expect(spies.rpc).toHaveBeenCalledWith('consume_project_invite', {
      p_token: TOKEN, p_email: INVITE.email, p_user: USER.id,
    })
    // ignoreDuplicates 가 빠지면 UPDATE 가 되어 admin 이 member 로 강등된다 — 회귀 방어.
    expect(spies.roleUpsert).toHaveBeenCalledWith(
      { project_id: PROJECT, user_id: USER.id, role: 'member', granted_by: 'admin-1' },
      { onConflict: 'project_id,user_id', ignoreDuplicates: true },
    )
    // 이미 소속이 있는 계정의 팀을 초대가 덮어쓰지 않는다.
    expect(spies.membershipInsert).not.toHaveBeenCalled()
  })

  it('멤버십이 없는 기존 계정이면 초대의 팀으로 채운다 — 팀이 비면 WBS 담당 판정이 깨진다', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin({ membership: { data: null, error: null } })
    expect(await redeemInvite(TOKEN)).toEqual({ ok: true, projectId: PROJECT, alreadyMember: false })
    expect(spies.membershipInsert)
      .toHaveBeenCalledWith({ user_id: USER.id, team_id: 't-1', role: 'team_editor' })
  })

  it('멤버십 확인이 실패하면 보정을 생략한다 — 있는 소속을 덮어쓰지 않는다', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin({ membership: { data: null, error: { message: 'boom' } } })
    const spy = silenceConsole()
    // 합류 자체는 이미 성립했으므로 되돌리지 않는다.
    expect(await redeemInvite(TOKEN)).toEqual({ ok: true, projectId: PROJECT, alreadyMember: false })
    spy.mockRestore()
    expect(spies.membershipInsert).not.toHaveBeenCalled()
  })

  it('역할 부여가 실패하면 소비를 되돌려 재시도할 수 있게 한다', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin({ roleUpsert: { error: { message: 'boom' } } })
    const spy = silenceConsole()
    const res = await redeemInvite(TOKEN)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '합류 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' })
    expect(spies.inviteUpdate).toHaveBeenCalledWith({ redeemed_by: null, redeemed_at: null })
  })

  it('되돌리기까지 실패하면 링크가 고착됐음을 알린다', async () => {
    getSession.mockResolvedValue(USER)
    makeAdmin({ roleUpsert: { error: { message: 'boom' } }, inviteUpdate: { error: { message: 'again' } } })
    const spy = silenceConsole()
    const res = await redeemInvite(TOKEN)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '합류 처리에 실패했습니다. 관리자에게 문의해 주세요.' })
  })
})

describe('redeemInviteWithSignup — 가입 + 합류', () => {
  it('로그인 상태에서는 가입 경로를 쓸 수 없다', async () => {
    getSession.mockResolvedValue(USER)
    expect(await redeemInviteWithSignup(TOKEN, SIGNUP))
      .toEqual({ ok: false, error: '이미 로그인되어 있습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비밀번호가 일치하지 않으면 계정을 만들지 않는다', async () => {
    getSession.mockResolvedValue(null)
    const res = await redeemInviteWithSignup(TOKEN, { ...SIGNUP, passwordConfirmation: 'password2' })
    expect(res).toEqual({ ok: false, error: '비밀번호가 일치하지 않습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('만료된 초대면 계정을 만들지 않는다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({
      invite: { data: { ...INVITE, expires_at: '2020-01-01T00:00:00.000Z' }, error: null },
    })
    expect(await redeemInviteWithSignup(TOKEN, SIGNUP))
      .toEqual({ ok: false, error: '만료되었거나 사용할 수 없는 초대입니다.' })
    expect(spies.createUser).not.toHaveBeenCalled()
  })

  it('계정은 초대 행의 이메일로만 만든다 — 입력이 주소를 정할 수 없다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin()
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    expect(res).toEqual({ ok: true, projectId: PROJECT, email: INVITE.email })
    expect(spies.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: INVITE.email, password: SIGNUP.password, email_confirm: true,
    }))
    expect(spies.membershipInsert)
      .toHaveBeenCalledWith({ user_id: 'u-new', team_id: 't-1', role: 'team_editor' })
    expect(spies.roleUpsert).toHaveBeenCalledWith(
      { project_id: PROJECT, user_id: 'u-new', role: 'member', granted_by: 'admin-1' },
      { onConflict: 'project_id,user_id', ignoreDuplicates: true },
    )
    expect(spies.deleteUser).not.toHaveBeenCalled()
  })

  it('createUser 실패는 원인을 구분해 알리지 않는다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({ createUser: { data: null, error: { message: 'already registered' } } })
    expect(await redeemInviteWithSignup(TOKEN, SIGNUP))
      .toEqual({ ok: false, error: '이미 가입된 계정이거나 입력값을 확인해 주세요.' })
    expect(spies.membershipInsert).not.toHaveBeenCalled()
  })

  it('멤버십 저장이 실패하면 계정을 되돌린다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({ membershipInsert: { error: { message: 'boom' } } })
    const spy = silenceConsole()
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '가입 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' })
    expect(spies.deleteUser).toHaveBeenCalledWith('u-new')
  })

  it('소비 RPC 가 0행이면 유령 계정을 남기지 않는다 — 보상 롤백', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({ consume: { data: [], error: null } })
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    expect(res).toEqual({ ok: false, error: '만료되었거나 사용할 수 없는 초대입니다.' })
    expect(spies.deleteUser).toHaveBeenCalledWith('u-new')
    // 소비되지 않은 행에도 되돌리기를 시도하지만 null 을 다시 null 로 쓸 뿐이라 무해하다.
    expect(spies.inviteUpdate).toHaveBeenCalledWith({ redeemed_by: null, redeemed_at: null })
  })

  it('소비 RPC 가 에러로 실패해도 되돌리기를 먼저 한다 — 커밋됐는데 응답만 깨진 경우 삭제가 막힌다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({ consume: { data: null, error: { message: 'connection reset' } } })
    const spy = silenceConsole()
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    expect(spies.inviteUpdate).toHaveBeenCalledWith({ redeemed_by: null, redeemed_at: null })
    expect(spies.inviteUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(spies.deleteUser.mock.invocationCallOrder[0])
    expect(spies.deleteUser).toHaveBeenCalledWith('u-new')
  })

  it('되돌리기가 실패해도 계정은 지운다 — 초대 고착보다 유령 계정이 더 나쁘다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({
      roleUpsert: { error: { message: 'boom' } }, inviteUpdate: { error: { message: 'again' } },
    })
    const spy = silenceConsole()
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    expect(res).toEqual({ ok: false, error: '가입 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' })
    // 0065 의 redeem 쌍 CHECK 는 한 방향만 금지하므로 (null, timestamp) 가 허용된다 —
    // 되돌리기가 실패한 상태에서도 계정 삭제는 성공한다. 남겨 두면 그 계정이 전사 읽기 권한을 갖는다.
    expect(spies.deleteUser).toHaveBeenCalledWith('u-new')
    // 고착된 초대를 찾을 단서는 남기되 토큰 전문은 남기지 않는다.
    const logged = spy.mock.calls.flat().join(' ')
    spy.mockRestore()
    expect(logged).toContain('u-new')
    expect(logged).not.toContain(TOKEN)
  })

  it('소비 후 역할 부여가 실패하면 소비를 먼저 되돌린 뒤 계정을 지운다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({ roleUpsert: { error: { message: 'boom' } } })
    const spy = silenceConsole()
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '가입 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' })
    // redeemed_by 는 on delete set null 이라 되돌리지 않으면 check 제약 때문에 삭제 자체가 막힌다.
    expect(spies.inviteUpdate).toHaveBeenCalledWith({ redeemed_by: null, redeemed_at: null })
    expect(spies.inviteUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(spies.deleteUser.mock.invocationCallOrder[0])
    expect(spies.deleteUser).toHaveBeenCalledWith('u-new')
  })
})

describe('getInvitePreview', () => {
  const PREVIEW_ROW = {
    email: INVITE.email,
    expires_at: INVITE.expires_at,
    revoked_at: null,
    redeemed_at: null,
    projects: { name: 'D-CUBE', description: '전사 프로젝트' },
  }

  it('잘못된 토큰은 DB 조회 없이 미존재와 같은 문구', async () => {
    expect(await getInvitePreview('nope')).toEqual({ ok: false, error: '초대를 찾을 수 없습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('전체 이메일 대신 마스킹된 주소만 돌려준다', async () => {
    makeAdmin({ invite: { data: PREVIEW_ROW, error: null } })
    listAllAuthUsers.mockResolvedValue([{ id: 'x', email: 'other@dongkuk.com', createdAt: '', fullName: null }])
    const res = await getInvitePreview(TOKEN)
    expect(res).toEqual({
      ok: true,
      preview: {
        projectName: 'D-CUBE',
        projectDescription: '전사 프로젝트',
        maskedEmail: 'na****@dongkuk.com',
        status: 'active',
        accountExists: false,
      },
    })
  })

  it('같은 이메일의 계정이 있으면 accountExists 로 로그인 폼을 유도한다', async () => {
    makeAdmin({ invite: { data: PREVIEW_ROW, error: null } })
    listAllAuthUsers.mockResolvedValue([{ id: 'x', email: 'NAM.YU@dongkuk.com', createdAt: '', fullName: null }])
    const res = await getInvitePreview(TOKEN)
    expect(res.ok && res.preview.accountExists).toBe(true)
  })

  it('취소된 초대는 상태만 돌려준다 — 프로젝트명·수신자·계정 유무를 흘리지 않는다', async () => {
    makeAdmin({ invite: { data: { ...PREVIEW_ROW, revoked_at: '2026-08-01T00:00:00.000Z' }, error: null } })
    const res = await getInvitePreview(TOKEN)
    expect(res).toEqual({
      ok: true,
      preview: {
        projectName: '', projectDescription: null, maskedEmail: '',
        status: 'revoked', accountExists: false,
      },
    })
    // 최소 preview 라 계정 목록 전량 조회도 하지 않는다.
    expect(listAllAuthUsers).not.toHaveBeenCalled()
  })

  it('만료·사용됨도 같은 최소 preview 다', async () => {
    for (const [patch, status] of [
      [{ expires_at: '2020-01-01T00:00:00.000Z' }, 'expired'],
      [{ redeemed_at: '2026-08-01T00:00:00.000Z' }, 'redeemed'],
    ] as const) {
      makeAdmin({ invite: { data: { ...PREVIEW_ROW, ...patch }, error: null } })
      const res = await getInvitePreview(TOKEN)
      expect(res.ok && res.preview).toEqual({
        projectName: '', projectDescription: null, maskedEmail: '', status, accountExists: false,
      })
    }
  })

  it('계정 목록 조회 실패를 계정 없음으로 위장하지 않는다', async () => {
    makeAdmin({ invite: { data: PREVIEW_ROW, error: null } })
    listAllAuthUsers.mockRejectedValue(new Error('boom'))
    const spy = silenceConsole()
    const res = await getInvitePreview(TOKEN)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
  })
})

describe('getInviteSessionState — 화면 분기용 세션 판정', () => {
  it('잘못된 토큰은 DB 조회 없이 미존재와 같은 문구', async () => {
    expect(await getInviteSessionState('nope')).toEqual({ ok: false, error: '초대를 찾을 수 없습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비로그인 호출자에게는 초대 이메일에 관한 어떤 정보도 주지 않는다 — 조회조차 하지 않는다', async () => {
    getSession.mockResolvedValue(null)
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: true, authed: false, emailMatches: false })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('세션 확인 실패는 비로그인으로 폴백하지 않는다 — fail-closed', async () => {
    getSession.mockRejectedValue(new Error('boom'))
    const spy = silenceConsole()
    const res = await getInviteSessionState(TOKEN)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
  })

  it('세션 이메일이 초대 이메일과 같으면 일치로 판정한다(대소문자·공백 무시)', async () => {
    getSession.mockResolvedValue({ id: 'u-1', email: '  NAM.YU@Dongkuk.com ' })
    makeAdmin()
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: true, authed: true, emailMatches: true })
  })

  it('마스킹이 같아도 원문이 다르면 불일치다 — 클라이언트 마스킹 비교 회귀 방어', async () => {
    // maskEmail 은 앞 2자와 길이만 남기므로 두 주소가 같은 'ho*****@dongkuk.com' 이 된다.
    getSession.mockResolvedValue({ id: 'u-9', email: 'hong.gs@dongkuk.com' })
    makeAdmin({ invite: { data: { ...INVITE, email: 'hong.gd@dongkuk.com' }, error: null } })
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: true, authed: true, emailMatches: false })
  })

  it('세션에 이메일이 없으면 일치로 보지 않는다', async () => {
    getSession.mockResolvedValue({ id: 'u-1', email: null })
    makeAdmin({ invite: { data: { ...INVITE, email: '' }, error: null } })
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: true, authed: true, emailMatches: false })
  })

  it('초대 조회 실패는 미존재와 구분한다', async () => {
    getSession.mockResolvedValue(USER)
    makeAdmin({ invite: { data: null, error: { message: 'boom' } } })
    const spy = silenceConsole()
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
    makeAdmin({ invite: { data: null, error: null } })
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: false, error: '초대를 찾을 수 없습니다.' })
  })
})
