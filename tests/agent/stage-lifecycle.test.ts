import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * T5 — claim→ip, completion 보고→im, 승인→xx 배선. transitionStage(T2, 실물) 를 모킹하지 않고
 * admin 큐 모킹으로 실제 UPDATE 발생 여부를 확인한다(브리프 Step1(a) "모킹으로 확인"의 의미).
 * 레거시 시크릿 경로만 사용 — agent_runners 조회를 피해 큐를 단순하게 유지한다.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn().mockResolvedValue({ ok: true }),
  requireProjectAdmin: vi.fn(),
  updateActual: vi.fn(),
  applyAgentProgress: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: mocks.updateActual }))
vi.mock('@/lib/agent/applyProgress', () => ({ applyAgentProgress: mocks.applyAgentProgress }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { POST as reportPOST } from '@/app/api/v1/agent/work/[id]/report/route'
import { approveAgentCompletion, rejectAgentCompletion } from '@/app/actions/agentWork'

const SECRET = 'test-agent-secret'
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const DEP_ID = '44444444-4444-4444-8444-444444444444'
const DEP_REF = 'MES/TSK-01-00'
const USER = { id: 'u-1', email: 'dev@example.com', user_metadata: {} }

type Resp = { data?: unknown; error?: { message: string } | null }
type Captured = { op: 'update' | 'insert'; payload: unknown }

function useAdmin(queues: Record<string, Resp[]>, users = [USER]) {
  const captured: Record<string, Captured[]> = {}
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'delete', 'eq', 'in', 'order', 'limit', 'contains']) b[k] = () => b
      b.update = (payload: unknown) => { (captured[table] ??= []).push({ op: 'update', payload }); return b }
      b.insert = (payload: unknown) => { (captured[table] ??= []).push({ op: 'insert', payload }); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { listUsers: vi.fn(async () => ({ data: { users }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, captured }
}

const post = (url: string, body: unknown) => new NextRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
  body: JSON.stringify(body),
})
const ctx = { params: Promise.resolve({ id: O1 }) }

// dev_workflow=true, stage='as' — claim 의 fromIn(['as','fp',null]) 통과 케이스
const ITEM_ROW = (overrides: Record<string, unknown> = {}) => ({
  id: W1, code: 'C1', name: '항목1', external_ref: null, stage: 'as', category: null, domain: null,
  priority: null, model: null, tags: null, depends: [], prd_ref: null, entry_point: null,
  acceptance: [], spec: null, assignee_member_id: null, planned_start: null, planned_end: null,
  ...overrides,
})
// transitionStage 자체 조회가 쓰는 축약 행
const STAGE_ROW = (overrides: Record<string, unknown> = {}) => ({
  id: W1, project_id: P1, name: '항목1', external_ref: null, stage: 'as', dev_workflow: true,
  ...overrides,
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
  mocks.applyAgentProgress.mockResolvedValue({ ok: true, projectId: P1 })
})

describe('claim → stage ip 전이', () => {
  const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: W1 }

  it('claim 성공 → transitionStage 가 wbs_items.stage 를 ip 로 갱신한다', async () => {
    const { captured } = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }], // 로드, CAS
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [
        { data: ITEM_ROW() },                 // 배정·선행 게이트용 항목 상세
        { data: STAGE_ROW({ stage: 'as' }) },  // transitionStage 자체 조회
        { data: [{ id: W1 }] },                // transitionStage UPDATE.select('id')
      ],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { user_email: USER.email, agent: 'claude-cli' }), ctx)
    expect(res.status).toBe(200)
    const update = captured.wbs_items?.find((c) => c.op === 'update')
    expect(update?.payload).toMatchObject({ stage: 'ip' })
  })

  it('dev_workflow=false 항목은 claim 이 성공해도 stage UPDATE 가 일어나지 않는다(내부 게이트)', async () => {
    const { captured } = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [
        { data: ITEM_ROW() },
        { data: STAGE_ROW({ dev_workflow: false }) }, // 게이트에 걸려 조기 반환 — UPDATE 없음
      ],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { user_email: USER.email, agent: 'claude-cli' }), ctx)
    expect(res.status).toBe(200)
    expect((captured.wbs_items ?? []).filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('선행 미충족(403) 이면 CAS·전이 모두 시도되지 않는다', async () => {
    const DEP_ITEM = ITEM_ROW({ depends: [DEP_REF] })
    const { admin } = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }], // 로드, 선행의 approved 주문 없음
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [
        { data: DEP_ITEM },
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'ip' }] }, // 선행이 아직 ip — 미충족
      ],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { user_email: USER.email, agent: 'claude-cli' }), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('dependency_not_met')
    // wbs_items 호출은 항목 상세 + 선행 조회 2회뿐이어야 한다 — 3번째(transitionStage 자체 조회)가 없다.
    expect(admin.from.mock.calls.filter((c) => c[0] === 'wbs_items')).toHaveLength(2)
  })

  it('전이 UPDATE 가 실패해도 claim 응답은 200 유지된다(로깅만)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [
        { data: ITEM_ROW() },
        { data: STAGE_ROW({ stage: 'as' }) },
        { data: null, error: { message: 'db down' } }, // transitionStage UPDATE 실패
      ],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { user_email: USER.email, agent: 'claude-cli' }), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('claimed')
    errSpy.mockRestore()
  })
})

