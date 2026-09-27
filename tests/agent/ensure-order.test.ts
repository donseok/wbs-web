import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'

vi.mock('@/lib/notify/emit', () => ({
  emitNotification: vi.fn().mockResolvedValue(undefined),
}))

/**
 * Mock AdminClient 큐 체이닝 기반 테스트.
 * select(...).from(...) 호출 시 큐에 저장되고,
 * maybeSingle()/single() 호출 시 큐의 첫 번째 응답을 반환.
 */
class MockAdminClient {
  private queue: Array<{
    data: unknown
    error: null | { message: string; code?: string }
  }> = []

  lastInsertPayload: Record<string, unknown> | null = null

  from() {
    return this
  }

  select() {
    return this
  }

  eq() {
    return this
  }

  in() {
    return this
  }

  is() {
    return this
  }

  limit() {
    return this
  }

  insert(payload: Record<string, unknown>) {
    this.lastInsertPayload = payload
    return this
  }

  single() {
    const response = this.queue.shift()
    if (!response) {
      return { data: { id: 'mock-order-' + Math.random() }, error: null }
    }
    return response
  }

  async maybeSingle() {
    const response = this.queue.shift()
    return response || { data: null, error: null }
  }

  // 테스트에서 큐 조작용
  pushResponse(data: unknown, error: null | { message: string; code?: string } = null) {
    this.queue.push({ data, error })
    return this
  }
}

