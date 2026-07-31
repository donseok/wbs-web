import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORDER_ID = '12345678-1234-1234-1234-123456789abc'
const PROJECT_ID = '87654321-4321-4321-4321-987654321def'
const WBS_ITEM_ID = 'abcdef00-1111-2222-3333-444455556666'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  applyAgentProgress: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/agent/applyProgress', () => ({ applyAgentProgress: mocks.applyAgentProgress }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as reportPOST } from '@/app/api/v1/agent/work/[id]/report/route'

const SECRET = 'test-agent-secret'
const USER = { id: 'u-1', email: 'dev@example.com', user_metadata: {} }
type Resp = { data?: unknown; error?: { message: string } | null }

function useAdmin(queues: Record<string, Resp[]>, users = [USER]) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'insert', 'delete', 'eq', 'in', 'limit']) b[k] = () => b
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

const CLAIMED = { id: ORDER_ID, project_id: PROJECT_ID, status: 'claimed', claimed_by: 'cli-1', wbs_item_id: WBS_ITEM_ID }
const post = (body: unknown) => new NextRequest(`http://l/api/v1/agent/work/${ORDER_ID}/report`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
  body: JSON.stringify(body),
})
const BASE = { user_email: 'dev@example.com', agent: 'cli-1', summary: '요약', links: [{ url: 'https://github.com/x/pr/1' }] }
const ctx = { params: Promise.resolve({ id: ORDER_ID }) }

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
  mocks.applyAgentProgress.mockResolvedValue({ ok: true, projectId: PROJECT_ID })
})

describe('POST report', () => {
  it('progress — WBS 자동 반영 + 보고 행 기록', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }, { data: [{ id: ORDER_ID }] }], // 조회, updated_at 갱신
      agent_work_reports: [{ data: [{ id: 'r1' }] }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 40 }), ctx)
    expect(res.status).toBe(200)
    expect(mocks.applyAgentProgress).toHaveBeenCalledWith(expect.anything(),
      { wbsItemId: WBS_ITEM_ID, percent: 40, actorUserId: 'u-1' })
    expect((await res.json()).applied_to_wbs).toBe(true)
  })
  it('progress 100 은 400 — 완료는 승인 경로로', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 100 }), ctx)
    expect(res.status).toBe(400)
    expect(mocks.applyAgentProgress).not.toHaveBeenCalled()
  })
  it('completion — WBS 무변경, reported 전이', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }, { data: [{ id: ORDER_ID }] }], // 조회, CAS reported
      agent_work_reports: [{ data: [{ id: 'r1' }] }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'completion', percent: 100 }), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('reported')
    expect(mocks.applyAgentProgress).not.toHaveBeenCalled()
  })
  it('reported 상태에서 추가 보고 409 — 판정 전 원장 동결', async () => {
    useAdmin({
      agent_work_orders: [{ data: { ...CLAIMED, status: 'reported' } }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 50 }), ctx)
    expect(res.status).toBe(409)
  })
  it('타 에이전트 점유 주문에 보고 403', async () => {
    useAdmin({
      agent_work_orders: [{ data: { ...CLAIMED, claimed_by: 'other' } }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 50 }), ctx)
    expect(res.status).toBe(403)
  })
  it('wbs_item 이 삭제된 주문의 progress 는 409', async () => {
    useAdmin({
      agent_work_orders: [{ data: { ...CLAIMED, wbs_item_id: null } }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 50 }), ctx)
    expect(res.status).toBe(409)
  })
  it('비형식 id → 400', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const badCtx = { params: Promise.resolve({ id: 'not-a-uuid' }) }
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 40 }), badCtx)
    expect(res.status).toBe(400)
  })
  it('summary 누락 → 400', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, summary: '' }), ctx)
    expect(res.status).toBe(400)
  })
  it('links 비배열 → 400', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 40, links: 'not-array' }), ctx)
    expect(res.status).toBe(400)
  })
  it('링크 비http(s) URL → 400', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 40, links: [{ url: 'ftp://example.com' }] }), ctx)
    expect(res.status).toBe(400)
  })
  it('progress apply 실패 409 — insert 미호출', async () => {
    mocks.applyAgentProgress.mockResolvedValue({ ok: false, error: 'WBS 항목 잠금 중' })
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 40 }), ctx)
    expect(res.status).toBe(409)
    expect(res.json().then((j: unknown) => (j as Record<string, unknown>).code)).resolves.toBe('apply_failed')
  })
  it('completion insert 실패 500 — CAS 미실행', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }], // loadGatedOrder 만. CAS 미호출
      agent_work_reports: [{ data: null, error: { message: 'unique violation' } }],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'completion', percent: 100 }), ctx)
    expect(res.status).toBe(500)
  })
  it('completion 경합 — 보고 insert 후 CAS 0행 cleanup 409', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }], // loadGatedOrder 만. CAS 0행
      agent_work_reports: [
        { data: [{ id: 'r-new' }] }, // insert 성공
        { data: [{ id: 'r-new' }] }, // cleanup delete
      ],
      agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'completion', percent: 100 }), ctx)
    expect(res.status).toBe(409)
  })
})
