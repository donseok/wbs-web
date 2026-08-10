import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supabase 서버 클라이언트를 모킹해 가드 로직만 검증한다.
// vi.mock 팩토리는 최상단으로 호이스팅되므로 스파이는 vi.hoisted 로 먼저 만든다.
const { mockClient } = vi.hoisted(() => ({ mockClient: { auth: { getUser: vi.fn() }, from: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => mockClient) }))

import { getActor, requireSuperuser, requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'

const USER = { id: 'u1', email: 'a@b.com' }

/** memberships 단건 조회·project_roles 목록 조회·project_members(0071 명단 팀) 조회를 순서대로 흉내낸다. */
function stubDb(opts: {
  membership?: { is_superuser: boolean; teams: { code: string; id: string } } | null
  membershipError?: { message: string } | null
  roles?: { project_id: string; role: string }[] | null
  rolesError?: { message: string } | null
  rosterRows?: { project_id: string; team_id: string; teams: { code: string } | null }[] | null
  rosterError?: { message: string } | null
}) {
  mockClient.auth.getUser.mockResolvedValue({ data: { user: USER } })
  mockClient.from.mockImplementation((table: string) => {
    if (table === 'memberships') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: opts.membership ?? null, error: opts.membershipError ?? null }) }) }) }
    }
    if (table === 'project_roles') {
      return { select: () => ({ eq: async () => ({
        data: opts.roles ?? null, error: opts.rolesError ?? null }) }) }
    }
    if (table === 'project_members') {
      return { select: () => ({ eq: () => ({ not: async () => ({
        data: opts.rosterRows ?? [], error: opts.rosterError ?? null }) }) }) }
    }
    throw new Error(`예상치 못한 테이블: ${table}`)
  })
}

beforeEach(() => { mockClient.from.mockReset(); mockClient.auth.getUser.mockReset() })

describe('getActor', () => {
  it('비로그인은 null', async () => {
    mockClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    expect(await getActor()).toBe(null)
  })

  it('멤버십과 프로젝트 역할을 합쳐 Actor 를 만든다', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'ERP', id: 't9' } },
      roles: [{ project_id: 'p1', role: 'admin' }, { project_id: 'p2', role: 'member' }],
    })
    const a = await getActor()
    expect(a?.userId).toBe('u1')
    expect(a?.teamCode).toBe('ERP')
    expect(a?.isSuperuser).toBe(false)
    expect(a?.projectRoles.get('p1')).toBe('admin')
    expect(a?.projectRoles.get('p2')).toBe('member')
  })

  // 조회 실패를 '역할 없음'으로 폴백하면 가드가 조용히 전원을 거부하거나(운영 마비)
  // 반대로 실패를 성공처럼 흘려보낸다. 실패는 예외로 드러낸다.
  it('project_roles 조회가 실패하면 예외를 던진다', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'ERP', id: 't9' } },
      roles: null, rolesError: { message: 'boom' },
    })
    await expect(getActor()).rejects.toThrow(/권한 정보/)
  })

  // 0071: project_members 조회 결과가 rosterTeams(projectId → {teamId, teamCode})로 정확히
  // 조립되는지 — teams(code) 임베드 캐스트 경유라 실값이 아니라 undefined 로 새는 회귀를 잡는다.
  it('명단 팀 조회 결과를 rosterTeams 로 조립한다', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'ERP', id: 't9' } },
      roles: [{ project_id: 'p1', role: 'member' }],
      rosterRows: [{ project_id: 'p1', team_id: 't-dev', teams: { code: '개발' } }],
    })
    const a = await getActor()
    expect(a?.rosterTeams.get('p1')).toEqual({ teamId: 't-dev', teamCode: '개발' })
    expect(a?.rosterTeams.get('p2')).toBeUndefined()
  })

  // memberships·project_roles 축과 동일 계약: 명단 팀 조회 실패도 '명단 팀 없음'으로 폴백하지
  // 않고 예외로 드러낸다(fail-closed) — 조용히 좁아진 권한이 아니라 중단이어야 한다.
  it('project_members 조회가 실패하면 예외를 던진다', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'ERP', id: 't9' } },
      roles: [{ project_id: 'p1', role: 'member' }],
      rosterRows: null, rosterError: { message: 'boom' },
    })
    await expect(getActor()).rejects.toThrow(/권한 정보/)
  })
})