describe('ensureOrderForWorkflowLeaf', () => {
  let admin: AdminClient | MockAdminClient
  const projectId = 'project-1'
  const wbsItemId = 'item-1'
  const actorUserId = 'admin-1'

  beforeEach(() => {
    admin = new MockAdminClient()
    vi.clearAllMocks()
  })

  it('agent_projects 미등록 → created:false, reason not_agent_project (에러 아님 — 게이트 유지)', async () => {
    // 큐: agent_projects [{ data: null }]
    ;(admin as MockAdminClient).pushResponse(null, null)

    const result = await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'not_agent_project' })
  })

  it('항목 없음(row null) → ok:false (3원칙 — "미도입"으로 위장하지 않는다, F3)', async () => {
    // 큐: agent_projects [{ enabled: true }] → wbs_items [null]
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(null, null)

    const result = await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: false, error: '항목 없음' })
    expect((admin as MockAdminClient).lastInsertPayload).toBeNull()
  })

  it('dev_workflow=false → created:false, reason not_workflow (주문 insert 미호출)', async () => {
    // 큐: agent_projects [{ enabled: true }] → wbs_items [{ dev_workflow: false }]
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(
      { name: 'Test Item', priority: 'high', external_ref: 'REF-123', assignee_member_id: null, dev_workflow: false },
      null
    )

    const result = await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'not_workflow' })
    expect((admin as MockAdminClient).lastInsertPayload).toBeNull()
  })

  it('자식 있는 항목(dev_workflow=true) → created:false, reason not_leaf', async () => {
    // 큐: agent_projects [{ enabled: true }] → wbs_items [{ dev_workflow: true }] → wbs_items(자식) [{ id: 'child' }]
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(
      { name: 'Test Item', priority: 'high', external_ref: 'REF-123', assignee_member_id: null, dev_workflow: true },
      null
    )
    ;(admin as MockAdminClient).pushResponse({ id: 'child' }, null)

    const result = await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'not_leaf' })
  })

  it('활성 주문 존재 → created:false, reason active_exists (no-op 멱등)', async () => {
    // 큐: agent_projects [{ enabled: true }] → wbs_items [{ dev_workflow: true }] → wbs_items(자식) [null] → agent_work_orders [{ id: 'o-1' }]
    // 리뷰 수정 1회차 — active_exists(Step4) 가 progressed(D26) 보다 먼저이므로 approved 조회는 여기 안 온다.
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(
      { name: 'Test Item', priority: 'high', external_ref: 'REF-123', assignee_member_id: null, dev_workflow: true },
      null
    )
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse({ id: 'o-1' }, null)

    const result = await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'active_exists' })
  })

  it('조건 충족(dev_workflow=true, 배정 있음) → insert, created:true, payload 검증 + 알림 발행', async () => {
    // 큐: agent_projects [{ enabled: true }] → wbs_items [item] → wbs_items(자식) [null] →
    // agent_work_orders(활성, 리뷰 수정 1회차로 순서가 approved 보다 먼저) [null] → agent_work_orders(D26 approved) [null] → insert [{ id: 'order-1' }]
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(
      {
        name: 'Test Item',
        priority: 'high',
        external_ref: 'REF-123',
        assignee_member_id: 'member-1',
        dev_workflow: true,
      },
      null
    )
    ;(admin as MockAdminClient).pushResponse(null, null) // 자식 없음(리프)
    ;(admin as MockAdminClient).pushResponse(null, null) // 활성 주문 없음
    ;(admin as MockAdminClient).pushResponse(null, null) // D26 — approved 조회(없음)
    ;(admin as MockAdminClient).pushResponse({ id: 'order-1' }, null)

    const result = await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: true })

    // Insert payload 검증
    const payload = (admin as MockAdminClient).lastInsertPayload
    expect(payload).toMatchObject({
      project_id: projectId,
      wbs_item_id: wbsItemId,
      instructions: 'REF-123 Test Item',
      priority: 50, // high = 50
      created_by: actorUserId,
    })

    // 알림 발행 검증
    const { emitNotification } = await import('@/lib/notify/emit')
    expect(emitNotification).toHaveBeenCalledOnce()
    expect(emitNotification).toHaveBeenCalledWith({
      type: 'work.order_created',
      projectId,
      entityType: 'agent_order',
      entityId: 'order-1',
      payload: {
        title: 'Test Item',
        detail: '작업 주문이 발행되었습니다',
        href: `/p/${projectId}/wbs`,
      },
      recipientMemberIds: ['member-1'],
      dedupeKey: `order_created:${wbsItemId}:order-1`,
    })
  })

  it('dev_workflow=true, 배정 없음(assignee null) → 주문은 생성되나 알림은 발행 안 됨(수신자 없음)', async () => {
    // 큐: agent_projects [{ enabled: true }] → wbs_items [item, assignee null] → wbs_items(자식) [null] → agent_work_orders [null] → insert [{ id: 'order-2' }]
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(
      {
        name: 'Test Item',
        priority: 'medium',
        external_ref: 'REF-456',
        assignee_member_id: null,
        dev_workflow: true,
      },
      null
    )
    ;(admin as MockAdminClient).pushResponse(null, null) // 자식 없음(리프)
    ;(admin as MockAdminClient).pushResponse(null, null) // 활성 주문 없음
    ;(admin as MockAdminClient).pushResponse(null, null) // D26 — approved 조회(없음)
    ;(admin as MockAdminClient).pushResponse({ id: 'order-2' }, null)

    const result = await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: true })

    const { emitNotification } = await import('@/lib/notify/emit')
    expect(emitNotification).not.toHaveBeenCalled()
  })

  it('경합 unique violation(23505) → created:false 수렴(멱등 — 에러 아님, 알림 미발행)', async () => {
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(
      {
        name: 'Test Item',
        priority: 'high',
        external_ref: 'REF-123',
        assignee_member_id: 'member-1',
        dev_workflow: true,
      },
      null
    )
    ;(admin as MockAdminClient).pushResponse(null, null) // 자식 없음(리프)
    ;(admin as MockAdminClient).pushResponse(null, null) // 활성 주문 없음
    ;(admin as MockAdminClient).pushResponse(null, null) // D26 — approved 조회(없음)
    ;(admin as MockAdminClient).pushResponse(
      null,
      { message: 'duplicate key value', code: '23505' }
    )

    const result = await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'active_exists' })

    // 알림이 발행되지 않아야 함
    const { emitNotification } = await import('@/lib/notify/emit')
    expect(emitNotification).not.toHaveBeenCalled()
  })

  it('선행조회(agent_projects) 실패 → ok:false (3원칙 — 위장 금지)', async () => {
    // 큐: agent_projects 에러
    ;(admin as MockAdminClient).pushResponse(null, { message: 'db down' })

    const result = await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: false, error: expect.stringContaining('등록 조회 실패') })
  })

  it('항목 조회 실패 → ok:false (3원칙 — 위장 금지)', async () => {
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(null, { message: 'item lookup down' })

    const result = await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: false, error: expect.stringContaining('항목 조회 실패') })
  })

  it('게이트 미통과(not_agent_project) 시 알림 미발행', async () => {
    // agent_projects 미등록
    ;(admin as MockAdminClient).pushResponse(null, null)

    await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    const { emitNotification } = await import('@/lib/notify/emit')
    expect(emitNotification).not.toHaveBeenCalled()
  })

  it('게이트 미통과(not_workflow) 시 알림 미발행', async () => {
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(
      { name: 'Test Item', priority: 'high', external_ref: 'REF-123', assignee_member_id: 'member-1', dev_workflow: false },
      null
    )

    await ensureOrderForWorkflowLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    const { emitNotification } = await import('@/lib/notify/emit')
    expect(emitNotification).not.toHaveBeenCalled()
  })

  describe('D26 — 이미 진행된 항목에는 주문을 만들지 않는다', () => {
    // 리뷰 수정 1회차 — 조회 순서를 not_leaf → active_exists → progressed(단계·실적, 그다음 approved) 로
    // 바꿨다(컨트롤러 판정). 그래서 progressed 로 끝나는 케이스도 이제 자식 없음·활성 주문 없음 두 조회를
    // 먼저 거친다.
    it.each([
      ['단계 ip', { stage: 'ip', actual_pct: 30 }],
      ['단계 xx', { stage: 'xx', actual_pct: 100 }],
      ['실적 100', { stage: 'as', actual_pct: 100 }],
    ])('%s 면 progressed', async (_n, extra) => {
      const admin = new MockAdminClient()
      admin.pushResponse({ enabled: true }, null)
      admin.pushResponse(
        { name: 't', priority: null, external_ref: null, assignee_member_id: null, dev_workflow: true, ...extra },
        null
      )
      admin.pushResponse(null, null) // 자식 없음(리프)
      admin.pushResponse(null, null) // 활성 주문 없음
      const r = await ensureOrderForWorkflowLeaf(admin as unknown as AdminClient, { projectId: 'p', wbsItemId: 'w', actorUserId: 'u' })
      expect(r).toEqual({ ok: true, created: false, reason: 'progressed' })
      expect(admin.lastInsertPayload).toBeNull()
    })

    it('approved 주문이 있으면 progressed', async () => {
      const admin = new MockAdminClient()
      admin.pushResponse({ enabled: true }, null)
      admin.pushResponse(
        { name: 't', priority: null, external_ref: null, assignee_member_id: null, dev_workflow: true, stage: 'im', actual_pct: 80 },
        null
      )
      admin.pushResponse(null, null) // 하위 없음
      admin.pushResponse(null, null) // 활성 주문 없음(리뷰 수정 1회차 추가) — stage:'im' 이 이 뒤 단계 검사에서
      // 걸려 아래 approved 큐는 이번에도 소비되지 않는다(자기 검토·approved 분기 단독 검증은 아래 테스트가 한다).
      admin.pushResponse({ id: 'o-old' }, null) // approved 주문 있음(소비되지 않음)
      const r = await ensureOrderForWorkflowLeaf(admin as unknown as AdminClient, { projectId: 'p', wbsItemId: 'w', actorUserId: 'u' })
      expect(r).toEqual({ ok: true, created: false, reason: 'progressed' })
    })

    // 위 'approved 주문이 있으면 progressed' 는 stage:'im' 을 쓰는데, 'im' 은 이미 앞선 단계 검사(stage
    // ip/im/xx) 에서 progressed 를 돌려주므로 실제로는 approved 조회 분기를 타지 않는다(자기 검토에서
    // 발견 — 큐에 넣어 둔 하위·활성·approved 응답 중 마지막은 소비되지 않는다). approved 조회 분기 자체를
    // 단독으로 태우려면 단계·실적이 '진행 전'인 항목이 필요하다.
    it('단계·실적은 진행 전이어도 approved 주문이 있으면 progressed(approved 분기 단독 검증)', async () => {
      const admin = new MockAdminClient()
      admin.pushResponse({ enabled: true }, null)
      admin.pushResponse(
        { name: 't', priority: null, external_ref: null, assignee_member_id: null, dev_workflow: true, stage: 'as', actual_pct: 50 },
        null
      )
      admin.pushResponse(null, null) // 하위 없음(리프)
      admin.pushResponse(null, null) // 활성 주문 없음(리뷰 수정 1회차 추가 — active_exists 가 먼저 온다)
      admin.pushResponse({ id: 'o-old' }, null) // approved 주문 있음
      const r = await ensureOrderForWorkflowLeaf(admin as unknown as AdminClient, { projectId: 'p', wbsItemId: 'w', actorUserId: 'u' })
      expect(r).toEqual({ ok: true, created: false, reason: 'progressed' })
    })

    // 리뷰 수정 1회차 — 순서(A): not_leaf 가 progressed 보다 먼저다. 진행됐다가 나중에 하위가 붙은 항목이
    // wbsImport.ts 의 non_leaf_skipped 리포트(reason==='not_leaf' 만 봄)에서 조용히 빠지던 결함을 고정한다.
    it('단계 ip 이상이어도 리프가 아니면 not_leaf(순서 A)', async () => {
      const admin = new MockAdminClient()
      admin.pushResponse({ enabled: true }, null)
      admin.pushResponse(
        { name: 't', priority: null, external_ref: null, assignee_member_id: null, dev_workflow: true, stage: 'ip', actual_pct: 30 },
        null
      )
      admin.pushResponse({ id: 'child-x' }, null) // 자식 있음 — 리프 아님
      const r = await ensureOrderForWorkflowLeaf(admin as unknown as AdminClient, { projectId: 'p', wbsItemId: 'w', actorUserId: 'u' })
      expect(r).toEqual({ ok: true, created: false, reason: 'not_leaf' })
    })

    // 리뷰 수정 1회차 — 순서(B): active_exists 가 progressed 보다 먼저다. 이미 위임된 진행 중 항목(활성
    // claimed 주문·단계 ip 이상)에 applyDelegation 이 다시 불려도 예전처럼 무음 no-op 이어야지, "단계를
    // 되돌리거나 재작업을 쓰라"는 엉뚱한 경고가 뜨면 안 된다.
    it('단계 ip 이상이어도 활성 주문이 있으면 active_exists(순서 B)', async () => {
      const admin = new MockAdminClient()
      admin.pushResponse({ enabled: true }, null)
      admin.pushResponse(
        { name: 't', priority: null, external_ref: null, assignee_member_id: null, dev_workflow: true, stage: 'ip', actual_pct: 30 },
        null
      )
      admin.pushResponse(null, null) // 자식 없음(리프)
      admin.pushResponse({ id: 'o-active' }, null) // 활성(claimed 등) 주문 있음
      const r = await ensureOrderForWorkflowLeaf(admin as unknown as AdminClient, { projectId: 'p', wbsItemId: 'w', actorUserId: 'u' })
      expect(r).toEqual({ ok: true, created: false, reason: 'active_exists' })
    })

    // 경계 — 실적 99 는 100 미만이라 progressed 가 아니다. 계속 진행해 주문을 만든다.
    it('실적 99 는 progressed 가 아니다 — 계속 진행해 주문을 만든다', async () => {
      const admin = new MockAdminClient()
      admin.pushResponse({ enabled: true }, null)
      admin.pushResponse(
        { name: 't', priority: null, external_ref: null, assignee_member_id: null, dev_workflow: true, stage: 'as', actual_pct: 99 },
        null
      )
      admin.pushResponse(null, null) // 자식 없음(리프)
      admin.pushResponse(null, null) // 활성 주문 없음
      admin.pushResponse(null, null) // approved 없음
      admin.pushResponse({ id: 'order-99' }, null) // insert
      const r = await ensureOrderForWorkflowLeaf(admin as unknown as AdminClient, { projectId: 'p', wbsItemId: 'w', actorUserId: 'u' })
      expect(r).toEqual({ ok: true, created: true })
    })

    // 경계 — 단계 dd 는 PROGRESSED 집합(ip/im/xx) 밖이라 progressed 가 아니다. 계속 진행해 주문을 만든다.
    it('단계 dd 는 progressed 가 아니다 — 계속 진행해 주문을 만든다', async () => {
      const admin = new MockAdminClient()
      admin.pushResponse({ enabled: true }, null)
      admin.pushResponse(
        { name: 't', priority: null, external_ref: null, assignee_member_id: null, dev_workflow: true, stage: 'dd', actual_pct: 20 },
        null
      )
      admin.pushResponse(null, null) // 자식 없음(리프)
      admin.pushResponse(null, null) // 활성 주문 없음
      admin.pushResponse(null, null) // approved 없음
      admin.pushResponse({ id: 'order-dd' }, null) // insert
      const r = await ensureOrderForWorkflowLeaf(admin as unknown as AdminClient, { projectId: 'p', wbsItemId: 'w', actorUserId: 'u' })
      expect(r).toEqual({ ok: true, created: true })
    })

    // 경계 — reported 상태 주문은 approved 가 아니다. 하지만 활성 주문 확인(Step4) 의 in(['ready','claimed',
    // 'reported']) 에 이미 걸리므로 progressed 조회까지 가지 않고 active_exists 로 끝난다 — progressed 로
    // 오판되지 않는다는 것만 확인한다.
    it('reported 상태 주문만 있으면 progressed 가 아니다(active_exists 로 걸린다)', async () => {
      const admin = new MockAdminClient()
      admin.pushResponse({ enabled: true }, null)
      admin.pushResponse(
        { name: 't', priority: null, external_ref: null, assignee_member_id: null, dev_workflow: true, stage: 'as', actual_pct: 40 },
        null
      )
      admin.pushResponse(null, null) // 자식 없음(리프)
      admin.pushResponse({ id: 'o-reported' }, null) // status='reported' 주문
      const r = await ensureOrderForWorkflowLeaf(admin as unknown as AdminClient, { projectId: 'p', wbsItemId: 'w', actorUserId: 'u' })
      expect(r).toEqual({ ok: true, created: false, reason: 'active_exists' })
      expect(r).not.toMatchObject({ reason: 'progressed' })
    })

    // 새 오류 갈래 — approved 주문 확인 조회 자체가 실패하면 3원칙대로 위장하지 않고 ok:false 다.
    it('approved 주문 확인 조회 실패 → ok:false(3원칙 — 위장 금지)', async () => {
      const admin = new MockAdminClient()
      admin.pushResponse({ enabled: true }, null)
      admin.pushResponse(
        { name: 't', priority: null, external_ref: null, assignee_member_id: null, dev_workflow: true, stage: 'as', actual_pct: 40 },
        null
      )
      admin.pushResponse(null, null) // 자식 없음(리프)
      admin.pushResponse(null, null) // 활성 주문 없음
      admin.pushResponse(null, { message: 'db down' }) // approved 조회 실패
      const r = await ensureOrderForWorkflowLeaf(admin as unknown as AdminClient, { projectId: 'p', wbsItemId: 'w', actorUserId: 'u' })
      expect(r).toEqual({ ok: false, error: expect.stringContaining('승인 주문 확인 실패') })
    })
  })
})
