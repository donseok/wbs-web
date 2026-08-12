import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireSuperuser: vi.fn(),
  updateActual: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireSuperuser: mocks.requireSuperuser,
}))
vi.mock('@/app/actions/wbs', () => ({ updateActual: mocks.updateActual }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn().mockResolvedValue(undefined) }))

import {
  approveAgentCompletion, createAgentWorkOrder, rejectAgentCompletion,
  registerAgentProject, unregisterAgentProject, reclaimAgentOrder, cancelAgentOrder, fetchAgentOps,
} from '@/app/actions/agentWork'
import { emitNotification } from '@/lib/notify/emit'

// UUID 형식 테스트 픽스처
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'

type Resp = { data?: unknown; error?: { message: string } | null }
function admin(queues: Record<string, Resp[]>) {
  const captured: Record<string, unknown[]> = {}
  const client = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'delete', 'eq', 'in', 'order', 'limit', 'contains']) b[k] = () => b
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
  return { client, captured }
}
const ACTOR = { ok: true, actor: { userId: 'admin-1' } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue(ACTOR)
  mocks.requireSuperuser.mockResolvedValue(ACTOR)
  mocks.updateActual.mockResolvedValue({ ok: true })
})

describe('createAgentWorkOrder', () => {
  it('projectId 형식 검증 — 비형식 거부', async () => {
    const r = await createAgentWorkOrder('invalid-id', W1, '지시', 0)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('잘못된 요청입니다.')
  })
  it('wbsItemId 형식 검증 — 비형식 거부', async () => {
    const r = await createAgentWorkOrder(P1, 'invalid-id', '지시', 0)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('잘못된 요청입니다.')
  })
  it('리프가 아닌 항목은 발행 거부', async () => {
    admin({
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      wbs_items: [
        { data: { id: W1, project_id: P1 } }, // 항목
        { data: { id: 'child' } },                // 자식 있음
      ],
    })
    const r = await createAgentWorkOrder(P1, W1, '지시', 0)
    expect(r.ok).toBe(false)
  })
  it('타 프로젝트 항목은 발행 거부', async () => {
    admin({
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      wbs_items: [{ data: { id: W1, project_id: 'OTHER' } }],
    })
    const r = await createAgentWorkOrder(P1, W1, '지시', 0)
    expect(r.ok).toBe(false)
  })
  it('권한 없으면 거부', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const r = await createAgentWorkOrder(P1, W1, '지시', 0)
    expect(r).toEqual({ ok: false, error: '권한 없음' })
  })
  it('에이전트 루프 미등록 프로젝트는 발행 거부', async () => {
    admin({ agent_projects: [{ data: null }] })
    const r = await createAgentWorkOrder(P1, W1, '지시', 0)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('에이전트 루프가 등록되지 않은 프로젝트입니다.')
  })
  it('등록됐지만 비활성(enabled:false) 이면 발행 거부', async () => {
    admin({ agent_projects: [{ data: { project_id: P1, enabled: false } }] })
    const r = await createAgentWorkOrder(P1, W1, '지시', 0)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('에이전트 루프가 등록되지 않은 프로젝트입니다.')
  })
  it('등록 조회 실패 시 중단(3원칙 — 실패를 미등록으로 위장하지 않는다)', async () => {
    admin({ agent_projects: [{ data: null, error: { message: 'permission denied' } }] })
    const r = await createAgentWorkOrder(P1, W1, '지시', 0)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('등록 조회 실패')
  })
})

describe('approveAgentCompletion', () => {
  const ORDER = { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 }
  it('orderId 형식 검증 — 비형식 거부', async () => {
    const r = await approveAgentCompletion('invalid-id')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('잘못된 요청입니다.')
  })
  it('updateActual(100) 성공 후 승인 전이 + 보고 review 기록', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],       // 조회, CAS approved
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }], // 최신 completion, review 기록
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(mocks.updateActual).toHaveBeenCalledWith(W1, 100)
  })
  it('updateActual 실패면 주문은 reported 유지', async () => {
    mocks.updateActual.mockResolvedValue({ ok: false, error: '하위 항목이 있어 롤업으로 계산됩니다' })
    admin({ agent_work_orders: [{ data: ORDER }] })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(false)
  })
  it('wbs_item 삭제된 주문은 승인 불가 — 사람이 취소로 정리', async () => {
    admin({ agent_work_orders: [{ data: { ...ORDER, wbs_item_id: null } }] })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    expect(mocks.updateActual).not.toHaveBeenCalled()
  })
  it('CAS 0행 + 재조회 claimed → 반려 경합 안내 메시지(실적은 이미 100)', async () => {
    admin({
      agent_work_orders: [
        { data: ORDER },              // loadOrderForAdmin 조회
        { data: [] },                  // CAS 0행 — 다른 관리자가 그 사이 반려함
        { data: { status: 'claimed' } }, // 경합 재조회
      ],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('다른 관리자의 반려와 경합했습니다')
    expect(r.error).toContain('WBS 실적이 이미 100%로 반영되었으니')
  })
  it('배정자에게 work.approved 발행', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
      wbs_items: [{ data: { name: '로그인', assignee_member_id: 'm-1', stage: null, external_ref: null } }],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.approved', projectId: P1, actorUserId: 'admin-1',
      entityType: 'agent_order', entityId: O1,
      recipientMemberIds: ['m-1'],
    }))
  })
  it('배정자 없으면 발행 생략', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
      wbs_items: [{ data: { name: '로그인', assignee_member_id: null, stage: null, external_ref: null } }],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(emitNotification).not.toHaveBeenCalled()
  })
  it('승인해도 work.unblocked 는 발행하지 않는다 — 정본은 setWbsStage(I2, 최종 리뷰)', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
      wbs_items: [
        { data: { name: '로그인', assignee_member_id: 'm-1', stage: 'im', external_ref: 'MES/TSK-01-00' } }, // 알림용 항목 조회
      ],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(emitNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'work.unblocked' }))
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'work.approved' }))
  })
})

