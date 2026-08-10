import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 2026-08-05 사고의 재발 가드.
 *
 * REST 장애로 권한·프로젝트 조회가 전부 실패했을 때 화면이 그 사실을 숨기고 '게스트 +
 * 등록된 프로젝트 없음' 으로 그렸다. 데이터는 멀쩡했는데(is_superuser=true, 두 프로젝트
 * admin) 로그인 실패로 신고됐다. 조회 실패는 **데이터 없음으로 위장하지 않는다**(에러 처리
 * 3원칙 ①). 그 계약을 lib 층에서 고정한다.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  memberships: vi.fn(),
  projectRoles: vi.fn(),
  projectMembers: vi.fn(),
  projects: vi.fn(),
  session: vi.fn(),
}))

function table(name: string) {
  const resp = name === 'memberships' ? mocks.memberships
    : name === 'project_roles' ? mocks.projectRoles
      : name === 'project_members' ? mocks.projectMembers
        : mocks.projects
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'not']) q[m] = vi.fn(() => q)
  q.maybeSingle = vi.fn(() => resp())
  q.then = (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) =>
    Promise.resolve(resp()).then(res, rej)
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (n: string) => table(n),
  }),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session, getDisplayName: vi.fn() }))

import { getActorViewState, getActorForView } from '@/lib/authz'

const USER = { id: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: USER } })
  mocks.session.mockResolvedValue(USER)
  // 0071 명단 팀 조회 — 이 스위트는 memberships/project_roles 축을 다루므로 기본값은 정상 빈 결과.
  mocks.projectMembers.mockReturnValue({ data: [], error: null })
})

describe('getActorViewState — 조회 실패를 권한 없음으로 위장하지 않는다', () => {
  it('정상 조회: degraded=false, actor 조립', async () => {
    mocks.memberships.mockReturnValue({ data: { is_superuser: true, teams: null }, error: null })
    mocks.projectRoles.mockReturnValue({ data: [{ project_id: 'p1', role: 'admin' }], error: null })
    const s = await getActorViewState()
    expect(s.degraded).toBe(false)
    expect(s.actor?.isSuperuser).toBe(true)
    expect(s.actor?.projectRoles.get('p1')).toBe('admin')
  })

  it('memberships 조회 실패: actor=null 이면서 degraded=true — 둘을 구분할 수 있어야 한다', async () => {
    mocks.memberships.mockReturnValue({ data: null, error: { message: 'timeout' } })
    mocks.projectRoles.mockReturnValue({ data: [], error: null })
    const s = await getActorViewState()
    expect(s.actor).toBeNull()
    expect(s.degraded).toBe(true)
  })

  it('project_roles 조회 실패도 degraded=true', async () => {
    mocks.memberships.mockReturnValue({ data: { is_superuser: false, teams: null }, error: null })
    mocks.projectRoles.mockReturnValue({ data: null, error: { message: 'timeout' } })
    const s = await getActorViewState()
    expect(s.actor).toBeNull()
    expect(s.degraded).toBe(true)
  })

  it('비로그인은 degraded 가 아니다 — 정상 흐름에 경고를 붙이면 안 된다', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })
    const s = await getActorViewState()
    expect(s.actor).toBeNull()
    expect(s.degraded).toBe(false)
  })

  it('getActorForView 는 기존 계약(Actor|null) 그대로 — 호출부 24곳이 안 깨진다', async () => {
    mocks.memberships.mockReturnValue({ data: null, error: { message: 'timeout' } })
    mocks.projectRoles.mockReturnValue({ data: [], error: null })
    expect(await getActorForView()).toBeNull()

    mocks.memberships.mockReturnValue({ data: { is_superuser: true, teams: null }, error: null })
    mocks.projectRoles.mockReturnValue({ data: [], error: null })
    expect((await getActorForView())?.isSuperuser).toBe(true)
  })
})
