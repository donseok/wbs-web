import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  updateActual: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: mocks.requireProjectMember,
}))
vi.mock('@/app/actions/wbs', () => ({ updateActual: mocks.updateActual }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn().mockResolvedValue(undefined) }))
const backfill = vi.hoisted(() => ({ backfillProjectOrders: vi.fn() }))
vi.mock('@/lib/agent/ensureOrder', () => ({ backfillProjectOrders: backfill.backfillProjectOrders }))

import {
  approveAgentCompletion, rejectAgentCompletion, setAgentProjectEnabled, getAgentOrderForItem,
  unapproveAgentCompletion, requestAgentRework,
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
      for (const k of ['select', 'delete', 'eq', 'gte', 'in', 'order', 'limit', 'contains']) b[k] = () => b
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
  mocks.requireProjectMember.mockResolvedValue(ACTOR)
  mocks.updateActual.mockResolvedValue({ ok: true })
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
  // 종전에는 skipped 중 'stage' 만 문구를 달고 'parent' 는 무음이었다 — 상위 항목에 나간 주문을
  // 승인하면 승인은 성공인데 단계만 뒤처진 반쪽 상태가 화면에 아무 흔적도 남기지 않았다.
  it("하위 항목이 있어 stage 를 건너뛰면 warning 으로 알린다 — skipped:'parent' 무음 금지", async () => {
    admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
      // 알림용 조회 → transitionStage 항목 조회 → 리프 확인(자식 있음 → skipped:'parent')
      wbs_items: [
        { data: { name: '상위 항목', assignee_member_id: null } },
        { data: { id: W1, project_id: P1, name: '상위 항목', external_ref: null, stage: 'ip', dev_workflow: true } },
        { data: { id: 'child-1' } },
      ],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('하위 항목')
  })
  it('건너뛴 사유를 모르는 값이어도 무음으로 끝내지 않는다 — 사유별 분기가 아니라 skipped 자체가 조건', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
      // stage 가 fromIn 밖(xx) → skipped:'stage'
      wbs_items: [
        { data: { name: '로그인', assignee_member_id: null } },
        { data: { id: W1, project_id: P1, name: '로그인', external_ref: null, stage: 'xx', dev_workflow: true } },
      ],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(r.warning).toBeTruthy()
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

describe('setAgentProjectEnabled — 킬스위치(2026-08-24, 등록 화면 대체)', () => {
  beforeEach(() => { backfill.backfillProjectOrders.mockResolvedValue({ ok: true, created: 2, failed: [] }) })
  it('비형식 projectId 거부', async () => {
    const r = await setAgentProjectEnabled('invalid-id', true)
    expect(r).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
  it('프로젝트 관리자 아니면 거부(슈퍼유저 전용이 아니다)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 필요' })
    const r = await setAgentProjectEnabled(P1, true)
    expect(r).toEqual({ ok: false, error: '관리자 필요' })
  })
  it('활성된 적 없는 프로젝트를 중지 → no-op(insert 없음)', async () => {
    const { captured } = admin({ agent_projects: [{ data: null }] })
    const r = await setAgentProjectEnabled(P1, false)
    expect(r.ok).toBe(true)
    expect(captured.agent_projects).toBeUndefined()
    expect(backfill.backfillProjectOrders).not.toHaveBeenCalled()
  })
  it('처음 켜기 → insert + 백필', async () => {
    const { captured } = admin({ agent_projects: [{ data: null }, { data: null }] })
    const r = await setAgentProjectEnabled(P1, true)
    expect(r).toEqual({ ok: true, backfilled: 2 })
    expect(captured.agent_projects[0]).toMatchObject({ project_id: P1, created_by: 'admin-1' })
    expect(backfill.backfillProjectOrders).toHaveBeenCalledWith(expect.anything(), { projectId: P1, actorUserId: 'admin-1' })
  })
  it('중지 → enabled:false 로 update, 백필 없음', async () => {
    const { captured } = admin({ agent_projects: [{ data: { enabled: true } }, { data: null }] })
    const r = await setAgentProjectEnabled(P1, false)
    expect(r.ok).toBe(true)
    expect(captured.agent_projects[0]).toEqual({ enabled: false })
    expect(backfill.backfillProjectOrders).not.toHaveBeenCalled()
  })
  it('재개 → enabled:true 로 update + 백필', async () => {
    const { captured } = admin({ agent_projects: [{ data: { enabled: false } }, { data: null }] })
    const r = await setAgentProjectEnabled(P1, true)
    expect(r).toEqual({ ok: true, backfilled: 2 })
    expect(captured.agent_projects[0]).toEqual({ enabled: true })
  })
  it('등록 조회 실패는 중단(위장 금지)', async () => {
    admin({ agent_projects: [{ data: null, error: { message: 'boom' } }] })
    const r = await setAgentProjectEnabled(P1, true)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('등록 조회 실패')
  })
})

describe('getAgentOrderForItem — 명세 패널 진행 상황(2026-08-24, agent-ops 대체)', () => {
  it('비형식 itemId 거부', async () => {
    const r = await getAgentOrderForItem('invalid-id')
    expect(r).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
  it('항목 없음 → 대상을 찾을 수 없습니다', async () => {
    const sb = { from: vi.fn(() => { const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: null, error: null }); return b }) }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await getAgentOrderForItem(W1)
    expect(r).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
  })
  it('프로젝트 멤버 아니면 거부', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
    const sb = { from: vi.fn(() => { const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: { project_id: P1 }, error: null }); return b }) }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await getAgentOrderForItem(W1)
    expect(r).toEqual({ ok: false, error: '멤버 아님' })
  })
  it('위임한 적 없음(주문 0건) → order:null', async () => {
    mocks.requireProjectMember.mockResolvedValue(ACTOR)
    let call = 0
    const sb = { from: vi.fn(() => { const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => {
        call += 1
        return { data: { project_id: P1 }, error: null } // wbs_items
      }
      // 주문 조회는 limit(1)+maybeSingle 이 아니라 목록이다 — 빌더를 그대로 await 한다.
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
      return b }) }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await getAgentOrderForItem(W1)
    expect(r).toEqual({ ok: true, order: null, priorOrders: [] })
    expect(call).toBeGreaterThan(0)
  })
  it('주문 있음 → 최신 주문 + 보고 이력', async () => {
    mocks.requireProjectMember.mockResolvedValue(ACTOR)
    const sb = { from: vi.fn((table: string) => { const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit', 'in']) b[k] = () => b
      if (table === 'wbs_items') b.maybeSingle = async () => ({ data: { project_id: P1 }, error: null })
      else if (table === 'agent_work_orders') {
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({
          data: [{ id: O1, status: 'reported', claimed_by: 'agent-x', claimed_at: '2026-08-24T00:00:00Z', updated_at: '2026-08-24T01:00:00Z' }],
          error: null,
        }).then(r)
      } else if (table === 'agent_work_reports') {
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({
          data: [{ id: 'r1', kind: 'completion', percent: 100, summary: '완료', links: [], agent: 'agent-x',
            review_action: null, review_note: null, created_at: '2026-08-24T01:00:00Z' }],
          error: null,
        }).then(r)
      }
      return b }) }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await getAgentOrderForItem(W1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.order?.id).toBe(O1)
      expect(r.order?.status).toBe('reported')
      expect(r.order?.reports).toHaveLength(1)
      expect(r.priorOrders).toEqual([])
    }
  })
  // 재발행 — approved 는 "활성 주문" 검사 어디에도 안 들어가므로 항목에 주문이 쌓인다.
  // 최신 하나만 읽던 종전 구현은 그 앞의 승인 이력을 통째로 감췄다(2026-08-27 감사).
  it('주문이 여러 개면 최신 하나를 order 로, 나머지를 priorOrders 로 준다', async () => {
    mocks.requireProjectMember.mockResolvedValue(ACTOR)
    const sb = { from: vi.fn((table: string) => { const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit', 'in']) b[k] = () => b
      if (table === 'wbs_items') b.maybeSingle = async () => ({ data: { project_id: P1 }, error: null })
      else if (table === 'agent_work_orders') {
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({
          data: [
            { id: O1, status: 'ready', claimed_by: null, claimed_at: null, updated_at: '2026-08-27T02:00:00Z' },
            { id: 'o-old', status: 'approved', claimed_by: 'agent-x', claimed_at: null, updated_at: '2026-08-26T02:00:00Z' },
          ],
          error: null,
        }).then(r)
      } else if (table === 'agent_work_reports') {
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
      }
      return b }) }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await getAgentOrderForItem(W1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.order?.id).toBe(O1)
      expect(r.priorOrders).toEqual([
        { id: 'o-old', status: 'approved', updated_at: '2026-08-26T02:00:00Z' },
      ])
    }
  })
})

