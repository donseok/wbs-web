import { describe, it, expect, beforeEach } from 'vitest'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { ensureOrderForAssignedLeaf } from '@/lib/agent/ensureOrder'

/**
 * Mock AdminClient 큐 체이닝 기반 테스트.
 * select(...).from(...) 호출 시 큐에 저장되고,
 * maybeSingle() 호출 시 큐의 첫 번째 응답을 반환.
 */
class MockAdminClient {
  private queue: Array<{
    data: unknown
    error: null | { message: string; code?: string }
  }> = []

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

  insert(_payload: Record<string, unknown>) {
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

describe('ensureOrderForAssignedLeaf', () => {
  let admin: AdminClient | MockAdminClient
  const projectId = 'project-1'
  const wbsItemId = 'item-1'
  const actorUserId = 'admin-1'

  beforeEach(() => {
    admin = new MockAdminClient()
  })

  it('agent_projects 미등록 → created:false, reason not_agent_project (에러 아님 — 게이트 유지)', async () => {
    // 큐: agent_projects [{ data: null }]
    ;(admin as MockAdminClient).pushResponse(null, null)

    const result = await ensureOrderForAssignedLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'not_agent_project' })
  })

  it('자식 있는 항목 → created:false, reason not_leaf', async () => {
    // 큐: agent_projects [{ enabled: true }] → wbs_items [{ id: 'child' }]
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse({ id: 'child' }, null)

    const result = await ensureOrderForAssignedLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'not_leaf' })
  })

  it('활성 주문 존재 → created:false, reason active_exists (no-op 멱등)', async () => {
    // 큐: agent_projects [{ enabled: true }] → wbs_items [null] → agent_work_orders [{ id: 'o-1' }]
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse({ id: 'o-1' }, null)

    const result = await ensureOrderForAssignedLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'active_exists' })
  })

  it('조건 충족 → insert, created:true, created_by=actorUserId', async () => {
    // 큐: agent_projects [{ enabled: true }] → wbs_items [null] → agent_work_orders [null]
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse(
      { name: 'Test Item', priority: 'high', external_ref: 'REF-123' },
      null
    )

    const result = await ensureOrderForAssignedLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: true })
  })

  it('경합 unique violation(23505) → created:false 수렴(멱등 — 에러 아님)', async () => {
    // 큐: ... → insert 실패 with 23505
    ;(admin as MockAdminClient).pushResponse({ enabled: true }, null)
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse(
      { name: 'Test Item', priority: 'high', external_ref: 'REF-123' },
      null
    )
    ;(admin as MockAdminClient).pushResponse(
      null,
      { message: 'duplicate key value', code: '23505' }
    )

    const result = await ensureOrderForAssignedLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'active_exists' })
  })

  it('선행조회 실패 → ok:false (3원칙 — 위장 금지)', async () => {
    // 큐: agent_projects 에러
    ;(admin as MockAdminClient).pushResponse(null, { message: 'db down' })

    const result = await ensureOrderForAssignedLeaf(admin, {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: false, error: expect.stringContaining('등록 조회 실패') })
  })
})
