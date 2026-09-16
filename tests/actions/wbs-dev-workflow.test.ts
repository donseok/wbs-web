import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  resolveProjectId: vi.fn(),
  createAdminClient: vi.fn(),
  applyWorkflowEvent: vi.fn(),
  ensureOrderForWorkflowLeaf: vi.fn(),
  viewerEmail: vi.fn(),
  myMemberIds: vi.fn(),
  isSubtreeManager: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: mocks.requireProjectMember,
  resolveProjectId: mocks.resolveProjectId,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// setWbsDevWorkflow 는 setWbsStage 와 같은 requireSubtreeManagerOrAdmin(실제 모듈)로 판정한다 —
// 그 내부가 부르는 viewerEmail·myMemberIds·isSubtreeManager 만 목킹한다(wbs-assign.test.ts 와 동일 패턴).
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: mocks.viewerEmail }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: mocks.myMemberIds, isSubtreeManager: mocks.isSubtreeManager }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn() }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureOrderForWorkflowLeaf: mocks.ensureOrderForWorkflowLeaf }))
// setWbsDevWorkflow 는 전이 RPC 래퍼(applyWorkflowEvent)만 쓰고 도달 알림은 쓰지 않으므로(assign 사건은
// im·xx 에 닿지 않는다) 이 파일에서는 모듈 전체를 목킹해도 안전하다.
vi.mock('@/lib/agent/workflowEvent', () => ({ applyWorkflowEvent: mocks.applyWorkflowEvent, notifyOnReached: vi.fn() }))
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
const MEMBER = { ok: true, actor: { userId: 'member-1' } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue(ACTOR)
  mocks.requireProjectMember.mockResolvedValue(MEMBER)
  // 서브트리 관리자 경로 기본값 — 안전한 쪽("아니다")으로 두고 개별 테스트가 override 한다.
  mocks.viewerEmail.mockResolvedValue('member@example.com')
  mocks.myMemberIds.mockResolvedValue([])
  mocks.isSubtreeManager.mockResolvedValue(false)
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
  mocks.applyWorkflowEvent.mockResolvedValue({ ok: true, orderStatus: null, stage: 'as', actualPct: 0, stageChanged: true, actualChanged: false, reachedFirst: false, skipped: null })
  mocks.ensureOrderForWorkflowLeaf.mockResolvedValue({ ok: true, created: true })
})

