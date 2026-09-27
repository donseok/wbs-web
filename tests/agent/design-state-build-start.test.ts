import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * build-start 관문 — 검사 순서 runner → 설계 → 선행(설계 상태 스펙 5.2, 계획 P4).
 * 취소된 주문은 canBuildStart 전에 409 cancelled 로 먼저 거른다(라우트가 직접 본다).
 * claimed 가 아니거나 RPC CAS 가 어긋나면 409 design_gate·reason order_changed(Y7) — 워커는
 * 설계 되돌림처럼 끝난다. scope(full·build·rework, 없으면 legacy)로 canBuildStart 의 갈래를 고른다.
 * RPC CAS 는 design_state·design_mode·runner·claim_scope 넷만 싣는다 — runner_seen_at 은 뺀다
 * (도는 PC 자신의 heartbeat 가 이 값을 계속 갱신하므로, 판정과 쓰기 사이에 heartbeat 가 끼면
 * 정상 워커가 409 order_changed 를 받는다 — 계획 P6 이 heartbeat CAS 에서 뺀 것과 같은 까닭).
 * design-first.test.ts 의 목·헬퍼(레거시 시크릿 경로)를 그대로 옮겨 쓴다.
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

import { POST as buildStartPOST } from '@/app/api/v1/agent/work/[id]/build-start/route'

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
        getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: USER.email } }, error: null })),
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
const dep = (stage: string | null, over: Record<string, unknown> = {}) => ({ id: DEP_ID, external_ref: DEP_REF, stage, actual_pct: stage === 'ip' ? 30 : 0, ...over })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
})

describe('build-start — 설계 상태 관문(5.2, P4, Y7)', () => {
  const CLAIMED = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'hong/mbp/w1', claimed_by_user_id: null, wbs_item_id: W1,
    runner: 'hong/mbp/w1', runner_seen_at: new Date().toISOString(), design_state: null, claim_scope: 'full' }
  const bs = (body: Record<string, unknown>, agent = 'hong/mbp/w1') =>
    buildStartPOST(post('build-start', { user_email: USER.email, agent, ...body }), ctx)
  const itemRow = (o: Record<string, unknown> = {}) => ({ depends: [], depends_waived: [], stage: 'ds', actual_pct: 10, tags: ['agent'], design_mode: 'auto', ...o })

  it('다른 PC 가 30분 안에 신호를 냈으면 409 runner_active — 본문에 runner', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, claimed_by: 'hong/pc2/w1' } }], ...member(), wbs_items: [{ data: itemRow() }] })
    const res = await bs({ scope: 'full' }, 'hong/pc2/w1')
    // 호출자=점유자(hong/pc2/w1)지만 runner 는 mbp 가 신선하다
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'runner_active', runner: 'hong/mbp/w1', runner_seen_at: CLAIMED.runner_seen_at })
  })
  it('claimed 가 아니면 409 design_gate·reason order_changed(Y7)', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, status: 'ready' } }], ...member() })
    const res = await bs({ scope: 'build' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'design_gate', reason: 'order_changed' })
  })
  it('scope build — 설계가 승인되지 않았으면 409 design_not_accepted', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, design_state: 'review', claim_scope: 'design' } }], ...member(),
      wbs_items: [{ data: itemRow({ stage: 'dd', design_mode: 'review' }) }] })
    expect(await (await bs({ scope: 'build' })).json()).toMatchObject({ code: 'design_not_accepted' })
  })
  it('scope full — claim_scope design 이면 409 design_gate(설계만 하던 주문이 구현으로 새지 않는다)', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, claim_scope: 'design' } }], ...member(), wbs_items: [{ data: itemRow({ design_mode: 'review' }) }] })
    expect(await (await bs({ scope: 'full' })).json()).toMatchObject({ code: 'design_gate' })
  })
  it('통과하면 RPC 에 범위·CAS(설계 상태·방식·runner·claim_scope)·runner 를 싣는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member(), wbs_items: [{ data: itemRow() }] })
    const res = await bs({ scope: 'full' })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'build_start', p_scope: 'full', p_runner: 'hong/mbp/w1',
      p_cas: { design_state: null, design_mode: 'auto', runner: 'hong/mbp/w1', claim_scope: 'full' },
    }))
    expect(await res.json()).toMatchObject({ ok: true, runner: 'hong/mbp/w1' })
  })
  it('CAS 에는 runner_seen_at 을 넣지 않는다(P6 과 같은 까닭 — 같은 PC 의 heartbeat 와 부딪히지 않도록)', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member(), wbs_items: [{ data: itemRow() }] })
    await bs({ scope: 'full' })
    const [, args] = admin.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(args.p_cas).not.toHaveProperty('runner_seen_at')
  })
  it('RPC CAS 불일치는 409 design_gate·reason order_changed(Y7)', async () => {
    useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member(), wbs_items: [{ data: itemRow() }], rpc: [{ data: { ok: false, conflict: true, order_status: 'claimed' } }] })
    expect(await (await bs({ scope: 'full' })).json()).toMatchObject({ code: 'design_gate', reason: 'order_changed' })
  })
  it('rework 는 단계 ip 에서 선행을 보지 않는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, runner: null } }], ...member(),
      wbs_items: [{ data: itemRow({ stage: 'ip', depends: ['MES/TSK-01-00'] }) }, { data: [dep('as')] }] })
    const res = await bs({ scope: 'rework' })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_scope: 'rework' }))
  })
  it('항목 없는 주문(wbs_item_id null)도 도는 PC 조건은 본다 — 다른 PC 가 신선하면 409 runner_active, RPC 미호출', async () => {
    // 항목이 지워진 주문은 canBuildStart(설계 관문)를 타지 않는다(라우트가 건너뛴다) — 그래도 도는 PC
    // 조건(runnerFree)은 별도로 봐야 한다(route.ts 92~95행). 이 분기를 지우면 이 시험만 빨강이 된다.
    const admin = useAdmin({
      agent_work_orders: [{ data: { ...CLAIMED, wbs_item_id: null, claimed_by: 'hong/pc2/w1' } }], ...member(),
    })
    const res = await bs({ scope: 'full' }, 'hong/pc2/w1')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'runner_active', runner: 'hong/mbp/w1', runner_seen_at: CLAIMED.runner_seen_at })
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it.each(['design', 'bogus'])('build-start 의 scope 는 full·build·rework 만 허용 — %s 면 400, RPC 미호출', async (bad) => {
    const admin = useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member(), wbs_items: [{ data: itemRow() }] })
    const res = await bs({ scope: bad })
    expect(res.status).toBe(400)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
})
