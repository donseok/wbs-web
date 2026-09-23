// tests/actions/agent-seatmap-release-lease.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireProjectMember: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember: mocks.requireProjectMember }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
import { releaseLeadLease } from '@/app/actions/agentSeatmap'

const P1 = '11111111-1111-4111-8111-111111111111'
const U1 = '22222222-2222-4222-8222-222222222222'
const U2 = '33333333-3333-4333-8333-333333333333'

const actor = (userId: string, role: 'admin' | 'member' | null) => ({
  userId, teamCode: null, teamId: null, isSuperuser: false,
  projectRoles: new Map(role ? [[P1, role]] : []), rosterTeams: new Map(),
})

function admin(resp: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn(async () => ({ data: resp.data ?? null, error: resp.error ?? null }))
  mocks.createAdminClient.mockReturnValue({ rpc })
  return rpc
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: actor(U1, 'member') })
})

describe('releaseLeadLease', () => {
  it('형식이 틀린 uuid 는 거부하고 RPC 를 부르지 않는다', async () => {
    const rpc = admin({ data: 1 })
    expect(await releaseLeadLease('not-a-uuid', U1)).toEqual({ ok: false, error: '값이 잘못됐습니다.' })
    expect(await releaseLeadLease(P1, 'not-a-uuid')).toEqual({ ok: false, error: '값이 잘못됐습니다.' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('requireProjectMember 가 거부하면 권한 없음 — RPC 를 부르지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    const rpc = admin({ data: 1 })
    expect(await releaseLeadLease(P1, U1)).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('멤버지만 lease 주인도 관리자도 아니면 거부 — RPC 를 부르지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: actor(U2, 'member') })
    const rpc = admin({ data: 1 })
    expect(await releaseLeadLease(P1, U1)).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('본인 lease 는 RPC 를 { p_user, p_project } 로 부르고 해제 수를 돌려준다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: actor(U1, 'member') })
    const rpc = admin({ data: 1 })
    expect(await releaseLeadLease(P1, U1)).toEqual({ ok: true, released: 1 })
    expect(rpc).toHaveBeenCalledWith('lead_lease_force_release', { p_user: U1, p_project: P1 })
  })
  it('RPC 오류면 고정 문구로 실패하고 로그를 남긴다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: actor(U1, 'member') })
    admin({ error: { message: 'db down' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await releaseLeadLease(P1, U1)).toEqual({ ok: false, error: '팀장 해제에 실패했습니다.' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
