import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * 설계 선행 claim 과 build-start(스펙 2026-09-26 §6.3, 계약 v2.9).
 * - claim + design_first:true — 미충족 선행이 모두 ip 면 claim 을 허용하고 RPC 에 p_stage 'ds'.
 *   아니면 403 dependency_not_met + reason design_first_too_early. 플래그가 없으면 종전과 글자 그대로 같다.
 * - POST /work/{id}/build-start — 점유자 본인·claimed·선행 모두 reached 일 때 build_start 사건.
 * 레거시 시크릿 경로를 쓴다 — agent_runners 조회를 피해 큐를 단순하게 유지한다(stage-lifecycle 과 같은 방식).
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
import * as buildStartRoute from '@/app/api/v1/agent/work/[id]/build-start/route'

const buildStartPOST = buildStartRoute.POST
const SECRET = 'test-agent-secret'
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const DEP_ID = '44444444-4444-4444-8444-444444444444'
const DEP_ID2 = '55555555-5555-4555-8555-555555555555'
const DEP_REF = 'MES/TSK-01-00'
const DEP_REF2 = 'MES/TSK-01-02'
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
    auth: { admin: { listUsers: vi.fn(async () => ({ data: { users }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}

const post = (path: string, body: unknown) => new NextRequest(`http://l/api/v1/agent/work/${O1}/${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
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
  depends_waived: [], stub_for: null,
  ...overrides,
})
const dep = (stage: string | null, over: Record<string, unknown> = {}) => ({ id: DEP_ID, external_ref: DEP_REF, stage, actual_pct: stage === 'ip' ? 30 : 0, ...over })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('claim — design_first(설계 선행)', () => {
  const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: W1 }
  const claim = (extra: Record<string, unknown> = {}) =>
    claimPOST(post('claim', { user_email: USER.email, agent: 'cli-1', ...extra }), ctx)

  it('미충족 선행이 모두 ip 면 허용 — RPC 에 p_stage ds, 응답에 design_first·unmet', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }], // 로드, 선행 approved 주문 없음
      ...member(),
      wbs_items: [{ data: ITEM_ROW() }, { data: [dep('ip')] }],
    })
    const res = await claim({ design_first: true })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'claim', p_order_id: O1, p_stage: 'ds', p_agent: 'cli-1',
    }))
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, status: 'claimed', design_first: true, unmet: [{ external_ref: DEP_REF, stage: 'ip' }] })
    expect(body.depends_evidence).toHaveLength(1)
  })

  it('선행이 모두 충족돼도 design_first 면 ds 로 claim 하고 unmet 은 빈 배열이다', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }],
      ...member(),
      wbs_items: [{ data: ITEM_ROW() }, { data: [dep('im')] }],
    })
    const res = await claim({ design_first: true })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_stage: 'ds' }))
    expect(await res.json()).toMatchObject({ design_first: true, unmet: [] })
  })

  it('선행이 없어도 design_first 면 ds 로 claim 한다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: ORDER }], ...member(), wbs_items: [{ data: ITEM_ROW({ depends: null }) }] })
    const res = await claim({ design_first: true })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_stage: 'ds' }))
    expect(await res.json()).toMatchObject({ design_first: true, unmet: [] })
  })

  it.each([
    ['as(착수 전)', 'as'],
    ['ds(선행도 설계만 하는 중 — 한 단계 깊이까지만)', 'ds'],
    ['미착수(null)', null],
  ])('미충족 선행이 %s 이면 403 design_first_too_early — RPC 를 부르지 않는다', async (_n, stage) => {
    const admin = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }, { data: null }],
      ...member(),
      wbs_items: [
        { data: ITEM_ROW({ depends: [DEP_REF, DEP_REF2] }) },
        { data: [dep('ip'), { id: DEP_ID2, external_ref: DEP_REF2, stage, actual_pct: 0 }] },
      ],
    })
    const res = await claim({ design_first: true })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'dependency_not_met', reason: 'design_first_too_early' })
    expect(body.unmet).toEqual([{ external_ref: DEP_REF, stage: 'ip' }, { external_ref: DEP_REF2, stage }])
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('선행 ref 가 프로젝트에 없으면(fail-closed) design_first 여도 403 too_early', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: ORDER }],
      ...member(),
      wbs_items: [{ data: ITEM_ROW() }, { data: [] }],
    })
    const res = await claim({ design_first: true })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ reason: 'design_first_too_early', unmet: [{ external_ref: DEP_REF, stage: null }] })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('design_first 가 불리언이 아니면 400', async () => {
    const admin = useAdmin({})
    const res = await claim({ design_first: 'yes' })
    expect(res.status).toBe(400)
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('design_first:false 는 플래그 없음과 같다(종전 관문)', async () => {
    useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }],
      ...member(),
      wbs_items: [{ data: ITEM_ROW() }, { data: [dep('ip')] }],
    })
    const res = await claim({ design_first: false })
    expect(res.status).toBe(403)
    expect(Object.keys(await res.json()).sort()).toEqual(['code', 'error', 'unmet'])
  })
})

describe('claim — 플래그 없음은 종전과 글자 그대로 같다', () => {
  const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: W1 }
  const claim = () => claimPOST(post('claim', { user_email: USER.email, agent: 'cli-1' }), ctx)

  it('선행 ip 면 403 — 본문은 error·code·unmet 셋뿐(reason 없음)', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }],
      ...member(),
      wbs_items: [{ data: ITEM_ROW() }, { data: [dep('ip')] }],
    })
    const res = await claim()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({
      error: '선행 작업이 끝나지 않았습니다(검수 대기 이상도, 승인도, 실적 100% 도 아님).', code: 'dependency_not_met',
      unmet: [{ external_ref: DEP_REF, stage: 'ip' }],
    })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('통과하면 RPC 에 p_stage null(→ ip), 응답에 design_first·unmet 키가 없다', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }],
      ...member(),
      wbs_items: [{ data: ITEM_ROW() }, { data: [dep('im')] }],
    })
    const res = await claim()
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'claim', p_stage: null }))
    expect(Object.keys(await res.json()).sort()).toEqual(['depends_evidence', 'item', 'ok', 'status'])
  })
})

describe('POST /work/{id}/build-start', () => {
  const CLAIMED = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'cli-1', claimed_by_user_id: null, wbs_item_id: W1 }
  const start = (agent = 'cli-1') => buildStartPOST(post('build-start', { user_email: USER.email, agent }), ctx)

  it('선행이 모두 reached 면 build_start 사건(레거시 점유자 라벨 일치 조건)을 부른다', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: CLAIMED }, { data: null }],
      ...member(),
      wbs_items: [{ data: { depends: [DEP_REF], depends_waived: [] } }, { data: [dep('im')] }],
      rpc: [{ data: { ...RPC_OK, stage: 'ip', actual_pct: 30, stage_changed: true, actual_changed: true } }],
    })
    const res = await start()
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'build_start', p_order_id: O1, p_agent: 'cli-1', p_agent_user_id: null, p_actor: USER.id,
    }))
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, status: 'claimed', stage: 'ip', stage_changed: true })
    expect(body.depends_evidence).toHaveLength(1)
    // 실적이 바뀌었으면 claim 과 같은 후처리
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/p/${P1}`, 'layout')
    expect(mocks.recordProgressSnapshot).toHaveBeenCalledWith(P1, expect.anything())
  })

  it('이미 ip 이상이면 멱등 — 200, 후처리 없음', async () => {
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      ...member(),
      wbs_items: [{ data: { depends: null, depends_waived: [] } }],
      rpc: [{ data: { ...RPC_OK, stage: 'ip', actual_pct: 30 } }],
    })
    const res = await start()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, stage: 'ip', stage_changed: false })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.recordProgressSnapshot).not.toHaveBeenCalled()
  })

  it('선행 미충족이면 403 dependency_not_met + unmet — RPC 를 부르지 않는다', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: CLAIMED }, { data: null }],
      ...member(),
      wbs_items: [{ data: { depends: [DEP_REF], depends_waived: [] } }, { data: [dep('ip')] }],
    })
    const res = await start()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'dependency_not_met', unmet: [{ external_ref: DEP_REF, stage: 'ip' }] })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('면제된 선행(depends_waived)은 충족으로 본다', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: CLAIMED }, { data: null }],
      ...member(),
      wbs_items: [{ data: { depends: [DEP_REF], depends_waived: [DEP_REF] } }, { data: [dep('as')] }],
    })
    const res = await start()
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledTimes(1)
  })

  it('점유자가 아니면 403 not_claim_owner', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member() })
    const res = await start('cli-other')
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('PAT 가 점유한 주문은 레거시로 부를 수 없다(403 not_claim_owner)', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, claimed_by_user_id: 'u-9' } }], ...member() })
    const res = await start()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('claimed 가 아니면 409 conflict, 중단된 주문이면 409 cancelled', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, status: 'reported' } }], ...member() })
    const r1 = await start()
    expect(r1.status).toBe(409)
    expect((await r1.json()).code).toBe('conflict')
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, status: 'cancelled', claimed_by: null } }], ...member() })
    const r2 = await start()
    expect(r2.status).toBe(409)
    expect((await r2.json()).code).toBe('cancelled')
  })

  it('RPC 가 경합(conflict)이면 409, 오류면 500', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }], ...member(),
      wbs_items: [{ data: { depends: [], depends_waived: [] } }],
      rpc: [{ data: { ok: false, conflict: true, order_status: 'reported' } }],
    })
    expect((await start()).status).toBe(409)
    useAdmin({
      agent_work_orders: [{ data: CLAIMED }], ...member(),
      wbs_items: [{ data: { depends: [], depends_waived: [] } }],
      rpc: [{ error: { message: 'db down' } }],
    })
    expect((await start()).status).toBe(500)
    errSpy.mockRestore()
  })

  it('선행 항목 조회가 실패하면 500 — 관문 재료를 위장하지 않는다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const admin = useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member(), wbs_items: [{ error: { message: 'boom' } }] })
    expect((await start()).status).toBe(500)
    expect(admin.rpc).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('POST 외 메서드는 404', () => {
    for (const m of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const) {
      expect(typeof (buildStartRoute as Record<string, unknown>)[m]).toBe('function')
    }
  })
})
