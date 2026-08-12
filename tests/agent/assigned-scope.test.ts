import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))

import { myMemberIds } from '@/lib/agent/assignee'
import { GET as mineGET } from '@/app/api/v1/agent/work/mine/route'
import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
type Resp = { data?: unknown; error?: { message: string } | null }

const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat' as const, owner_user_id: 'u-1', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read', 'work:claim'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: W1 }
const ITEM_COMMON = {
  id: W1, code: 'C1', name: '항목1', external_ref: null, stage: null, category: null, domain: null,
  priority: null, model: null, tags: null, depends: null, prd_ref: null, entry_point: null,
  acceptance: [], spec: null, planned_start: null, planned_end: null,
}
const ctx = { params: Promise.resolve({ id: O1 }) }

function useAdmin(queues: Record<string, Resp[]>, users: Array<{ id: string; email: string; user_metadata: unknown }> = []) {
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
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })),
        listUsers: vi.fn(async () => ({ data: { users }, error: null })), // resolveUserByEmail(레거시 경로)
      },
    },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}

const get = (url: string, bearer: string) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${bearer}` } })
const post = (url: string, body: unknown, bearer: string) => new NextRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  body: JSON.stringify(body),
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('myMemberIds — 로스터 다리 이중 매칭', () => {
  it('user_id 링크 행과 email 매칭 행을 합집합·중복 제거로 반환', async () => {
    useAdmin({
      project_members: [{ data: [
        { id: 'm1', user_id: 'u-1', email: null },
        { id: 'm2', user_id: null, email: 'DEV@example.com' },
        { id: 'm3', user_id: 'u-9', email: 'x@y.z' },
      ] }],
    })
    const admin = mocks.createAdminClient()
    const result = await myMemberIds(admin, { userId: 'u-1', userEmail: 'dev@example.com', projectId: P1 })
    expect(result).toEqual(['m1', 'm2'])
    expect(result).not.toContain('m3')
  })

  it('조회 실패는 throw (보안 판정 재료 — 위장 금지)', async () => {
    useAdmin({ project_members: [{ error: { message: 'db down' } }] })
    const admin = mocks.createAdminClient()
    await expect(myMemberIds(admin, { userId: 'u-1', userEmail: 'dev@example.com', projectId: P1 }))
      .rejects.toThrow()
  })
})

describe('scope=assigned', () => {
  it('내 배정 항목의 활성 주문만 반환', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      project_members: [{ data: [{ id: 'm1', user_id: 'u-1', email: null }] }],
      wbs_items: [
        { data: [{ id: W1 }] }, // assignee_member_id in (myMemberIds) 항목 조회
        { data: [{ id: W1, code: 'C1', name: '항목1', planned_start: null, planned_end: null }] }, // 컨텍스트
      ],
      agent_work_orders: [{ data: [
        { id: O1, project_id: P1, status: 'ready', priority: 0, instructions: '', claimed_at: null, wbs_item_id: W1, created_at: '2026-08-01T00:00:00Z' },
      ] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=assigned', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('assigned')
    expect(body.assigned).toHaveLength(1)
    expect(body.assigned[0].id).toBe(O1)
    expect(body.claimed).toBeUndefined()
    expect(body.available).toBeUndefined()
  })
})

describe('claim 배정 제한', () => {
  it('배정 항목 + 본인 → 200', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }], // 로드, CAS
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [{ data: { ...ITEM_COMMON, assignee_member_id: 'm1' } }],
      project_members: [{ data: [{ id: 'm1', user_id: 'u-1', email: null }] }], // myMemberIds → 내 것
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('claimed')
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.claimed', projectId: P1, entityType: 'agent_order', entityId: O1,
      recipientMemberIds: ['m1'],
    }))
  })

  it('배정 항목 + 타인 → 403 not_assignee', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: ORDER }], // 로드만 — CAS 도달 안 함
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [{ data: { ...ITEM_COMMON, assignee_member_id: 'm1' } }],
      project_members: [{ data: [{ id: 'm1', user_id: 'u-9', email: 'other@example.com' }] }], // m1 은 다른 사용자
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_assignee')
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('무배정 항목 → 선착순 그대로 200', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }], // 로드, CAS
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [{ data: { ...ITEM_COMMON, assignee_member_id: null } }],
      // project_members 큐 없음 — 무배정이면 myMemberIds 를 호출하지 않는다.
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(200)
  })

  it('레거시 경로 + 배정 항목 + 타인 → 403 not_assignee(동일 게이트 적용)', async () => {
    useAdmin({
      agent_work_orders: [{ data: ORDER }], // 로드만 — CAS 도달 안 함
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [{ data: { ...ITEM_COMMON, assignee_member_id: 'm1' } }],
      project_members: [{ data: [{ id: 'm1', user_id: 'u-9', email: 'other@example.com' }] }], // m1 은 다른 사용자
    }, [{ id: 'u-legacy', email: 'dev@example.com', user_metadata: {} }])
    const res = await claimPOST(
      post(`http://l/api/v1/agent/work/${O1}/claim`, { user_email: 'dev@example.com', agent: 'claude-cli-dev1' }, 'legacy-secret'),
      ctx,
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_assignee')
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })
})
