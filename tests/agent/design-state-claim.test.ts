import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * claim 라우트 — 범위(scope)와 설계 관문(designGate.canClaim, 설계 상태 스펙 5.2).
 * 레거시 시크릿 경로를 쓴다 — agent_runners 조회를 피해 큐를 단순하게 유지한다(design-first.test.ts 와 같은 방식).
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

import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'

const SECRET = 'test-agent-secret'
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const DEP_ID = '44444444-4444-4444-8444-444444444444'
const DEP_REF = 'MES/TSK-01-00'
const USER = { id: 'u-1', email: 'dev@example.com', user_metadata: {} }

type Resp = { data?: unknown; error?: { message: string } | null }
const RPC_OK = { ok: true, order_status: 'claimed', stage: 'ds', actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: null }

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
const ctx = { params: Promise.resolve({ id: O1 }) }
const member = () => ({
  agent_projects: [{ data: { enabled: true } }],
  memberships: [{ data: { is_superuser: false } }],
  project_roles: [{ data: [{ role: 'member' }] }],
})
const ITEM_ROW = (overrides: Record<string, unknown> = {}) => ({
  id: W1, code: 'C1', name: '항목1', external_ref: 'MES/TSK-01-01', stage: 'as', category: null, domain: null,
  priority: null, model: null, tags: null, depends: [DEP_REF], prd_ref: null, entry_point: null,
  acceptance: [], spec: null, assignee_member_id: null, planned_start: null, planned_end: null,
  depends_waived: [], stub_for: null, actual_pct: 0, design_mode: 'auto',
  ...overrides,
})
const dep = (stage: string | null, over: Record<string, unknown> = {}) => ({ id: DEP_ID, external_ref: DEP_REF, stage, actual_pct: stage === 'ip' ? 30 : 0, ...over })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('claim — 범위와 설계 관문(설계 상태 스펙 5.2)', () => {
  const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: W1 }
  const claim = (extra: Record<string, unknown> = {}) =>
    claimPOST(post('claim', { user_email: USER.email, agent: 'hong/mbp/w1', ...extra }), ctx)

  it('scope design — review 방식이면 통과하고 RPC 에 범위·CAS·runner 를 싣는다', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }],   // 주문 로드, 항목의 approved 주문 없음
      ...member(),
      wbs_items: [{ data: ITEM_ROW({ depends: null, design_mode: 'review' }) }],
    })
    const res = await claim({ scope: 'design' })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'claim', p_scope: 'design', p_runner: 'hong/mbp/w1',
      p_cas: { design_state: null, design_mode: 'review' },
    }))
  })
  it('scope 없음(legacy) + review 방식 → 409 design_gate, RPC 를 부르지 않는다(옛 킷은 일시 제외로 끝난다)', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: ORDER }, { data: null }], ...member(), wbs_items: [{ data: ITEM_ROW({ depends: null, design_mode: 'review' }) }] })
    const res = await claim()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'design_gate' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('scope build — human·accepted·dd 가 아니면 409 design_not_accepted', async () => {
    useAdmin({ agent_work_orders: [{ data: ORDER }, { data: null }], ...member(), wbs_items: [{ data: ITEM_ROW({ depends: null, design_mode: 'human', stage: 'as' }) }] })
    const res = await claim({ scope: 'build' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'design_not_accepted' })
  })
  it('scope build — 확정된 사람 설계(ready·accepted·dd)면 통과', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: { ...ORDER, design_state: 'accepted' } }, { data: null }],
      ...member(), wbs_items: [{ data: ITEM_ROW({ depends: null, design_mode: 'human', stage: 'dd' }) }],
    })
    const res = await claim({ scope: 'build' })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_scope: 'build', p_cas: { design_state: 'accepted', design_mode: 'human' } }))
  })
  it('이미 진행된 항목(실적 100)은 409 design_gate(D26·L6)', async () => {
    useAdmin({ agent_work_orders: [{ data: ORDER }, { data: null }], ...member(), wbs_items: [{ data: ITEM_ROW({ depends: null, actual_pct: 100 }) }] })
    expect((await claim({ scope: 'full' })).status).toBe(409)
  })
  it('approved 주문이 있는 항목은 409 design_gate(D26)', async () => {
    useAdmin({ agent_work_orders: [{ data: ORDER }, { data: { id: 'o-old' } }], ...member(), wbs_items: [{ data: ITEM_ROW({ depends: null }) }] })
    expect((await claim({ scope: 'full' })).status).toBe(409)
  })
  it('설계 선행 — 미충족 선행이 dd 여도 허용한다(D15)', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }, { data: null }],   // 주문, 선행 approved 없음, 항목 approved 없음
      ...member(), wbs_items: [{ data: ITEM_ROW() }, { data: [dep('dd', { actual_pct: 20 })] }],
    })
    const res = await claim({ design_first: true })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_stage: 'ds' }))
  })
  it('모르는 scope 는 400', async () => {
    useAdmin({})
    expect((await claim({ scope: 'weird' })).status).toBe(400)
  })
})
