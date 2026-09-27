import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * release — 설계 상태 스펙 D13. 설계 상태(design_state)가 있거나, 설계만 하던 주문(claim_scope design)이
 * ds·dd 단계면 반납하지 않는다 — 웹에서 「중단」을 쓰라고 안내한다(canRelease, src/lib/domain/designGate.ts).
 * 목·헬퍼는 tests/agent/design-first.test.ts 를 복사했다(claim-routes.test.ts 는 고치지 않는다).
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

import { POST as releasePOST } from '@/app/api/v1/agent/work/[id]/release/route'

const SECRET = 'test-agent-secret'
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const USER = { id: 'u-1', email: 'dev@example.com', user_metadata: {} }

type Resp = { data?: unknown; error?: { message: string } | null }
/** 전이 RPC 기본 응답 — 항목 없는 주문의 release 성공(단계·실적 건너뜀), 부수효과 없음. */
const RPC_OK = { ok: true, order_status: 'ready', stage: null, actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: 'no_item' }

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
      const resp = (queues.rpc ?? []).shift() ?? { data: RPC_OK }
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

describe('release — D13', () => {
  const base = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'hong/mbp/w1', claimed_by_user_id: null, wbs_item_id: W1 }
  const rel = () => releasePOST(post('release', { user_email: USER.email, agent: 'hong/mbp/w1' }), ctx)
  it('설계 상태가 있으면 409 design_gate, RPC 를 부르지 않는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: { ...base, design_state: 'accepted' } }], ...member() })
    const res = await rel()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'design_gate' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('RPC 가 design_gate(설계만 하던 주문이 ds·dd)를 주면 409 design_gate', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...base, claim_scope: 'design' } }], ...member(), rpc: [{ data: { ok: false, reason: 'design_gate', order_status: 'claimed' } }] })
    expect(await (await rel()).json()).toMatchObject({ code: 'design_gate' })
  })
  it('설계 상태가 없는 full 주문은 종전처럼 반납한다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: { ...base, claim_scope: 'full' } }], ...member() })
    expect((await rel()).status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'release', p_cas: { design_state: null, claim_scope: 'full' } }))
  })
})