describe('rejectAgentCompletion', () => {
  const ORDER = { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 }
  it('orderId 형식 검증 — 비형식 거부', async () => {
    const r = await rejectAgentCompletion('invalid-id', '사유')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('잘못된 요청입니다.')
  })
  it('사유 없으면 거부', async () => {
    const r = await rejectAgentCompletion(O1, '   ')
    expect(r.ok).toBe(false)
  })
  it('성공 시 reported→claimed + review 기록', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],       // 조회, CAS claimed
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }], // 최신 completion, review 기록
    })
    const r = await rejectAgentCompletion(O1, '거절 사유')
    expect(r.ok).toBe(true)
  })
  it('배정자에게 work.rejected 발행', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
      wbs_items: [{ data: { name: '로그인', assignee_member_id: 'm-1', stage: null, external_ref: null } }],
    })
    const r = await rejectAgentCompletion(O1, '거절 사유')
    expect(r.ok).toBe(true)
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.rejected', projectId: P1, actorUserId: 'admin-1',
      entityType: 'agent_order', entityId: O1,
      recipientMemberIds: ['m-1'],
    }))
  })
})

describe('registerAgentProject', () => {
  it('비형식 projectId 거부', async () => {
    const r = await registerAgentProject('invalid-id', '메모')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('잘못된 요청입니다.')
  })
  it('슈퍼유저 아니면 거부', async () => {
    mocks.requireSuperuser.mockResolvedValue({ ok: false, error: '슈퍼 필요' })
    const r = await registerAgentProject(P1, '메모')
    expect(r).toEqual({ ok: false, error: '슈퍼 필요' })
  })
  it('성공 시 insert+revalidate', async () => {
    admin({ agent_projects: [{ data: [{ project_id: P1 }] }] })
    const r = await registerAgentProject(P1, '메모')
    expect(r.ok).toBe(true)
  })
})

describe('unregisterAgentProject', () => {
  it('비형식 projectId 거부', async () => {
    const r = await unregisterAgentProject('invalid-id')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('잘못된 요청입니다.')
  })
  it('슈퍼유저 아니면 거부', async () => {
    mocks.requireSuperuser.mockResolvedValue({ ok: false, error: '권한 없음' })
    const r = await unregisterAgentProject(P1)
    expect(r).toEqual({ ok: false, error: '권한 없음' })
  })
  it('성공 시 delete', async () => {
    admin({ agent_projects: [{ data: null }] })
    const r = await unregisterAgentProject(P1)
    expect(r.ok).toBe(true)
  })
})

describe('reclaimAgentOrder', () => {
  const ORDER = { id: O1, project_id: P1, status: 'claimed', wbs_item_id: W1 }
  it('orderId 형식 검증 — 비형식 거부', async () => {
    const r = await reclaimAgentOrder('invalid-id')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('잘못된 요청입니다.')
  })
  it('claimed 아니면 거부', async () => {
    admin({ agent_work_orders: [{ data: { ...ORDER, status: 'ready' } }] })
    const r = await reclaimAgentOrder(O1)
    expect(r.ok).toBe(false)
  })
  it('CAS 0행 → 실패 메시지', async () => {
    admin({ agent_work_orders: [{ data: ORDER }, { data: [] }] })
    const r = await reclaimAgentOrder(O1)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('바뀌어')
  })
  it('회수 성공 시 claimed_by_user_id 도 null 로 정리한다(release/route.ts 와 동일, I1)', async () => {
    const { captured } = admin({ agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }] })
    const r = await reclaimAgentOrder(O1)
    expect(r.ok).toBe(true)
    expect(captured.agent_work_orders[0]).toMatchObject({
      status: 'ready', claimed_by: null, claimed_by_user_id: null, claimed_at: null,
    })
  })
})