describe('setWbsDevWorkflow', () => {
  it('(d) 관리자도 서브트리 관리자도 아니면 거부, DB 접근 없음', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    mocks.isSubtreeManager.mockResolvedValue(false)
    const { calls } = admin({})
    const r = await setWbsDevWorkflow(W1, true, false)
    expect(r).toEqual({ ok: false, error: '관리자 또는 서브트리 관리자만 할 수 있습니다.' })
    expect(calls).toHaveLength(0)
  })

  it('프로젝트 멤버가 아니면 거부 — 서브트리 조회까지 가지 않는다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
    const { calls } = admin({})
    expect(await setWbsDevWorkflow(W1, true, false)).toEqual({ ok: false, error: '멤버 아님' })
    expect(calls).toHaveLength(0)
  })

  // 트리: W1(root) → W2(자식 있음, 담당자 M2·stage null)
  //         → W6(리프, 담당자 M1·stage null — assign 전이 대상)
  //         → W7(리프, 담당자 없음·stage null — ensureOrder 는 호출하되 assign 전이 는 스킵:
  //              §2.8 재정의, 주문은 배정과 무관)
  //         → W8(리프, 담당자 M1·stage 'ip' — stage 가 이미 NULL 이 아니므로 assign 전이 스킵)
  const W7 = '99999999-9999-4999-8999-999999999991'
  const W8 = '22222222-2222-4222-8222-222222222229'
  const TREE = [
    { id: W1, parent_id: null },
    { id: W2, parent_id: W1 },
    { id: W6, parent_id: W2 },
    { id: W7, parent_id: W2 },
    { id: W8, parent_id: W2 },
  ]

  it('(e) cascade=true ON — 서브트리 UPDATE·리프에만 assign 전이·ensureOrder 호출·count 집계', async () => {
    const { captured } = admin({
      wbs_items: [
        { data: TREE }, // 트리 read
        {
          data: [
            { id: W1, assignee_member_id: null, stage: null },
            { id: W2, assignee_member_id: M2, stage: null },
            { id: W6, assignee_member_id: M1, stage: null },
            { id: W7, assignee_member_id: null, stage: null },
            { id: W8, assignee_member_id: M1, stage: 'ip' },
          ],
        }, // 일괄 UPDATE(dev_workflow=true, .neq 필터) 반환
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsDevWorkflow(W1, true, true)
    expect(r).toEqual({ ok: true, count: 5 })

    const [, idsArg] = captured['wbs_items.in'][0] as [string, string[]]
    expect(new Set(idsArg)).toEqual(new Set([W1, W2, W6, W7, W8]))
    expect(captured['wbs_items.neq'][0]).toEqual(['dev_workflow', true])
    expect(captured.wbs_items[0]).toMatchObject({ dev_workflow: true })

    // change_logs 는 루트 1건만
    expect(captured.change_logs).toHaveLength(1)
    expect(captured.change_logs[0]).toMatchObject({
      wbs_item_id: W1, field: 'dev_workflow', old_value: 'false', new_value: 'true',
    })

    // assign 전이 는 "담당자 있고 stage NULL"인 리프(W6)에만 — W2는 자식이 있어 제외,
    // W7은 담당자가 없어 제외(§2.8 재정의: 주문은 배정과 무관하지만 stage 전이는 배정이 있어야
    // 한다), W8은 이미 stage가 있어 제외.
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(
      expect.anything(),
      { event: 'assign', actorUserId: 'admin-1', itemId: W6 },
    )

    // ensureOrderForWorkflowLeaf 는 담당자·stage 와 무관하게 모든 리프(W6·W7·W8)에 호출된다
    // (§2.8 재정의 — "dev_workflow ON 인 리프에는 주문이 존재한다. 배정은 조건이 아니다").
    // assign 전이 가드(assignee && stage===null) 안쪽으로 잘못 옮기면 이 단언이 깨진다.
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalledTimes(3)
    for (const id of [W6, W7, W8]) {
      expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ projectId: P1, wbsItemId: id, actorUserId: 'admin-1' }),
      )
    }
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
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
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
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
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
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'assign', itemId: W1 }),
    )
  })

  it('cascade=false — 리프 판정 조회 실패 시 fail-closed: assign 전이·ensureOrder 모두 스킵(로깅만)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    admin({
      wbs_items: [
        { data: [{ id: W1, assignee_member_id: M1, stage: null }] }, // 단건 UPDATE 반환(성공)
        { data: null, error: { message: 'boom' } }, // 자식 존재 확인 자체가 실패
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsDevWorkflow(W1, true, false)
    // 본 토글(dev_workflow UPDATE)은 이미 커밋됐으므로 ok:true·count:1 은 정직하게 유지 —
    // 다만 리프 여부를 모르니 as 전이·주문 발행 같은 후속 쓰기는 강행하지 않는다(3원칙 ②).
    expect(r).toEqual({ ok: true, count: 1 })
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
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
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
  })

  // ── 담당자·서브트리 관리자 개방(2026-09-16) ───────────────────────────────────────
  // 가드가 requireProjectAdmin 에서 requireSubtreeManagerOrAdmin 으로 내려왔다. 단건 토글은
  // 담당자·서브트리 관리자도 하고, 프로젝트 범위 부작용을 끌고 오는 일괄(cascade)은 관리자만 한다.

  it('서브트리 관리자(비관리자)의 단건 ON 통과 — 관리자와 같은 경로를 탄다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    mocks.isSubtreeManager.mockResolvedValue(true)
    const { captured } = admin({
      wbs_items: [
        { data: [{ id: W1, assignee_member_id: M1, stage: null }] }, // 단건 UPDATE 반환
        { data: null }, // 자식 존재 확인 — 리프
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    expect(await setWbsDevWorkflow(W1, true, false)).toEqual({ ok: true, count: 1 })
    expect(captured.wbs_items[0]).toMatchObject({ dev_workflow: true })
    // 이력·전이의 행위자는 관리자가 아니라 그 멤버다.
    expect(captured.change_logs[0]).toMatchObject({ user_id: 'member-1', field: 'dev_workflow' })
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'assign', actorUserId: 'member-1', itemId: W1 }),
    )
  })

  it('비관리자의 cascade=true 는 거부 — DB 접근 없음', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    mocks.isSubtreeManager.mockResolvedValue(true)
    const { calls } = admin({})
    expect(await setWbsDevWorkflow(W1, true, true)).toEqual({
      ok: false, error: '하위 일괄 적용은 프로젝트 관리자만 할 수 있습니다.',
    })
    expect(calls).toHaveLength(0)
  })

  // ── 위임된 항목의 OFF 차단 ────────────────────────────────────────────────────────
  // 위임 ON 은 개발 워크플로 ON 을 함의한다(delegation.ts) — 그 상태에서 워크플로만 끄면
  // 모순된 행이 남는다. 관리자에게도 같이 적용한다.

  it('OFF: 위임된 항목은 거부 — UPDATE 하지 않는다', async () => {
    const { captured } = admin({
      wbs_items: [{ data: { tags: ['agent'] } }], // 위임 확인 조회
    })
    expect(await setWbsDevWorkflow(W1, false, false)).toEqual({
      ok: false, error: '에이전트에 위임된 작업입니다. 위임을 먼저 끄십시오.',
    })
    expect(captured.wbs_items ?? []).toHaveLength(0)
  })

  it('OFF: 위임 태그가 없으면 그대로 통과한다', async () => {
    const { captured } = admin({
      wbs_items: [
        { data: { tags: ['x'] } }, // 위임 확인 조회
        { data: [{ id: W1, assignee_member_id: M1, stage: 'as' }] }, // 단건 UPDATE
        { data: null }, // 자식 존재 확인
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
      agent_work_orders: [{ data: [{ id: 'order-1' }] }],
    })
    expect(await setWbsDevWorkflow(W1, false, false)).toEqual({ ok: true, count: 1 })
    expect(captured.wbs_items[0]).toMatchObject({ dev_workflow: false })
  })

  it('OFF: 위임 확인 조회가 실패하면 중단한다(3원칙 ② — 모르면 쓰지 않는다)', async () => {
    const { captured } = admin({
      wbs_items: [{ data: null, error: { message: 'boom' } }],
    })
    const r = await setWbsDevWorkflow(W1, false, false)
    expect(r.ok).toBe(false)
    expect(captured.wbs_items ?? []).toHaveLength(0)
  })

  it('ON: 위임 태그가 있어도 확인 조회 없이 통과한다(ON 은 모순을 만들지 않는다)', async () => {
    const { calls } = admin({
      wbs_items: [
        { data: [{ id: W1, assignee_member_id: M1, stage: null }] },
        { data: null },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    expect(await setWbsDevWorkflow(W1, true, false)).toEqual({ ok: true, count: 1 })
    expect(calls.filter(t => t === 'wbs_items')).toHaveLength(2) // UPDATE + 자식 확인뿐
  })

  it('OFF cascade: 서브트리에 위임된 항목이 있으면 거부 — UPDATE 하지 않는다', async () => {
    const { captured } = admin({
      wbs_items: [
        { data: [
          { id: W1, parent_id: null, tags: [] },
          { id: W2, parent_id: W1, tags: ['agent'] },
          { id: W6, parent_id: W2, tags: ['agent'] },
        ] },
      ],
    })
    expect(await setWbsDevWorkflow(W1, false, true)).toEqual({
      ok: false, error: '하위에 에이전트 위임 작업이 2건 있습니다. 위임을 먼저 끄십시오.',
    })
    expect(captured.wbs_items ?? []).toHaveLength(0)
  })

})
