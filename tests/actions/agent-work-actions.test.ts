import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  requireDelegationRight: vi.fn(),
  viewerEmail: vi.fn(),
  myMemberIds: vi.fn(),
  isSubtreeManager: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: mocks.requireProjectMember,
}))
// 반려·승인 취소·재작업 요청은 loadOrderForReview → requireDelegationRight(관리자 또는 담당자 본인)로 판정한다(2026-09-14).
vi.mock('@/lib/agent/delegation', () => ({ requireDelegationRight: mocks.requireDelegationRight }))
// 승인·(반려 계열의 관리자·담당자 본인 실패 시 폴백)은 requireSubtreeManagerOrAdmin(트랙 B, 2026-09-15)
// 이 관리자 또는 서브트리 관리자로 판정한다. subtreeManager.ts 는 실제 모듈을 쓰고(delegation.ts 와
// 분리돼 있어 가벼움) 그 내부가 부르는 viewerEmail·myMemberIds·isSubtreeManager 만 목킹한다.
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: mocks.viewerEmail }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: mocks.myMemberIds, isSubtreeManager: mocks.isSubtreeManager }))
// 승인/승인 되돌림의 실적% 쓰기는 updateActual(팀 게이트) 대신 admin 경유 특권 헬퍼
// (agentWork.ts 지역 함수 applyApprovedActualPct)로 admin(...) 큐 client 를 직접 쓴다(트랙 B
// 후속, 2026-09-15) — updateActual 목은 더 필요 없다. after 는 요청 스코프 밖(vitest)에서 던지므로
// stage-lifecycle.test.ts 와 같은 패턴으로 즉시 실행 shim 을 씌운다.
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/server', async orig => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})
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
  // 기본은 관리자 통과 — 개별 테스트가 담당자 본인·거부로 바꾼다.
  mocks.requireDelegationRight.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' }, projectId: P1, isAdmin: true })
  // 서브트리 관리자 경로 기본값 — 개별 테스트가 필요할 때만 override. 기본은 "아니다" 쪽으로
  // 안전하게 둔다(관리자 fast path 가 대부분의 테스트를 그 전에 통과시킨다).
  mocks.viewerEmail.mockResolvedValue('member@example.com')
  mocks.myMemberIds.mockResolvedValue([])
  mocks.isSubtreeManager.mockResolvedValue(false)
})

/** applyApprovedActualPct(agentWork.ts 지역 특권 헬퍼)가 승인 시 소비하는 wbs_items 큐 3건 —
 *  항목 조회(기존 actual_pct)·자식 없음(리프)·UPDATE. oldPct 는 100 과 다른 값을 줘야
 *  멱등 단락(Number(old)===newPct)을 피해 실제 쓰기 경로를 태운다. */
function actualPctWriteQueue(oldPct = 40) {
  return [
    { data: { id: W1, actual_pct: oldPct, project_id: P1 } },
    { data: null },
    { data: [{ id: W1 }] },
  ]
}