/**
 * 승인을 무르는 두 경로(2026-08-27). 승인이 남긴 부수효과 셋(주문 상태·실적 100%·stage xx)을
 * 되감는다. stage 는 im 까지만 내린다 — 그 아래로 내리면 order_approved 가 false 로 뒤집힌
 * 상태와 겹쳐 후속 작업의 claim 게이트가 전부 다시 막힌다.
 */
const APPROVED = { id: O1, project_id: P1, status: 'approved', wbs_item_id: W1 }
const ITEM_NOTIFY = { name: '로그인', assignee_member_id: 'm-1' }
const ITEM_STAGE = { id: W1, project_id: P1, name: '로그인', external_ref: null, stage: 'xx', dev_workflow: true }
/** 승인 기록이 남은 완료 보고 — reviewed_at 이 실적 이력 조회의 하한이 된다 */
const REVIEWED_REPORT = { id: 'r9', reviewed_at: '2026-08-26T01:00:00Z' }
/** 승인이 실적을 40 → 100 으로 올린 흔적 */
const ACTUAL_LOG = { old_value: '40', new_value: '100' }

function approvedQueues(over: Record<string, unknown[]> = {}) {
  return {
    agent_work_orders: [{ data: APPROVED }, { data: [{ id: O1 }] }],
    agent_work_reports: [{ data: REVIEWED_REPORT }, { data: [{ id: 'r9' }] }],
    // ITEM_NOTIFY(알림용 조회) → ITEM_STAGE(transitionStage 자체 조회) → 리프 확인 → UPDATE
    wbs_items: [{ data: ITEM_NOTIFY }, { data: ITEM_STAGE }, { data: null }, { data: [{ id: W1 }] }],
    change_logs: [{ data: ACTUAL_LOG }, { data: null }],
    ...over,
  } as Record<string, { data?: unknown; error?: { message: string } | null }[]>
}

