import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORDER_ID = '12345678-1234-1234-1234-123456789abc'
const PROJECT_ID = '87654321-4321-4321-4321-987654321def'
const WBS_ITEM_ID = 'abcdef00-1111-2222-3333-444455556666'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
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
/** 전이 RPC 기본 응답 — 부수효과(스냅샷·도달 알림)가 없는 성공. 케이스마다 queues.rpc 로 덮는다. */
const RPC_OK = { ok: true, order_status: 'reported', stage: 'im', actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: null }

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
    rpc: vi.fn(async (_fn: string, _args: Record<string, unknown>) => {
      const resp = (queues.rpc ?? []).shift() ?? { data: RPC_OK }
      return { data: resp.data ?? null, error: resp.error ?? null }
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
const member = () => ({
  agent_projects: [{ data: { project_id: PROJECT_ID, enabled: true } }],
  memberships: [{ data: { is_superuser: false } }],
  project_roles: [{ data: [{ role: 'member' }] }],
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
})

describe('POST report', () => {
  it('progress — 보고 행만 기록하고 WBS 실적은 건드리지 않는다(계약 v2.3)', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: CLAIMED }, { data: [{ id: ORDER_ID }] }], // 조회, updated_at 갱신
      agent_work_reports: [{ data: [{ id: 'r1' }] }],
      ...member(),
    })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 40 }), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).applied_to_wbs).toBe(false)
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(admin.from.mock.calls.map(c => c[0])).not.toContain('wbs_items')
    expect(mocks.recordProgressSnapshot).not.toHaveBeenCalled()
  })
  it('progress 100 은 400 — 완료는 승인 경로로', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member() })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 100 }), ctx)
    expect(res.status).toBe(400)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('completion — 전이 RPC 한 번으로 reported(레거시는 점유자 라벨 일치 조건)', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      agent_work_reports: [{ data: [{ id: 'r1' }] }],
      ...member(),
    })
    const res = await reportPOST(post({ ...BASE, kind: 'completion', percent: 100 }), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('reported')
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'report_completion', p_order_id: ORDER_ID, p_agent: 'cli-1', p_agent_user_id: null, p_actor: 'u-1',
    }))
  })
  it('completion 이 실적을 바꾸고 im 에 처음 도달하면 스냅샷을 남기고 도달 알림용 항목을 읽는다', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      agent_work_reports: [{ data: [{ id: 'r1' }] }],
      ...member(),
      wbs_items: [
        { data: { name: '항목1' } }, // 보고 알림용 이름
        { data: { id: WBS_ITEM_ID, project_id: PROJECT_ID, name: '항목1', external_ref: null } }, // 도달 알림용 항목
      ],
      rpc: [{ data: { ...RPC_OK, stage_changed: true, actual_changed: true, actual_pct: 80, reached_first: true } }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'completion', percent: 100 }), ctx)
    expect(res.status).toBe(200)
    expect(mocks.recordProgressSnapshot).toHaveBeenCalledWith(PROJECT_ID, admin)
    expect(admin.from.mock.calls.filter(c => c[0] === 'wbs_items')).toHaveLength(2)
  })
  it('reported 상태에서 추가 보고 409 — 판정 전 원장 동결', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, status: 'reported' } }], ...member() })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 50 }), ctx)
    expect(res.status).toBe(409)
  })
  it('타 에이전트 점유 주문에 보고 403', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, claimed_by: 'other' } }], ...member() })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 50 }), ctx)
    expect(res.status).toBe(403)
  })
  it('wbs_item 이 삭제된 주문의 progress 도 보고 행은 기록한다 — 반영할 실적이 없으니 막을 이유도 없다', async () => {
    useAdmin({
      agent_work_orders: [{ data: { ...CLAIMED, wbs_item_id: null } }, { data: [{ id: ORDER_ID }] }],
      agent_work_reports: [{ data: [{ id: 'r1' }] }],
      ...member(),
    })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 50 }), ctx)
    expect(res.status).toBe(200)
  })
  it('비형식 id → 400', async () => {
    useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member() })
    const badCtx = { params: Promise.resolve({ id: 'not-a-uuid' }) }
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 40 }), badCtx)
    expect(res.status).toBe(400)
  })
  it('summary 누락 → 400', async () => {
    useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member() })
    const res = await reportPOST(post({ ...BASE, summary: '' }), ctx)
    expect(res.status).toBe(400)
  })
  it('links 비배열 → 400', async () => {
    useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member() })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 40, links: 'not-array' }), ctx)
    expect(res.status).toBe(400)
  })
  it('링크 비http(s) URL → 400', async () => {
    useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member() })
    const res = await reportPOST(post({ ...BASE, kind: 'progress', percent: 40, links: [{ url: 'ftp://example.com' }] }), ctx)
    expect(res.status).toBe(400)
  })
  it('completion insert 실패 500 — 전이 RPC 미호출', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: CLAIMED }], // loadGatedOrder 만
      agent_work_reports: [{ data: null, error: { message: 'unique violation' } }],
      ...member(),
    })
    const res = await reportPOST(post({ ...BASE, kind: 'completion', percent: 100 }), ctx)
    expect(res.status).toBe(500)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('completion 경합 — 보고 insert 후 RPC conflict 면 보고 행을 지우고 409', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      agent_work_reports: [
        { data: [{ id: 'r-new' }] }, // insert 성공
        { data: [{ id: 'r-new' }] }, // cleanup delete
      ],
      ...member(),
      rpc: [{ data: { ok: false, conflict: true, order_status: 'reported' } }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'completion', percent: 100 }), ctx)
    expect(res.status).toBe(409)
    expect(admin.from.mock.calls.filter(c => c[0] === 'agent_work_reports')).toHaveLength(2)
  })
  it('completion 전이 RPC 오류면 보고 행을 지우고 500 — 반쪽 상태를 남기지 않는다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const admin = useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      agent_work_reports: [{ data: [{ id: 'r-new' }] }, { data: [{ id: 'r-new' }] }],
      ...member(),
      rpc: [{ error: { message: 'db down' } }],
    })
    const res = await reportPOST(post({ ...BASE, kind: 'completion', percent: 100 }), ctx)
    expect(res.status).toBe(500)
    expect(admin.from.mock.calls.filter(c => c[0] === 'agent_work_reports')).toHaveLength(2)
    errSpy.mockRestore()
  })
})