describe('cancelAgentOrder', () => {
  it('orderId 형식 검증 — 비형식 거부', async () => {
    const r = await cancelAgentOrder('invalid-id')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('잘못된 요청입니다.')
  })
  it('approved 상태면 거부', async () => {
    admin({ agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'approved', wbs_item_id: W1 } }] })
    const r = await cancelAgentOrder(O1)
    expect(r.ok).toBe(false)
  })
  it('ready→cancelled 성공', async () => {
    admin({ agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'ready', wbs_item_id: W1 } }, { data: [{ id: O1 }] }] })
    const r = await cancelAgentOrder(O1)
    expect(r.ok).toBe(true)
  })
})

describe('fetchAgentOps', () => {
  it('projectId 형식 검증 — 비형식 거부', async () => {
    const r = await fetchAgentOps('invalid-id')
    expect(r.ok).toBe(false)
  })
  it('미등록 프로젝트 → registered:false', async () => {
    const sb = {
      from: vi.fn(() => {
        const b: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'in', 'order']) b[k] = () => b
        b.maybeSingle = async () => ({ data: null, error: null })
        return b
      }),
    }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await fetchAgentOps(P1)
    expect(r.ok).toBe(true)
    expect((r as unknown as { registered: boolean }).registered).toBe(false)
  })
  it('agent_projects 조회 실패 → ok:false (빈 목록 위장 금지)', async () => {
    const sb = {
      from: vi.fn((table: string) => {
        const b: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'in', 'order']) b[k] = () => b
        if (table === 'agent_projects') {
          b.maybeSingle = async () => ({ data: null, error: { message: 'permission denied' } })
        }
        return b
      }),
    }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await fetchAgentOps(P1)
    expect(r.ok).toBe(false)
    expect((r as unknown as { error: string }).error).toContain('등록 조회 실패')
  })
  it('agent_work_orders 조회 실패 → ok:false', async () => {
    const sb = {
      from: vi.fn((table: string) => {
        const b: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'in', 'order']) b[k] = () => b
        if (table === 'agent_projects') {
          b.maybeSingle = async () => ({ data: { project_id: P1, enabled: true }, error: null })
        } else if (table === 'agent_work_orders') {
          b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'query failed' } }).then(r)
        }
        return b
      }),
    }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await fetchAgentOps(P1)
    expect(r.ok).toBe(false)
    expect((r as unknown as { error: string }).error).toContain('주문 조회')
  })
  it('정상 조립 — item 매핑 + reports 그룹핑', async () => {
    const O2 = '55555555-5555-4555-8555-555555555555'
    const R1 = '66666666-6666-4666-8666-666666666666'
    const R2 = '77777777-7777-4777-8777-777777777777'
    const sb = {
      from: vi.fn((table: string) => {
        const responses: Record<string, unknown> = {
          agent_projects: { data: { project_id: P1, enabled: true }, error: null },
          agent_work_orders: {
            data: [
              { id: O1, project_id: P1, status: 'ready', wbs_item_id: W1, priority: 1, instructions: 'task1', claimed_by: null, claimed_at: null, updated_at: '2026-07-31T10:00:00Z' },
              { id: O2, project_id: P1, status: 'claimed', wbs_item_id: null, priority: 0, instructions: 'task2', claimed_by: null, claimed_at: null, updated_at: '2026-07-31T11:00:00Z' },
            ],
            error: null,
          },
          wbs_items: {
            data: [{ id: W1, name: '로그인', code: '1.1' }],
            error: null,
          },
          agent_work_reports: {
            data: [
              { id: R1, work_order_id: O1, kind: 'progress', percent: 50, summary: '진행중', links: [], agent: 'bot', review_action: null, review_note: null, created_at: '2026-07-31T10:30:00Z' },
              { id: R2, work_order_id: O1, kind: 'completion', percent: 100, summary: '완료', links: [], agent: 'bot', review_action: null, review_note: null, created_at: '2026-07-31T10:45:00Z' },
            ],
            error: null,
          },
        }
        const resp = (responses as unknown as Record<string, unknown>)[table]
        const b: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'in', 'order']) b[k] = () => b
        b.maybeSingle = async () => resp
        b.then = (r: (v: unknown) => unknown) => Promise.resolve(resp).then(r)
        return b
      }),
    }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await fetchAgentOps(P1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.registered).toBe(true)
      expect(r.orders).toHaveLength(2)
      // O1: has wbs_item_id W1, 2 reports in order
      expect(r.orders[0].id).toBe(O1)
      expect(r.orders[0].item_name).toBe('로그인')
      expect(r.orders[0].item_code).toBe('1.1')
      expect(r.orders[0].reports).toHaveLength(2)
      expect(r.orders[0].reports[0].kind).toBe('progress')
      expect(r.orders[0].reports[1].kind).toBe('completion')
      // O2: null wbs_item_id, no reports
      expect(r.orders[1].id).toBe(O2)
      expect(r.orders[1].item_name).toBeNull()
      expect(r.orders[1].item_code).toBeNull()
      expect(r.orders[1].reports).toHaveLength(0)
    }
  })
})
