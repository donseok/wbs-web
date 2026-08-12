import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  resolveProjectId: vi.fn(),
  createAdminClient: vi.fn(),
  transitionStage: vi.fn(),
  ensureOrderForWorkflowLeaf: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: vi.fn(),
  resolveProjectId: mocks.resolveProjectId,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn() }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureOrderForWorkflowLeaf: mocks.ensureOrderForWorkflowLeaf }))
// setWbsDevWorkflow 는 transitionStage 만 쓰고 notifySuccessorsOnReached·REACHED_STAGES 는
// 쓰지 않으므로(그건 setWbsStage 소관) 이 파일에서는 모듈 전체를 목킹해도 안전하다.
vi.mock('@/lib/agent/stageTransition', () => ({ transitionStage: mocks.transitionStage }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setWbsDevWorkflow } from '@/app/actions/wbsAssign'

const P1 = '11111111-1111-4111-8111-111111111111'
const W1 = '33333333-3333-4333-8333-333333333333'
const W2 = '66666666-6666-4666-8666-666666666666'
const W6 = '88888888-8888-4888-8888-888888888880'
const M1 = '44444444-4444-4444-8444-444444444444'
const M2 = '55555555-5555-4555-8555-555555555555'

type Resp = { data?: unknown; error?: { message: string } | null }

/** 큐 기반 admin 목 — 테이블별 순차 응답 + insert/update payload 캡처 + 호출된 테이블 목록. */
function admin(queues: Record<string, Resp[]>) {
  const captured: Record<string, unknown[]> = {}
  const calls: string[] = []
  const client = {
    from: vi.fn((table: string) => {
      calls.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'order', 'limit']) b[k] = () => b
      b.eq = (col: string, val: unknown) => {
        (captured[`${table}.eq`] ??= []).push([col, val]); return b
      }
      b.in = (col: string, val: unknown) => {
        (captured[`${table}.in`] ??= []).push([col, val]); return b
      }
      b.neq = (col: string, val: unknown) => {
        (captured[`${table}.neq`] ??= []).push([col, val]); return b
      }
      b.update = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { captured, calls }
}

const ACTOR = { ok: true, actor: { userId: 'admin-1' } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue(ACTOR)
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
  mocks.transitionStage.mockResolvedValue({ ok: true, transitioned: true })
  mocks.ensureOrderForWorkflowLeaf.mockResolvedValue({ ok: true, created: true })
})

describe('setWbsDevWorkflow', () => {
  it('(d) 비관리자 거부, DB 접근 없음', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const { calls } = admin({})
    const r = await setWbsDevWorkflow(W1, true, false)
    expect(r).toEqual({ ok: false, error: '권한 없음' })
    expect(calls).toHaveLength(0)
  })

  // 트리: W1(root) → W2(자식 있음, 담당자 M2·stage null) → W6(리프, 담당자 M1·stage null)
  const TREE = [
    { id: W1, parent_id: null },
    { id: W2, parent_id: W1 },
    { id: W6, parent_id: W2 },
  ]

  it('(e) cascade=true ON — 서브트리 UPDATE·리프에만 transitionStage·ensureOrder 호출·count 집계', async () => {
    const { captured } = admin({
      wbs_items: [
        { data: TREE }, // 트리 read
        {
          data: [
            { id: W1, assignee_member_id: null, stage: null },
            { id: W2, assignee_member_id: M2, stage: null },
            { id: W6, assignee_member_id: M1, stage: null },
          ],
        }, // 일괄 UPDATE(dev_workflow=true, .neq 필터) 반환
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsDevWorkflow(W1, true, true)
    expect(r).toEqual({ ok: true, count: 3 })

    const [, idsArg] = captured['wbs_items.in'][0] as [string, string[]]
    expect(new Set(idsArg)).toEqual(new Set([W1, W2, W6]))
    expect(captured['wbs_items.neq'][0]).toEqual(['dev_workflow', true])
    expect(captured.wbs_items[0]).toMatchObject({ dev_workflow: true })

    // change_logs 는 루트 1건만
    expect(captured.change_logs).toHaveLength(1)
    expect(captured.change_logs[0]).toMatchObject({
      wbs_item_id: W1, field: 'dev_workflow', old_value: 'false', new_value: 'true',
    })

    // 리프(W6)만 담당자 있고 stage null → transitionStage 호출. W2 는 자식이 있어 제외.
    expect(mocks.transitionStage).toHaveBeenCalledTimes(1)
    expect(mocks.transitionStage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemId: W6, to: 'as', fromIn: [null], actorUserId: 'admin-1' }),
    )

    // ensureOrderForWorkflowLeaf 도 리프(W6)에만 호출.
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalledTimes(1)
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: P1, wbsItemId: W6, actorUserId: 'admin-1' }),
    )
  })

  it('(f) OFF — 갱신된 항목들의 ready 주문만 cancelled, claimed/reported는 불변', async () => {
    const { captured } = admin({
      wbs_items: [
        { data: TREE },
        {
          data: [
            { id: W1, assignee_member_id: null, stage: null },
            { id: W2, assignee_member_id: M2, stage: 'as' },
            { id: W6, assignee_member_id: M1, stage: 'as' },
          ],
        },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
      agent_work_orders: [{ data: [{ id: 'order-1' }] }],
    })
    const r = await setWbsDevWorkflow(W1, false, true)
    expect(r).toEqual({ ok: true, count: 3 })

    expect(captured.agent_work_orders).toHaveLength(1)
    expect(captured.agent_work_orders[0]).toMatchObject({ status: 'cancelled' })
    const [, cancelIds] = captured['agent_work_orders.in'][0] as [string, string[]]
    expect(new Set(cancelIds)).toEqual(new Set([W1, W2, W6]))
    expect(captured['agent_work_orders.eq']).toContainEqual(['status', 'ready'])

    // OFF 경로는 stage 자동전이·주문발행을 하지 않는다.
    expect(mocks.transitionStage).not.toHaveBeenCalled()
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
  })

  it('(g) 트리 조회 실패 시 ok:false·UPDATE 미호출', async () => {
    const { captured } = admin({
      wbs_items: [
        { data: null, error: { message: 'boom' } },
      ],
    })
    const r = await setWbsDevWorkflow(W1, true, true)
    expect(r.ok).toBe(false)
    expect(captured.wbs_items ?? []).toHaveLength(0)
    expect(mocks.transitionStage).not.toHaveBeenCalled()
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
  })

  it('cascade=false — 본인 1건만 UPDATE, change_logs 1건', async () => {
    const { captured, calls } = admin({
      wbs_items: [
        { data: [{ id: W1, assignee_member_id: M1, stage: null }] }, // 단건 UPDATE 반환
        { data: null }, // 자식 존재 확인(리프 판정) — 자식 없음
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsDevWorkflow(W1, true, false)
    expect(r).toEqual({ ok: true, count: 1 })
    expect(calls.filter(t => t === 'wbs_items')).toHaveLength(2) // UPDATE + 자식 확인
    expect(captured['wbs_items.eq']).toContainEqual(['id', W1])
    expect(captured['wbs_items.neq'][0]).toEqual(['dev_workflow', true])
    expect(mocks.transitionStage).toHaveBeenCalledTimes(1)
    expect(mocks.transitionStage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemId: W1, to: 'as', fromIn: [null] }),
    )
  })

  it('실제로 값이 바뀐 행이 없으면 count:0, change_logs·전이·주문 모두 없음', async () => {
    const { captured } = admin({
      wbs_items: [
        { data: [] }, // .neq 필터에 걸려 아무 것도 갱신되지 않음
        { data: null },
      ],
    })
    const r = await setWbsDevWorkflow(W1, true, false)
    expect(r).toEqual({ ok: true, count: 0 })
    expect(captured.change_logs ?? []).toHaveLength(0)
    expect(mocks.transitionStage).not.toHaveBeenCalled()
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
  })
})
