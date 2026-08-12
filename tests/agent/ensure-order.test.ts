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
    // 큐: agent_projects [{ enabled: true }] → wbs_items [item] → wbs_items(자식) [null] → agent_work_orders [null] → insert [{ id: 'order-1' }]
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
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse(null, null)
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
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse(null, null)
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
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse(null, null)
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
})