describe('approveAgentCompletion', () => {
  const ORDER = { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 }
  it('orderId 형식 검증 — 비형식 거부', async () => {
    const r = await approveAgentCompletion('invalid-id')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('잘못된 요청입니다.')
  })
  it('승인 시 실적 100% 반영(특권 헬퍼, updateActual 아님) + 승인 전이 + 보고 review 기록', async () => {
    const { captured } = admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],       // 조회, CAS approved
      wbs_items: actualPctWriteQueue(),
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }], // 최신 completion, review 기록
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(captured.wbs_items?.[0]).toMatchObject({ actual_pct: 100 })
  })
  it('멱등 — 이미 100% 인 항목을 재승인해도 추가 쓰기 없이 ok', async () => {
    const { captured } = admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      wbs_items: [{ data: { id: W1, actual_pct: 100, project_id: P1 } }], // 멱등 단락 — 자식 확인·UPDATE 안 감
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(captured.wbs_items).toBeUndefined() // update() 호출 자체가 없다
  })
  it('실적 반영 실패(자식 있는 항목 방어)면 주문은 reported 유지', async () => {
    const { captured } = admin({
      agent_work_orders: [{ data: ORDER }],
      wbs_items: [{ data: { id: W1, actual_pct: 40, project_id: P1 } }, { data: { id: 'child-1' } }],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('하위 항목이 있어 롤업으로 계산됩니다')
    expect(captured.agent_work_orders).toBeUndefined() // CAS 까지 못 감
  })
  it('wbs_item 삭제된 주문은 승인 불가 — 사람이 취소로 정리', async () => {
    const { captured } = admin({ agent_work_orders: [{ data: { ...ORDER, wbs_item_id: null } }] })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    expect(captured.wbs_items).toBeUndefined()
  })
  it('CAS 0행 + 재조회 claimed → 반려 경합 안내 메시지(실적은 이미 100)', async () => {
    admin({
      agent_work_orders: [
        { data: ORDER },              // loadOrderForAdmin 조회
        { data: [] },                  // CAS 0행 — 다른 관리자가 그 사이 반려함
        { data: { status: 'claimed' } }, // 경합 재조회
      ],
      wbs_items: actualPctWriteQueue(),
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
      wbs_items: [...actualPctWriteQueue(), { data: { name: '로그인', assignee_member_id: 'm-1', stage: null, external_ref: null } }],
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
      wbs_items: [...actualPctWriteQueue(), { data: { name: '로그인', assignee_member_id: null, stage: null, external_ref: null } }],
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
      // 실적 반영(특권 헬퍼) → 알림용 조회 → transitionStage 항목 조회 → 리프 확인(자식 있음 → skipped:'parent')
      wbs_items: [
        ...actualPctWriteQueue(),
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
        ...actualPctWriteQueue(),
        { data: { name: '로그인', assignee_member_id: null } },
        { data: { id: W1, project_id: P1, name: '로그인', external_ref: null, stage: 'xx', dev_workflow: true } },
      ],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(r.warning).toBeTruthy()
  })
  it('승인: 관리자도 리프 담당자도 아니지만 서브트리 관리자면 허용(트랙 B) — 실적이 실제로 100% 반영된다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
    mocks.myMemberIds.mockResolvedValue(['anc-member'])
    mocks.isSubtreeManager.mockResolvedValue(true)
    const { captured } = admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      wbs_items: actualPctWriteQueue(),
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
    })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(mocks.isSubtreeManager).toHaveBeenCalledWith(
      expect.anything(), { itemId: W1, projectId: P1, myMemberIds: ['anc-member'] },
    )
    // 알려진 한계(2026-09-15) 는 해소됐다 — updateActual(팀 게이트) 대신 특권 헬퍼가 admin
    // 경유로 쓰므로 서브트리 관리자(팀 축과 무관한 개인 축 자격)여도 실제로 100% 가 반영된다.
    expect(captured.wbs_items?.[0]).toMatchObject({ actual_pct: 100 })
    expect(captured.change_logs?.[0]).toMatchObject({ field: 'actual_pct', new_value: '100', user_id: 'anc-1' })
  })
  it('승인: 조상 조회(isSubtreeManager)가 throw 하면 거부 — fail-closed, 실적 쓰기 없음', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
    mocks.myMemberIds.mockResolvedValue(['anc-member'])
    mocks.isSubtreeManager.mockRejectedValue(new Error('조상 조회 실패: boom'))
    const { captured } = admin({ agent_work_orders: [{ data: ORDER }] })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    expect(captured.wbs_items).toBeUndefined() // loadOrderForAdmin 에서 막혀 실적 쓰기까지 못 감
  })
  it('승인해도 work.unblocked 는 발행하지 않는다 — 정본은 setWbsStage(I2, 최종 리뷰)', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
      wbs_items: [
        ...actualPctWriteQueue(),
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
    expect(r).toEqual({ ok: true, order: null, priorOrders: [], projectId: P1 })
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

/**
 * opts.revertsActual(기본 true): 실적 복원(applyApprovedActualPct, 특권 헬퍼) 경로를 실제로
 * 타는 시나리오면 true — wbs_items 큐에 그 3건(항목 조회 100→자식 없음→UPDATE 40)을 ITEM_NOTIFY
 * 와 ITEM_STAGE 사이에 끼워 넣는다. warning 으로 강등돼 복원을 건너뛰는 시나리오(실적 이력
 * 불일치·부재, 승인 기록 없음)는 반드시 false 로 줘야 한다 — 큐는 테이블별 순차 소비라, 건너뛴
 * 단계의 몫을 transitionStage 가 잘못 집어가면 그 뒤가 통째로 어긋난다.
 */
function approvedQueues(over: Record<string, unknown[]> = {}, opts: { revertsActual?: boolean } = {}) {
  const revertsActual = opts.revertsActual ?? true
  return {
    agent_work_orders: [{ data: APPROVED }, { data: [{ id: O1 }] }],
    agent_work_reports: [{ data: REVIEWED_REPORT }, { data: [{ id: 'r9' }] }],
    // ITEM_NOTIFY(알림용 조회) → [실적 복원: 항목 조회·자식 없음·UPDATE](revertsActual 일 때만)
    // → ITEM_STAGE(transitionStage 자체 조회) → 리프 확인 → UPDATE
    wbs_items: [
      { data: ITEM_NOTIFY },
      ...(revertsActual ? [
        { data: { id: W1, actual_pct: 100, project_id: P1 } },
        { data: null },
        { data: [{ id: W1 }] },
      ] : []),
      { data: ITEM_STAGE }, { data: null }, { data: [{ id: W1 }] },
    ],
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
    const { captured } = admin({ agent_work_orders: [{ data: { ...APPROVED, status: 'reported' } }] })
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('reported')
    expect(captured.wbs_items).toBeUndefined()
  })
  it('성공 — 주문 reported 복귀 + 리뷰 필드 전부 해제 + 실적 복원(특권 헬퍼로 실제 반영) + stage xx→im', async () => {
    const { captured } = admin(approvedQueues())
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(captured.agent_work_orders[0]).toMatchObject({ status: 'reported' })
    expect(captured.agent_work_reports[0]).toMatchObject({
      review_action: null, reviewed_by: null, reviewed_at: null, review_note: null,
    })
    // wbs_items 의 update() 호출 순서: [0]=실적 복원(특권 헬퍼), [1]=stage 되돌림.
    expect(captured.wbs_items[0]).toMatchObject({ actual_pct: 40 })
    expect(captured.wbs_items[1]).toMatchObject({ stage: 'im' })
  })
  it('CAS 0행(경합) — 실적을 건드리지 않는다', async () => {
    const { captured } = admin({ agent_work_orders: [{ data: APPROVED }, { data: [] }] })
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    expect(captured.wbs_items).toBeUndefined()
  })
  it('최신 실적 이력이 승인의 100 이 아니면(사람이 뒤에 손댐) 복원하지 않고 warning', async () => {
    const { captured } = admin(approvedQueues({ change_logs: [{ data: { old_value: '100', new_value: '70' } }, { data: null }] }, { revertsActual: false }))
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('실적')
    // 실적 복원은 건너뛰지만 stage 되돌림은 그대로 실행된다 — wbs_items 의 유일한 update() 는 stage.
    expect(captured.wbs_items).toEqual([expect.objectContaining({ stage: 'im' })])
  })
  it('승인 이후 구간에 실적 이력이 없으면 되돌리지 않고 warning', async () => {
    const { captured } = admin(approvedQueues({ change_logs: [{ data: null }, { data: null }] }, { revertsActual: false }))
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('실적')
    expect(captured.wbs_items).toEqual([expect.objectContaining({ stage: 'im' })])
  })
  it('승인 기록(reviewed_at)을 못 찾으면 실적을 건드리지 않는다', async () => {
    const { captured } = admin(approvedQueues({ agent_work_reports: [{ data: { id: 'r9', reviewed_at: null } }, { data: [{ id: 'r9' }] }] }, { revertsActual: false }))
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('승인 기록')
    expect(captured.wbs_items).toEqual([expect.objectContaining({ stage: 'im' })])
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
  it('성공 — 주문 claimed + 반려로 기록(사유 보존) + 실적 복원(특권 헬퍼로 실제 반영) + stage xx→im', async () => {
    const { captured } = admin(approvedQueues())
    const r = await requestAgentRework(O1, '테스트가 빠졌습니다')
    expect(r.ok).toBe(true)
    expect(captured.agent_work_orders[0]).toMatchObject({ status: 'claimed' })
    expect(captured.agent_work_reports[0]).toMatchObject({
      review_action: 'reject', reviewed_by: 'admin-1', review_note: '테스트가 빠졌습니다',
    })
    expect(captured.wbs_items[0]).toMatchObject({ actual_pct: 40 })
    expect(captured.wbs_items[1]).toMatchObject({ stage: 'im' })
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

describe('검토 계열 자격(2026-09-14 "담당자 본인도 허용") — 반려·승인 취소·재작업은 requireDelegationRight, 승인은 관리자만', () => {
  const REPORTED = { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 }
  const APPROVED = { id: O1, project_id: P1, status: 'approved', wbs_item_id: W1 }
  const asMember = () => mocks.requireDelegationRight.mockResolvedValue({ ok: true, actor: { userId: 'member-1' }, projectId: P1, isAdmin: false })
  const DENY = { ok: false, error: '담당자 본인 또는 프로젝트 관리자만 바꿀 수 있습니다.' }

  it('반려: 담당자 본인(member) 도 가능 — requireDelegationRight(wbs_item_id)로 판정, 관리자 가드는 부르지 않는다', async () => {
    asMember()
    admin({
      agent_work_orders: [{ data: REPORTED }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
      wbs_items: [{ data: { name: '로그인', assignee_member_id: 'm-1', stage: null, external_ref: null } }],
    })
    const r = await rejectAgentCompletion(O1, '내가 다시 볼게요')
    expect(r.ok).toBe(true)
    expect(mocks.requireDelegationRight).toHaveBeenCalledWith(W1)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })
  it('반려: requireDelegationRight 가 거부하고 관리자·서브트리 관리자도 아니면 그 오류 그대로, 상태 변경 없음(트랙 B 폴백 포함)', async () => {
    mocks.requireDelegationRight.mockResolvedValue(DENY)
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
    const { captured } = admin({ agent_work_orders: [{ data: REPORTED }] })
    expect(await rejectAgentCompletion(O1, '사유')).toEqual(DENY)
    expect(captured.agent_work_orders).toBeUndefined()
  })
  it('반려: requireDelegationRight 가 거부해도 서브트리 관리자면 허용(트랙 B)', async () => {
    mocks.requireDelegationRight.mockResolvedValue(DENY)
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
    mocks.myMemberIds.mockResolvedValue(['anc-member'])
    mocks.isSubtreeManager.mockResolvedValue(true)
    admin({
      agent_work_orders: [{ data: REPORTED }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }],
    })
    const r = await rejectAgentCompletion(O1, '사유')
    expect(r.ok).toBe(true)
  })
  it('승인 취소: 담당자 본인도 가능(requireDelegationRight), 관리자 가드 미사용', async () => {
    asMember()
    admin({
      agent_work_orders: [{ data: APPROVED }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: 'r9', reviewed_at: null } }, { data: [{ id: 'r9' }] }],
      wbs_items: [{ data: { name: '로그인', assignee_member_id: 'm-1', stage: 'xx', external_ref: null, dev_workflow: true } }],
    })
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(mocks.requireDelegationRight).toHaveBeenCalledWith(W1)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })
  // r.ok:true 만으로는 부족하다 — 옛 updateActual(팀 게이트) 경로에서도 실적 복원 실패는
  // warning 으로 강등돼 r.ok 는 그대로 true 였다(구멍이 있어도 이 단언은 통과했을 것이다).
  // 그래서 실제로 40 으로 쓰였는지(captured)와 warning 이 비었는지를 함께 본다.
  it('승인 취소: requireDelegationRight 가 거부해도 서브트리 관리자면 허용(트랙 B) — 실적이 실제로 되돌아간다', async () => {
    mocks.requireDelegationRight.mockResolvedValue(DENY)
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
    mocks.myMemberIds.mockResolvedValue(['anc-member'])
    mocks.isSubtreeManager.mockResolvedValue(true)
    const { captured } = admin(approvedQueues())
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(r.warning).toBeUndefined()
    expect(captured.wbs_items[0]).toMatchObject({ actual_pct: 40 })
    expect(captured.change_logs?.[0]).toMatchObject({ field: 'actual_pct', new_value: '40', user_id: 'anc-1' })
  })
  it('재작업 요청: requireDelegationRight 가 거부하고 관리자·서브트리 관리자도 아니면 거부', async () => {
    mocks.requireDelegationRight.mockResolvedValue(DENY)
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
    admin({ agent_work_orders: [{ data: APPROVED }] })
    expect(await requestAgentRework(O1, '테스트 빠짐')).toEqual(DENY)
  })
  // r.ok:true 만으로는 부족하다(위 unapprove 케이스와 같은 이유) — 실제 반영·warning 부재까지 본다.
  it('재작업 요청: requireDelegationRight 가 거부해도 서브트리 관리자면 허용(트랙 B) — 실적이 실제로 되돌아간다', async () => {
    mocks.requireDelegationRight.mockResolvedValue(DENY)
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
    mocks.myMemberIds.mockResolvedValue(['anc-member'])
    mocks.isSubtreeManager.mockResolvedValue(true)
    const { captured } = admin(approvedQueues())
    const r = await requestAgentRework(O1, '테스트 빠짐')
    expect(r.ok).toBe(true)
    expect(r.warning).toBeUndefined()
    expect(captured.wbs_items[0]).toMatchObject({ actual_pct: 40 })
    expect(captured.change_logs?.[0]).toMatchObject({ field: 'actual_pct', new_value: '40', user_id: 'anc-1' })
  })
  it('WBS 항목이 삭제된 주문(wbs_item_id 없음)은 담당자를 특정 못 해 관리자만 — requireDelegationRight 대신 requireProjectAdmin', async () => {
    admin({ agent_work_orders: [{ data: { ...REPORTED, wbs_item_id: null } }, { data: [{ id: O1 }] }], agent_work_reports: [{ data: { id: 'r9' } }, { data: [{ id: 'r9' }] }] })
    const r = await rejectAgentCompletion(O1, '사유')
    expect(mocks.requireProjectAdmin).toHaveBeenCalledWith(P1)
    expect(mocks.requireDelegationRight).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })
  it('승인은 담당자여도 관리자·서브트리 관리자가 아니면 거부, review 경로 미사용', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 필요' })
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '관리자 필요' })
    admin({ agent_work_orders: [{ data: REPORTED }] })
    expect(await approveAgentCompletion(O1)).toEqual({ ok: false, error: '관리자 필요' })
    expect(mocks.requireDelegationRight).not.toHaveBeenCalled()
  })
  it('승인: 리프 본인 담당자(멤버)여도 거부 — isSubtreeManager 는 조상만 보고 리프 자신은 안 본다(분리 원칙)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'leaf-1' } })
    mocks.myMemberIds.mockResolvedValue(['leaf-member']) // 리프 자신의 담당자 id — 조상 담당자가 아니다
    mocks.isSubtreeManager.mockResolvedValue(false)
    admin({ agent_work_orders: [{ data: REPORTED }] })
    const r = await approveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    expect(mocks.requireDelegationRight).not.toHaveBeenCalled()
  })
})
