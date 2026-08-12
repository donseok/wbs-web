import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as mineGET } from '@/app/api/v1/agent/work/mine/route'

const P1 = '11111111-1111-4111-8111-111111111111'
type Resp = { data?: unknown; error?: { message: string } | null }

const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat' as const, owner_user_id: 'u-1', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}

function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'limit', 'order']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}

const get = (url: string, bearer: string) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${bearer}` } })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('GET /agent/work/mine', () => {
  it('scope 기본(available) — 멤버 프로젝트의 ready 주문만, priority desc 정렬', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [{ data: [
        { id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('available')
    expect(body.available).toHaveLength(1)
    expect(body.claimed).toBeUndefined()
  })

  it('scope=claimed — 본인 점유(claimed_by_user_id) 주문만', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [{ data: [
        { id: 'o-2', project_id: P1, status: 'claimed', priority: 0, instructions: '', claimed_at: '2026-08-01T00:00:00Z', wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=claimed', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('claimed')
    expect(body.claimed).toHaveLength(1)
    expect(body.available).toBeUndefined()
  })

  it('scope=all — claimed 구획을 먼저, available 을 나중에 채운다', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [{ id: 'o-2', project_id: P1, status: 'claimed', priority: 0, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' }] },
        { data: [{ id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' }] },
      ],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=all', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['ok', 'scope', 'claimed', 'available'])
    expect(body.claimed).toHaveLength(1)
    expect(body.available).toHaveLength(1)
  })

  it('지원하지 않는 scope → 400 unsupported_scope', async () => {
    useAdmin({ agent_runners: [{ data: RUNNER }, { data: null }] })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=assigned', PAT.token))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('unsupported_scope')
  })

  it('legacy 호출 400 identity_required', async () => {
    useAdmin({})
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', 'legacy-secret'))
    expect(res.status).toBe(400)
  })

  it('limit 상한 100 초과 → 400', async () => {
    useAdmin({ agent_runners: [{ data: RUNNER }, { data: null }] })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?limit=999', PAT.token))
    expect(res.status).toBe(400)
  })
})