describe('requireSuperuser', () => {
  it('슈퍼유저는 통과', async () => {
    stubDb({ membership: { is_superuser: true, teams: { code: 'PMO', id: 't1' } }, roles: [] })
    const r = await requireSuperuser()
    expect(r.ok).toBe(true)
  })
  it('관리자는 거부', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'PMO', id: 't1' } },
      roles: [{ project_id: 'p1', role: 'admin' }],
    })
    expect(await requireSuperuser()).toEqual({ ok: false, error: '권한 없음' })
  })
  it('비로그인은 로그인 필요', async () => {
    mockClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    expect(await requireSuperuser()).toEqual({ ok: false, error: '로그인 필요' })
  })
})

describe('requireProjectAdmin / requireProjectMember', () => {
  it('관리자는 admin·member 가드 모두 통과', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'PMO', id: 't1' } },
      roles: [{ project_id: 'p1', role: 'admin' }],
    })
    expect((await requireProjectAdmin('p1')).ok).toBe(true)
    stubDb({
      membership: { is_superuser: false, teams: { code: 'PMO', id: 't1' } },
      roles: [{ project_id: 'p1', role: 'admin' }],
    })
    expect((await requireProjectMember('p1')).ok).toBe(true)
  })

  it('멤버는 admin 가드에서 거부, member 가드는 통과', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'ERP', id: 't2' } },
      roles: [{ project_id: 'p1', role: 'member' }],
    })
    expect(await requireProjectAdmin('p1')).toEqual({ ok: false, error: '권한 없음' })
    stubDb({
      membership: { is_superuser: false, teams: { code: 'ERP', id: 't2' } },
      roles: [{ project_id: 'p1', role: 'member' }],
    })
    expect((await requireProjectMember('p1')).ok).toBe(true)
  })

  it('다른 프로젝트 관리자는 거부 — 프로젝트 스코프', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'PMO', id: 't1' } },
      roles: [{ project_id: 'p1', role: 'admin' }],
    })
    expect(await requireProjectAdmin('p2')).toEqual({ ok: false, error: '권한 없음' })
  })

  it('조회 실패는 통과시키지 않고 사유를 구분해 돌려준다', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'PMO', id: 't1' } },
      roles: null, rolesError: { message: 'boom' },
    })
    expect(await requireProjectAdmin('p1')).toEqual({
      ok: false, error: '권한을 확인할 수 없어 중단했습니다.',
    })
  })
})

describe('resolveProjectId', () => {
  it('행의 project_id 를 돌려준다', async () => {
    mockClient.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { project_id: 'p1' }, error: null }) }) }),
    }))
    expect(await resolveProjectId('meetings', 'm1')).toEqual({ ok: true, projectId: 'p1' })
  })

  it('행이 없으면 대상을 찾을 수 없음', async () => {
    mockClient.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }))
    expect(await resolveProjectId('meetings', 'm1')).toEqual({
      ok: false, error: '대상을 찾을 수 없습니다.',
    })
  })

  // 3원칙 ②: 쓰기 전 선행 조회가 실패하면 중단한다.
  it('조회가 실패하면 중단한다', async () => {
    mockClient.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }),
    }))
    expect(await resolveProjectId('meetings', 'm1')).toEqual({
      ok: false, error: '권한을 확인할 수 없어 중단했습니다.',
    })
  })
})

describe('getActorForView — 화면 계층 열화', () => {
  it('권한 조회 실패는 조회 전용(null)으로 열화한다 — 인증 영역 전체 500 방지', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'ERP', id: 't9' } },
      roles: null, rolesError: { message: 'boom' },
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getActorForView } = await import('@/lib/authz')
    expect(await getActorForView()).toBe(null)
    spy.mockRestore()
  })

  // Next 의 제어 흐름 예외를 삼키면 정적/동적 판정과 redirect 가 조용히 깨진다.
  it.each([
    ['DYNAMIC_SERVER_USAGE', { digest: 'DYNAMIC_SERVER_USAGE' }],
    ['NEXT_REDIRECT', { digest: 'NEXT_REDIRECT;replace;/login;307;' }],
    ['NEXT_NOT_FOUND', { digest: 'NEXT_NOT_FOUND' }],
  ])('%s 신호는 그대로 다시 던진다', async (_n, thrown) => {
    mockClient.auth.getUser.mockImplementation(() => { throw thrown })
    const { getActorForView } = await import('@/lib/authz')
    await expect(getActorForView()).rejects.toBe(thrown)
  })
})
