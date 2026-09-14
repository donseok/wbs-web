import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST } from '@/app/api/v1/agent/watch/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '99999999-9999-4999-8999-999999999999'
type Resp = { data?: unknown; error?: { message: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix, token_hash: PAT.hash,
  project_id: null as string | null, scopes: ['work:claim'], enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}

function useAdmin(queues: Record<string, Resp[]>, calls: Record<string, unknown[]> = {}) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.upsert = (payload: unknown, opts: unknown) => { (calls[`${table}:upsert`] ??= []).push([payload, opts]); return b }
      b.delete = () => { (calls[`${table}:delete`] ??= []).push(true); return b }
      b.update = () => b
      for (const k of ['eq', 'lt', 'in', 'limit', 'order']) b[k] = () => b
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
  POST(new NextRequest('http://l/api/v1/agent/watch', {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
const runnerQueues = (runner = RUNNER) => ({ agent_runners: [{ data: runner }, { data: null }], agent_watchers: [{ data: null }, { data: null }] })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('POST /agent/watch', () => {
  it('200 — (user_id, agent) 로 upsert 하고 expires_at = last_seen_at + 70분', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, until: '18:00' })
    expect(res.status).toBe(200)
    const body = await res.json()
    const [payload, opts] = calls['agent_watchers:upsert'][0] as [Record<string, unknown>, Record<string, unknown>]
    expect(payload).toMatchObject({ user_id: 'u-1', agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, until_label: '18:00', project_id: null })
    expect(opts).toEqual({ onConflict: 'user_id,agent' })
    expect(Date.parse(body.expires_at) - Date.parse(payload.last_seen_at as string)).toBe(WATCHER_TTL_MS)
  })
  it('오래된 행(7일)을 같은 호출에서 지운다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    await post({ agent: 'hong/mbp/lead' })
    expect(calls['agent_watchers:delete']).toHaveLength(1)
  })
  it('stop: true — 행을 지우고 stopped 로 답한다(upsert 없음)', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'hong/mbp/lead', stop: true })
    expect((await res.json())).toEqual({ ok: true, stopped: true })
    expect(calls['agent_watchers:upsert']).toBeUndefined()
    expect(calls['agent_watchers:delete']).toHaveLength(1)
  })
  it('프로젝트 한정 PAT 는 project_id 를 강제하고, 다른 값이면 403 forbidden_role', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues({ ...RUNNER, project_id: P1 }), calls)
    const ok = await post({ agent: 'a' })
    expect(ok.status).toBe(200)
    expect((calls['agent_watchers:upsert'][0] as [Record<string, unknown>])[0].project_id).toBe(P1)
    useAdmin(runnerQueues({ ...RUNNER, project_id: P1 }))
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(403)
  })
  it('400 — agent 없음 / project_id 형식 오류 / slots 음수', async () => {
    useAdmin(runnerQueues()); expect((await post({})).status).toBe(400)
    useAdmin(runnerQueues()); expect((await post({ agent: 'a', project_id: 'nope' })).status).toBe(400)
    useAdmin(runnerQueues()); expect((await post({ agent: 'a', slots: -1 })).status).toBe(400)
  })
  it('레거시 시크릿 → 400 identity_required (PAT 전용)', async () => {
    useAdmin(runnerQueues())
    const res = await post({ agent: 'a' }, 'legacy-secret')
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
  })
  it('403 insufficient_scope — work:read 만 있는 PAT', async () => {
    useAdmin(runnerQueues({ ...RUNNER, scopes: ['work:read'] }))
    expect((await post({ agent: 'a' })).status).toBe(403)
  })
})
