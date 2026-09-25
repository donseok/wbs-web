import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST } from '@/app/api/v1/agent/lead/lease/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const H = '0123abcd-0000-4000-8000-00000000abcd:12345'
type Resp = { data?: unknown; error?: { message: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix, token_hash: PAT.hash,
  project_id: null as string | null, scopes: ['work:claim'], enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}

function useAdmin(queues: Record<string, Resp[]>, rpcCalls: Array<[string, unknown]> = []) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit', 'order', 'not', 'update']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async (fn: string, args: unknown) => {
      rpcCalls.push([fn, args])
      const resp = (queues[`rpc:${fn}`] ?? []).shift() ?? { data: null, error: null }
      return { data: resp.data ?? null, error: resp.error ?? null }
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'hong@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (body: unknown) =>
  POST(new NextRequest('http://l/api/v1/agent/lead/lease', {
    method: 'POST', headers: { Authorization: `Bearer ${PAT.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
// agent_runners: 토큰 조회 + last_used 갱신. memberships: 슈퍼유저 아님. project_roles: 멤버.
const base = (runner = RUNNER, member = true): Record<string, Resp[]> => ({
  agent_runners: [{ data: runner }, { data: null }],
  memberships: [{ data: { is_superuser: false } }, { data: { is_superuser: false } }],
  project_roles: [{ data: member ? [{ role: 'member' }] : [] }, { data: member ? [{ role: 'member' }] : [] }],
})
const acquire = (extra: Record<string, unknown> = {}) =>
  ({ op: 'acquire', projects: [P1], holder: H, host: 'mbp', agent: 'hong/mbp/lead', ...extra })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('POST /agent/lead/lease', () => {
  it('acquire 200 — RPC 에 사용자·holder·takeover 를 넘기고 generation 을 돌려준다', async () => {
    const calls: Array<[string, unknown]> = []
    useAdmin({ ...base(), 'rpc:lead_lease_acquire': [{ data: [
      { project_id: P1, ok: true, generation: 4, host: 'mbp', agent: 'hong/mbp/lead', expires_at: '2026-09-23T00:03:00Z' },
    ] }] }, calls)
    const res = await post(acquire())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, leases: [{ project_id: P1, generation: 4, expires_at: '2026-09-23T00:03:00Z' }] })
    expect(calls[0]).toEqual(['lead_lease_acquire', {
      p_user: 'u-1', p_projects: [P1], p_holder: H, p_host: 'mbp', p_agent: 'hong/mbp/lead', p_takeover: false,
    }])
  })
  it('acquire 409 lead_lease_held — 막힌 행을 held 로 싣는다', async () => {
    useAdmin({ ...base(), 'rpc:lead_lease_acquire': [{ data: [
      { project_id: P1, ok: false, generation: 2, host: 'other', agent: 'hong/other/lead', expires_at: '2026-09-23T00:02:00Z' },
    ] }] })
    const res = await post(acquire())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('lead_lease_held')
    expect(body.held).toEqual([{ project_id: P1, host: 'other', agent: 'hong/other/lead', expires_at: '2026-09-23T00:02:00Z' }])
  })
  it('acquire — 멤버가 아닌 프로젝트는 403 forbidden_role 이고 RPC 를 부르지 않는다', async () => {
    const admin = useAdmin(base(RUNNER, false))
    const res = await post(acquire())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('프로젝트 한정 PAT 는 다른 프로젝트에 403', async () => {
    const admin = useAdmin(base({ ...RUNNER, project_id: P2 }))
    const res = await post(acquire())
    expect(res.status).toBe(403)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('형식 오류는 400 validation_failed', async () => {
    useAdmin(base())
    const res = await post({ op: 'acquire', projects: [P1], holder: 'bad', host: 'm', agent: 'a' })
    expect(res.status).toBe(400)
  })
  it('RPC 실패는 500 — lease 없음으로 위장하지 않는다', async () => {
    useAdmin({ ...base(), 'rpc:lead_lease_acquire': [{ error: { message: 'boom' } }] })
    const res = await post(acquire())
    expect(res.status).toBe(500)
  })
  it('renew — ok=false 행을 lost 로, 가장 이른 expires_at 을 돌려준다', async () => {
    useAdmin({ ...base(), 'rpc:lead_lease_renew': [{ data: [
      { project_id: P1, ok: true, expires_at: '2026-09-23T00:03:00Z' },
      { project_id: P2, ok: false, expires_at: null },
    ] }] })
    const res = await post({ op: 'renew', holder: H, leases: [{ project_id: P1, generation: 4 }, { project_id: P2, generation: 1 }] })
    expect(await res.json()).toEqual({ ok: true, expires_at: '2026-09-23T00:03:00Z', lost: [P2] })
  })
  describe('renew — 무거운 작업(heavy, 0106)', () => {
    const heavy = { pc: { k: 2, held: 1, waiting: 0, load: 3.5, cpus: 10 },
      orders: [{ id8: 'abcdef12', state: 'run', kind: 'run', pool: 'general', since: 1790000000, pos: null, n: 1, cmd: 'npm test' }] }
    const okRenew = () => ({ 'rpc:lead_lease_renew': [{ data: [{ project_id: P1, ok: true, expires_at: '2026-09-23T00:03:00Z' }] }] })
    const body = (extra: Record<string, unknown> = {}) => ({ op: 'renew', holder: H, leases: [{ project_id: P1, generation: 4 }], ...extra })

    it('renew 가 성공하면 lead_lease_heavy 로 PC 요약·주문을 넘긴다', async () => {
      const calls: Array<[string, unknown]> = []
      useAdmin({ ...base(), ...okRenew(), 'rpc:lead_lease_heavy': [{ data: 1 }] }, calls)
      const res = await post(body({ heavy }))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, expires_at: '2026-09-23T00:03:00Z', lost: [] })
      expect(calls.map(c => c[0])).toEqual(['lead_lease_renew', 'lead_lease_heavy'])
      expect(calls[1][1]).toEqual({ p_user: 'u-1', p_holder: H, p_pc: heavy.pc, p_orders: heavy.orders })
    })
    it('heavy 기록이 실패해도(0106 전 서버 등) renew 응답은 그대로 200', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      useAdmin({ ...base(), ...okRenew(), 'rpc:lead_lease_heavy': [{ error: { message: 'function does not exist' } }] })
      const res = await post(body({ heavy }))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, expires_at: '2026-09-23T00:03:00Z', lost: [] })
      expect(err).toHaveBeenCalled()
      err.mockRestore()
    })
    it('heavy 형식이 틀리면 renew 는 그대로, 로그를 남기고 옛 값을 비운다', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const calls: Array<[string, unknown]> = []
      useAdmin({ ...base(), ...okRenew() }, calls)
      const res = await post(body({ heavy: { pc: 'x', orders: [] } }))
      expect(res.status).toBe(200)
      expect(calls[1]).toEqual(['lead_lease_heavy', { p_user: 'u-1', p_holder: H, p_pc: null, p_orders: [] }])
      expect(err).toHaveBeenCalled()
      err.mockRestore()
    })
    it('heavy 가 없어도(옛 킷·snapshot 실패) 비우기로 부른다 — 옛 값이 lease 가 사는 동안 남지 않게', async () => {
      const calls: Array<[string, unknown]> = []
      useAdmin({ ...base(), ...okRenew() }, calls)
      await post(body())
      expect(calls.map(c => c[0])).toEqual(['lead_lease_renew', 'lead_lease_heavy'])
      expect(calls[1][1]).toEqual({ p_user: 'u-1', p_holder: H, p_pc: null, p_orders: [] })
    })
    it('renew 가 전부 lost 면 heavy 를 적지 않는다', async () => {
      const calls: Array<[string, unknown]> = []
      useAdmin({ ...base(), 'rpc:lead_lease_renew': [{ data: [{ project_id: P1, ok: false, expires_at: null }] }] }, calls)
      await post(body({ heavy }))
      expect(calls.map(c => c[0])).toEqual(['lead_lease_renew'])
    })
  })
  it('release — 풀린 행 수를 돌려준다', async () => {
    const calls: Array<[string, unknown]> = []
    useAdmin({ ...base(), 'rpc:lead_lease_release': [{ data: 1 }] }, calls)
    const res = await post({ op: 'release', holder: H, leases: [{ project_id: P1, generation: 4 }] })
    expect(await res.json()).toEqual({ ok: true, released: 1 })
    expect(calls[0]).toEqual(['lead_lease_release', { p_user: 'u-1', p_holder: H, p_leases: [{ project_id: P1, generation: 4 }] }])
  })
})
