import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

/**
 * design-done·design-reopen 동사(설계 상태 스펙 4.1·6.2~6.4, 계약 2.11).
 * - POST /work/{id}/design-done — 점유자 본인만, claimed 에서 design_done 사건(단계 ip 이상이면 RPC 가 design_gate).
 * - POST /work/{id}/design-reopen — claimed 면 점유자, ready 면 PAT(담당자가 있으면 담당자)만, design_reopen 사건.
 * design-first.test.ts 와 같은 목·헬퍼(레거시 시크릿 + PAT 픽스처)를 쓴다.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as doneRoute } from '@/app/api/v1/agent/work/[id]/design-done/route'
import { POST as reopenRoute } from '@/app/api/v1/agent/work/[id]/design-reopen/route'

const SECRET = 'test-agent-secret'
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const USER = { id: 'u-1', email: 'dev@example.com', user_metadata: {} }

type Resp = { data?: unknown; error?: { message: string } | null }
const RPC_OK = { ok: true, order_status: 'ready', prev_status: 'claimed', design_state: null, stage: 'as', actual_pct: 0, stage_changed: true, actual_changed: true, reached_first: false, skipped: null }

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
        getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: USER.email } }, error: null })), // PAT 소유자
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
// PAT 경로 — dflow.sh 가 실제로 쓰는 신원(depends-gate.test.ts 와 같은 픽스처).
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat' as const, owner_user_id: 'u-1', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read', 'work:claim'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
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
})
// console.error 스파이가 단언 실패로 mockRestore 를 건너뛰어도 다음 테스트로 새지 않게(수정 2회차 Minor).
afterEach(() => {
  vi.restoreAllMocks()
})

describe('design-done', () => {
  const CL = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'hong/mbp/w1', claimed_by_user_id: null, wbs_item_id: W1, design_state: null }
  const call = () => doneRoute(post('design-done', { user_email: USER.email, agent: 'hong/mbp/w1' }), ctx)
  it('점유자가 부르면 design_done 사건 — runner·CAS 를 싣는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: CL }], ...member(),
      rpc: [{ data: { ok: true, order_status: 'claimed', prev_status: 'claimed', design_state: 'review', stage: 'dd', actual_pct: 20, stage_changed: true, actual_changed: true, reached_first: false, skipped: null } }] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, stage: 'dd', design_state: 'review' })
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'design_done', p_agent: 'hong/mbp/w1', p_runner: 'hong/mbp/w1', p_cas: { design_state: null } }))
  })
  it('중단된 주문은 409 cancelled, claimed 아님은 409 design_gate', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CL, status: 'cancelled' } }], ...member() })
    expect(await (await call()).json()).toMatchObject({ code: 'cancelled' })
    useAdmin({ agent_work_orders: [{ data: { ...CL, status: 'reported' } }], ...member() })
    expect(await (await call()).json()).toMatchObject({ code: 'design_gate' })
  })
  it('RPC design_gate(단계 ip 이상)는 409 design_gate', async () => {
    useAdmin({ agent_work_orders: [{ data: CL }], ...member(), rpc: [{ data: { ok: false, reason: 'design_gate' } }] })
    expect((await call()).status).toBe(409)
  })
  it('점유자가 아니면 403 not_claim_owner(레거시) — RPC 를 부르지 않는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: CL }], ...member() })
    const res = await doneRoute(post('design-done', { user_email: USER.email, agent: 'other-agent' }), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('점유자가 아니면 403 not_claim_owner(PAT) — 계정이 다르거나 레거시 세션 점유 모두, RPC 를 부르지 않는다', async () => {
    const other = useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: { ...CL, claimed_by_user_id: 'u-9' } }], ...member(),
    })
    const r1 = await doneRoute(post('design-done', { agent: 'hong/mbp/w1' }, PAT.token), ctx)
    expect(r1.status).toBe(403)
    expect((await r1.json()).code).toBe('not_claim_owner')
    expect(other.rpc).not.toHaveBeenCalled()

    const legacyHeld = useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: { ...CL, claimed_by_user_id: null } }], ...member(),
    })
    const r2 = await doneRoute(post('design-done', { agent: 'hong/mbp/w1' }, PAT.token), ctx)
    expect(r2.status).toBe(403)
    expect((await r2.json()).code).toBe('not_claim_owner')
    expect(legacyHeld.rpc).not.toHaveBeenCalled()
  })
  it('RPC 가 conflict 를 주면 409 reason order_changed, error 를 주면 500', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAdmin({ agent_work_orders: [{ data: CL }], ...member(), rpc: [{ data: { ok: false, conflict: true, order_status: 'claimed' } }] })
    const r1 = await call()
    expect(r1.status).toBe(409)
    expect(await r1.json()).toMatchObject({ code: 'design_gate', reason: 'order_changed' })
    useAdmin({ agent_work_orders: [{ data: CL }], ...member(), rpc: [{ error: { message: 'db down' } }] })
    const r2 = await call()
    expect(r2.status).toBe(500)
    errSpy.mockRestore()
  })
})

describe('design-reopen', () => {
  const CL = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'hong/mbp/w1', claimed_by_user_id: null, wbs_item_id: W1, design_state: 'accepted' }
  const call = (body: Record<string, unknown> = { reason: '5절 중 테스트 계획 없음' }, bearer?: string) =>
    reopenRoute(post('design-reopen', { user_email: USER.email, agent: 'hong/mbp/w1', ...body }, bearer), ctx)
  it('reason 이 없거나 500자를 넘으면 400', async () => {
    useAdmin({})
    expect((await call({ reason: '' })).status).toBe(400)
    expect((await call({ reason: 'x'.repeat(501) })).status).toBe(400)
  })
  it('점유자가 부르면 design_reopen 사건 — 사유를 note 로', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: CL }], ...member(),
      rpc: [{ data: { ok: true, order_status: 'ready', prev_status: 'claimed', design_state: null, stage: 'as', actual_pct: 0, stage_changed: true, actual_changed: true, reached_first: false, skipped: null } }] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'design_reopen', p_note: '5절 중 테스트 계획 없음', p_cas: { design_state: 'accepted' } }))
    expect(await res.json()).toMatchObject({ ok: true, status: 'ready', design_state: null })
  })
  it('ready 주문은 레거시 시크릿으로 되돌릴 수 없다(PAT 만 — 후보를 받는 에이전트)', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CL, status: 'ready', claimed_by: null } }], ...member() })
    expect((await call()).status).toBe(403)
  })
  it('ready 주문 — PAT 이고 담당자가 없으면 통과(팀장의 띄우기 전 검사)', async () => {
    const admin = useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: { ...CL, status: 'ready', claimed_by: null } }], ...member(),
      wbs_items: [{ data: { assignee_member_id: null } }],
    })
    const res = await call({ reason: 'design.md 없음' }, PAT.token)
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'design_reopen' }))
  })
  it('ready 주문 — 담당자가 호출자의 멤버 행이면 통과, 사유가 p_note 로 실린다', async () => {
    const admin = useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: { ...CL, status: 'ready', claimed_by: null } }], ...member(),
      wbs_items: [{ data: { assignee_member_id: 'm-1' } }],
      project_members: [{ data: [{ id: 'm-1', user_id: 'u-1', email: USER.email }] }],
    })
    const res = await call({ reason: '담당자 본인 확인' }, PAT.token)
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'design_reopen', p_note: '담당자 본인 확인' }))
  })
  it('ready 주문 — 담당자가 다른 사람이면 403 not_assignee', async () => {
    const admin = useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: { ...CL, status: 'ready', claimed_by: null } }], ...member(),
      wbs_items: [{ data: { assignee_member_id: 'm-2' } }],
      project_members: [{ data: [{ id: 'm-2', user_id: 'u-9', email: 'other@example.com' }] }],
    })
    const res = await call({ reason: '담당자 아님' }, PAT.token)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_assignee')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('claimed 이고 점유자가 아니면 403 not_claim_owner(PAT) — RPC 를 부르지 않는다', async () => {
    const admin = useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: { ...CL, claimed_by_user_id: 'u-9' } }], ...member(),
    })
    const res = await call(undefined, PAT.token)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('claimed 이고 점유 라벨이 다르면 403 not_claim_owner(레거시) — RPC 를 부르지 않는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: CL }], ...member() })
    const res = await reopenRoute(post('design-reopen', { user_email: USER.email, agent: 'other-agent', reason: '사유' }), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
})
