import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * 완료 보고 관문(설계 상태 스펙 12절 Y1·Y2·W23, 계획 P16) — 완료 보고는 도는 PC 에서만 받고, 호출 라벨과
 * 다른 세션이 살아 있으면 받지 않으며, 설계 검토 대기 중에도 받지 않는다. 리프의 단계 ip 조건(Y2)은
 * 라우트가 다시 읽지 않고 RPC(apply_workflow_event)가 CAS 로 잠근 행을 보고 design_gate 로 돌려주면
 * 그 사유를 옮기기만 한다(design-first.test.ts 의 목·헬퍼를 그대로 옮겨 쓴다).
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn().mockResolvedValue({ ok: true }),
  recordProgressSnapshot: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as reportPOST } from '@/app/api/v1/agent/work/[id]/report/route'

const SECRET = 'test-agent-secret'
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const USER = { id: 'u-1', email: 'dev@example.com', user_metadata: {} }

type Resp = { data?: unknown; error?: { message: string } | null }

function useAdmin(queues: Record<string, Resp[]>, users = [USER]) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'delete', 'insert', 'eq', 'in', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => {
      const resp = (queues.rpc ?? []).shift() ?? { data: null }
      return { data: resp.data ?? null, error: resp.error ?? null }
    }),
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users }, error: null })),
      },
    },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}

const post = (path: string, body: unknown, bearer = SECRET) => new NextRequest(`http://l/api/v1/agent/work/${O1}/${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  body: JSON.stringify(body),
})
const ctx = { params: Promise.resolve({ id: O1 }) }
const member = () => ({
  agent_projects: [{ data: { enabled: true } }],
  memberships: [{ data: { is_superuser: false } }],
  project_roles: [{ data: [{ role: 'member' }] }],
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('completion — 설계 상태 관문(12절 Y1·Y2·W23, 계획 P16)', () => {
  const base = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'hong/mbp/w1', claimed_by_user_id: null, wbs_item_id: W1 }
  const done = (agent = 'hong/mbp/w1') => reportPOST(post('report', { user_email: USER.email, agent, kind: 'completion', percent: 100, summary: '완료' }), ctx)

  it('runner 가 다른 PC 면 409 runner_active — 보고 행을 넣지 않는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: { ...base, runner: 'hong/pc2/w1', runner_seen_at: new Date(Date.now() - 90 * 60_000).toISOString() } }], ...member() })
    const res = await done()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'runner_active', runner: 'hong/pc2/w1' })
    expect(admin.from).not.toHaveBeenCalledWith('agent_work_reports')
  })
  it('살아 있는 다른 세션(heartbeat_agent 다름·5분 안)이 있으면 409 runner_active(P16)', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...base, claimed_by: 'claude-mbp', runner: 'hong/mbp/w1', heartbeat_agent: 'hong/mbp/w1',
      last_heartbeat_at: new Date().toISOString(), heartbeat_phase: 'build' } }], ...member() })
    expect((await done('claude-mbp')).status).toBe(409)
  })
  it('A2(최종 수정) — P16 거부 본문의 runner 칸은 막는 세션(heartbeat_agent)이다, 도는 PC 칸(runner)이 아니다', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...base, claimed_by: 'claude-mbp', runner: 'claude-mbp', heartbeat_agent: 'hong/mbp/w2',
      last_heartbeat_at: new Date().toISOString(), heartbeat_phase: 'build' } }], ...member() })
    const res = await done('claude-mbp')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'runner_active', runner: 'hong/mbp/w2' })
  })
  it('설계 검토 대기면 409 design_gate(W23)', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...base, design_state: 'review' } }], ...member() })
    expect(await (await done()).json()).toMatchObject({ code: 'design_gate' })
  })
  it('RPC 가 design_gate(리프 단계가 ip 아님, Y2)를 주면 보고 행을 지우고 409 design_gate', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: { ...base, runner: 'hong/mbp/w1' } }], ...member(),
      agent_work_reports: [{ data: [{ id: 'r-1' }] }, { data: null }],   // insert, cleanup delete
      rpc: [{ data: { ok: false, reason: 'design_gate', order_status: 'claimed' } }],
    })
    const res = await done()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'design_gate' })
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'report_completion', p_cas: { runner: 'hong/mbp/w1', design_state: null } }))
  })
})