describe('completion 보고 → stage im 전이', () => {
  const CLAIMED = {
    id: O1, project_id: P1, status: 'claimed', claimed_by: 'cli-1', claimed_by_user_id: null, wbs_item_id: W1,
  }
  const reportBody = (kind: 'progress' | 'completion', percent: number) => ({
    user_email: USER.email, agent: 'cli-1', kind, percent, summary: '요약',
    links: [{ url: 'https://github.com/x/pr/1' }],
  })

  it('completion 성공 → transitionStage 가 wbs_items.stage 를 im 으로 갱신한다', async () => {
    const { captured } = useAdmin({
      agent_work_orders: [{ data: CLAIMED }, { data: [{ id: O1 }] }], // 로드, CAS→reported
      agent_work_reports: [{ data: [{ id: 'r1' }] }],                  // 보고 insert
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }, { data: [] }],   // 멤버십, 관리자 목록(알림)
      wbs_items: [
        { data: { name: '항목1' } },                                  // 알림용 이름 조회
        { data: STAGE_ROW({ stage: 'ip' }) },                          // transitionStage 자체 조회
        { data: [{ id: W1 }] },                                        // transitionStage UPDATE
      ],
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, reportBody('completion', 100)), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('reported')
    const update = captured.wbs_items?.find((c) => c.op === 'update')
    expect(update?.payload).toMatchObject({ stage: 'im' })
  })

  it('progress 보고는 stage 전이를 시도하지 않는다', async () => {
    const { captured } = useAdmin({
      agent_work_orders: [{ data: CLAIMED }, { data: [{ id: O1 }] }], // 로드, updated_at 갱신
      agent_work_reports: [{ data: [{ id: 'r1' }] }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, reportBody('progress', 40)), ctx)
    expect(res.status).toBe(200)
    expect(captured.wbs_items).toBeUndefined()
  })
})

describe('승인/반려 → stage xx 전이', () => {
  const ORDER = { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 }
  const ACTOR = { ok: true, actor: { userId: 'admin-1' } }

  beforeEach(() => {
    mocks.requireProjectAdmin.mockResolvedValue(ACTOR)
    mocks.updateActual.mockResolvedValue({ ok: true })
  })

  it('승인 성공 → transitionStage 가 wbs_items.stage 를 xx 로 갱신한다', async () => {
    const { captured } = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],           // 조회, CAS→approved
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }], // 최신 completion, review 기록
      wbs_items: [
        { data: { name: '항목1', assignee_member_id: null, stage: 'im', external_ref: null } }, // 알림용 조회(배정자 없음)
        { data: STAGE_ROW({ stage: 'im' }) },                                                    // transitionStage 자체 조회
        { data: [{ id: W1 }] },                                                                  // transitionStage UPDATE
      ],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    const update = captured.wbs_items?.find((c) => c.op === 'update')
    expect(update?.payload).toMatchObject({ stage: 'xx' })
  })

  it('반려는 stage 전이를 시도하지 않는다(im 유지)', async () => {
    const { captured } = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
      wbs_items: [
        { data: { name: '항목1', assignee_member_id: null, stage: 'im', external_ref: null } },
      ],
    })
    const r = await rejectAgentCompletion(O1, '보완 필요')
    expect(r.ok).toBe(true)
    expect((captured.wbs_items ?? []).filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('전이 실패해도 승인 액션 결과는 성공 유지된다(로깅만)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
      wbs_items: [
        { data: { name: '항목1', assignee_member_id: null, stage: 'im', external_ref: null } },
        { data: null, error: { message: '항목 없음' } }, // transitionStage 자체 조회 실패
      ],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    errSpy.mockRestore()
  })
})
