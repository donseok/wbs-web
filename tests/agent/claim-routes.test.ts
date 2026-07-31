import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { POST as releasePOST } from '@/app/api/v1/agent/work/[id]/release/route'

const SECRET = 'test-agent-secret'
const USER = { id: 'u-1', email: 'dev@example.com', user_metadata: {} }
// UUID 형식 테스트 픽스처
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null }

function useAdmin(queues: Record<string, Resp[]>, users = [USER]) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { listUsers: vi.fn(async () => ({ data: { users }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (url: string, body: unknown) => new NextRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
  body: JSON.stringify(body),
})
const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null }
const BODY = { user_email: 'dev@example.com', agent: 'claude-cli-dev1' }
const ctx = { params: Promise.resolve({ id: O1 }) }

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
})

describe('POST claim', () => {
  it('ready 주문 점유 성공', async () => {
    useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }], // 조회, CAS update.select
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, BODY), ctx)
    expect(res.status).toBe(200)
  })
  it('CAS 경합 — 이미 claimed 면 409 + 현재 상태', async () => {
    useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: [] }, { data: { status: 'claimed' } }], // CAS 0행 → 재조회
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, BODY), ctx)
    expect(res.status).toBe(409)
    expect((await res.json()).status).toBe('claimed')
  })
  it('멤버 아님 403', async () => {
    useAdmin({
      agent_work_orders: [{ data: ORDER }],
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [] }],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, BODY), ctx)
    expect(res.status).toBe(403)
  })
  it('agent 이름 형식 위반 400', async () => {
    useAdmin({})
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { ...BODY, agent: '공백 있음' }), ctx)
    expect(res.status).toBe(400)
  })
  it('경로 id UUID 형식 아니면 400', async () => {
    useAdmin({})
    const res = await claimPOST(post('http://l/api/v1/agent/work/not-uuid/claim', BODY), { params: Promise.resolve({ id: 'not-uuid' }) })
    expect(res.status).toBe(400)
  })
})

describe('POST release', () => {
  it('본인 점유만 반납 가능 — 타인 점유 403', async () => {
    useAdmin({
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'other-cli' } }],
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await releasePOST(post(`http://l/api/v1/agent/work/${O1}/release`, BODY), ctx)
    expect(res.status).toBe(403)
  })
})
