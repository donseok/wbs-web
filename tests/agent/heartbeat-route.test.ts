import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST } from '@/app/api/v1/agent/work/[id]/heartbeat/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix, token_hash: PAT.hash,
  project_id: null, scopes: ['work:claim'], enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
const ORDER = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'pat-r-1', claimed_by_user_id: 'u-1', wbs_item_id: null }

/** 큐 순서(work-routes-pat.test.ts 상세 조회와 같다): agent_runners(조회, last_seen) → 주문 → agent_projects → memberships → project_roles → 주문 update */
function useAdmin(queues: Record<string, Resp[]>, calls: Record<string, unknown[]> = {}) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.update = (payload: unknown) => { (calls[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (calls[`${table}:insert`] ??= []).push(payload); return b }
      for (const k of ['eq', 'in', 'limit', 'order']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (body: unknown, bearer = PAT.token) =>
  POST(new NextRequest(`http://l/api/v1/agent/work/${O1}/heartbeat`, {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: O1 }) })
const okQueues = (order = ORDER) => ({
  agent_runners: [{ data: RUNNER }, { data: null }],
  agent_work_orders: [{ data: order }, { data: [{ id: O1 }] }],
  agent_projects: [{ data: { enabled: true } }],
  memberships: [{ data: { is_superuser: false } }],
  project_roles: [{ data: [{ role: 'member' }] }],
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('POST /agent/work/[id]/heartbeat', () => {
  it('200 — 열 4개를 touch 하고 보고 행은 만들지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    const res = await post({ agent: 'hong/mbp/w1', phase: 'build' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.last_heartbeat_at).toBe('string')
    const upd = calls.agent_work_orders?.[0] as Record<string, unknown>
    expect(upd.heartbeat_agent).toBe('hong/mbp/w1')
    expect(upd.heartbeat_phase).toBe('build')
    expect(upd.heartbeat_note).toBeNull()
    expect(upd.last_heartbeat_at).toBe(body.last_heartbeat_at)
    expect(upd.updated_at).toBe(body.last_heartbeat_at)
    expect(calls['agent_work_reports:insert']).toBeUndefined()
  })
  it('blocked 는 note 를 저장하고, phase 생략은 phase·note 를 null 로 둔다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    await post({ agent: 'hong/mbp/w1', phase: 'blocked', note: '어느 DB 를 쓸까요?' })
    expect((calls.agent_work_orders[0] as Record<string, unknown>).heartbeat_note).toBe('어느 DB 를 쓸까요?')
    const calls2: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls2)
    await post({ agent: 'hong/mbp/w1' })
    const upd = calls2.agent_work_orders[0] as Record<string, unknown>
    expect(upd.heartbeat_phase).toBeNull(); expect(upd.heartbeat_note).toBeNull()
  })
  it('blocked + 공백뿐인 note 는 heartbeat_note 를 null 로 둔다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    const res = await post({ agent: 'hong/mbp/w1', phase: 'blocked', note: '   ' })
    expect(res.status).toBe(200)
    const upd = calls.agent_work_orders[0] as Record<string, unknown>
    expect(upd.heartbeat_phase).toBe('blocked')
    expect(upd.heartbeat_note).toBeNull()
  })
  it('400 — agent 없음 / 모르는 phase / note 500자 초과', async () => {
    useAdmin(okQueues()); expect((await post({ phase: 'build' })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', phase: 'lunch' })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', phase: 'blocked', note: 'x'.repeat(501) })).status).toBe(400)
  })
  it('409 — claimed 가 아니면 touch 하지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues({ ...ORDER, status: 'reported' }), calls)
    const res = await post({ agent: 'a', phase: 'build' })
    expect(res.status).toBe(409)
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('403 not_claim_owner — 다른 사용자가 점유한 주문', async () => {
    useAdmin(okQueues({ ...ORDER, claimed_by_user_id: 'u-9' }))
    const res = await post({ agent: 'a', phase: 'build' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
  })
  it('409 conflict — CAS 0행(경합으로 상태가 바뀜)', async () => {
    useAdmin({ ...okQueues(), agent_work_orders: [{ data: ORDER }, { data: [] }] })
    expect((await post({ agent: 'a', phase: 'build' })).status).toBe(409)
  })
  it('403 insufficient_scope — work:read 만 있는 PAT', async () => {
    useAdmin({ ...okQueues(), agent_runners: [{ data: { ...RUNNER, scopes: ['work:read'] } }, { data: null }] })
    expect((await post({ agent: 'a', phase: 'build' })).status).toBe(403)
  })
})