describe('unapproveAgentCompletion — 승인 취소(approved→reported)', () => {
  it('orderId 형식 검증 — 비형식 거부', async () => {
    const r = await unapproveAgentCompletion('invalid-id')
    expect(r).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
  it('approved 아닌 주문은 거부', async () => {
    admin({ agent_work_orders: [{ data: { ...APPROVED, status: 'reported' } }] })
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('reported')
    expect(mocks.updateActual).not.toHaveBeenCalled()
  })
  it('성공 — 주문 reported 복귀 + 리뷰 필드 전부 해제 + 실적 복원 + stage xx→im', async () => {
    const { captured } = admin(approvedQueues())
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(captured.agent_work_orders[0]).toMatchObject({ status: 'reported' })
    expect(captured.agent_work_reports[0]).toMatchObject({
      review_action: null, reviewed_by: null, reviewed_at: null, review_note: null,
    })
    expect(mocks.updateActual).toHaveBeenCalledWith(W1, 40)
    expect(captured.wbs_items[0]).toMatchObject({ stage: 'im' })
  })
  it('CAS 0행(경합) — 실적을 건드리지 않는다', async () => {
    admin({ agent_work_orders: [{ data: APPROVED }, { data: [] }] })
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    expect(mocks.updateActual).not.toHaveBeenCalled()
  })
  it('최신 실적 이력이 승인의 100 이 아니면(사람이 뒤에 손댐) 복원하지 않고 warning', async () => {
    admin(approvedQueues({ change_logs: [{ data: { old_value: '100', new_value: '70' } }, { data: null }] }))
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(mocks.updateActual).not.toHaveBeenCalled()
    expect(r.warning).toContain('실적')
  })
  it('승인 이후 구간에 실적 이력이 없으면 되돌리지 않고 warning', async () => {
    admin(approvedQueues({ change_logs: [{ data: null }, { data: null }] }))
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(mocks.updateActual).not.toHaveBeenCalled()
    expect(r.warning).toContain('실적')
  })
  it('승인 기록(reviewed_at)을 못 찾으면 실적을 건드리지 않는다', async () => {
    admin(approvedQueues({ agent_work_reports: [{ data: { id: 'r9', reviewed_at: null } }, { data: [{ id: 'r9' }] }] }))
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(mocks.updateActual).not.toHaveBeenCalled()
    expect(r.warning).toContain('승인 기록')
  })
  it('배정자에게 work.rejected 발행 — detail 은 반려가 아니라 승인 취소', async () => {
    admin(approvedQueues())
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.rejected', projectId: P1, actorUserId: 'admin-1',
      entityType: 'agent_order', entityId: O1, recipientMemberIds: ['m-1'],
      payload: expect.objectContaining({ detail: '완료 승인이 취소되었습니다' }),
    }))
  })
})

describe('requestAgentRework — 재작업 요청(approved→claimed)', () => {
  it('orderId 형식 검증 — 비형식 거부', async () => {
    const r = await requestAgentRework('invalid-id', '사유')
    expect(r).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
  it('사유 없으면 거부 — 주문을 읽기도 전에 막는다', async () => {
    const r = await requestAgentRework(O1, '   ')
    expect(r.ok).toBe(false)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })
  it('approved 아닌 주문은 거부', async () => {
    admin({ agent_work_orders: [{ data: { ...APPROVED, status: 'claimed' } }] })
    const r = await requestAgentRework(O1, '테스트가 빠졌습니다')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('claimed')
  })
  it('성공 — 주문 claimed + 반려로 기록(사유 보존) + 실적 복원 + stage xx→im', async () => {
    const { captured } = admin(approvedQueues())
    const r = await requestAgentRework(O1, '테스트가 빠졌습니다')
    expect(r.ok).toBe(true)
    expect(captured.agent_work_orders[0]).toMatchObject({ status: 'claimed' })
    expect(captured.agent_work_reports[0]).toMatchObject({
      review_action: 'reject', reviewed_by: 'admin-1', review_note: '테스트가 빠졌습니다',
    })
    expect(mocks.updateActual).toHaveBeenCalledWith(W1, 40)
    expect(captured.wbs_items[0]).toMatchObject({ stage: 'im' })
  })
  it('배정자에게 work.rejected 발행 — detail 은 재작업 요청', async () => {
    admin(approvedQueues())
    const r = await requestAgentRework(O1, '테스트가 빠졌습니다')
    expect(r.ok).toBe(true)
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.rejected', entityId: O1, recipientMemberIds: ['m-1'],
      payload: expect.objectContaining({ detail: '재작업이 요청되었습니다' }),
    }))
  })
})
