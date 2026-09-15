// tests/actions/agent-hub-actions.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), createAdminClient: vi.fn(),
  getAgentHub: vi.fn(), applyDelegation: vi.fn(), viewerEmail: vi.fn(), myMemberIds: vi.fn(),
  isSubtreeManager: vi.fn(),
  approve: vi.fn(), reject: vi.fn(), unapprove: vi.fn(), rework: vi.fn(), setWbsStage: vi.fn(), emitNotification: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectMember: mocks.requireProjectMember, requireProjectAdmin: mocks.requireProjectAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/data/agentHub', () => ({ getAgentHub: mocks.getAgentHub }))
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: mocks.viewerEmail }))
// isSubtreeManager 는 runHubProcessOp 의 회수 게이트가 requireSubtreeManagerOrAdmin(subtreeManager.ts,
// 실제 모듈)을 통해 부른다 — myMemberIds 와 같은 자리에서 같이 목킹한다(트랙 B, 2026-09-15).
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: mocks.myMemberIds, isSubtreeManager: mocks.isSubtreeManager }))
vi.mock('@/lib/agent/delegation', () => ({
  applyDelegation: mocks.applyDelegation, ERR_NOT_ASSIGNEE: '담당자 본인 또는 프로젝트 관리자만 바꿀 수 있습니다.',
}))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('@/app/actions/agentWork', () => ({
  approveAgentCompletion: mocks.approve, rejectAgentCompletion: mocks.reject,
  unapproveAgentCompletion: mocks.unapprove, requestAgentRework: mocks.rework,
}))
vi.mock('@/app/actions/wbsAssign', () => ({ setWbsStage: mocks.setWbsStage }))
import { refreshAgentHub, applyHubDelegations, runHubProcessOp } from '@/app/actions/agentHub'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const I = (n: number) => `33333333-3333-4333-8333-33333333333${n}`
const O = (n: number) => `44444444-4444-4444-8444-44444444444${n}`
const ADMIN = { ok: true, actor: { userId: 'admin-1', isSuperuser: false, projectRoles: new Map([[P1, 'admin']]), rosterTeams: new Map(), teamCode: null, teamId: null } }
const MEMBER = { ok: true, actor: { ...ADMIN.actor, userId: 'member-1', projectRoles: new Map([[P1, 'member']]) } }
const DENIED = { ok: false, error: '권한이 없습니다.' }
const HUB = { projectId: P1, rows: [] }

/** wbs_items 조회(id, assignee_member_id) 흉내 — select/eq/in 체인 뒤 thenable. */
function adminClient(items: { id: string; assignee_member_id?: string | null }[], error: { message: string } | null = null) {
  const client = { from: vi.fn(() => {
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in']) b[k] = () => b
    b.then = (r: (v: unknown) => unknown) =>
      Promise.resolve({ data: error ? null : items.map(i => ({ id: i.id, assignee_member_id: i.assignee_member_id ?? null })), error }).then(r)
    return b
  }) }
  mocks.createAdminClient.mockReturnValue(client)
  return client
}

/**
 * 조정용 관리자 클라이언트 흉내 — 테이블별 단건(maybeSingle)과 update 를 기록한다.
 * `.eq('id', v)` 로 잡힌 id 의 행을 돌려준다. update 뒤 `.select()` thenable 은 updateRows 개 행.
 */
function fakeAdmin(cfg: {
  orders?: Record<string, { project_id: string; status?: string; wbs_item_id?: string | null }>
  items?: Record<string, { project_id: string; name?: string; assignee_member_id?: string | null }>
  updateRows?: number
  /** 전이 RPC 응답 — 기본은 회수 성공(실적 무변경이라 스냅샷 없음). */
  rpc?: { data?: unknown; error?: { message: string } | null }
}) {
  const updates: { table: string; payload: Record<string, unknown> }[] = []
  const rpcCalls: Array<Record<string, unknown>> = []
  const client = { from: vi.fn((table: string) => {
    const b: Record<string, unknown> = {}
    let id: string | null = null
    let payload: Record<string, unknown> | null = null
    for (const k of ['select', 'in', 'order', 'limit']) b[k] = () => b
    b.eq = (col: string, v: string) => { if (col === 'id') id = v; return b }
    b.update = (p: Record<string, unknown>) => { payload = p; return b }
    b.maybeSingle = async () => {
      const src = table === 'agent_work_orders' ? cfg.orders : table === 'wbs_items' ? cfg.items : undefined
      const row = id && src ? src[id] ?? null : null
      return { data: row ? { id, ...row } : null, error: null }
    }
    b.then = (res: (v: unknown) => unknown) => {
      if (payload !== null) { updates.push({ table, payload }); return Promise.resolve({ data: Array.from({ length: cfg.updateRows ?? 1 }, () => ({ id })), error: null }).then(res) }
      return Promise.resolve({ data: [], error: null }).then(res)
    }
    return b
  }), rpc: vi.fn(async (...callArgs: unknown[]) => {
    rpcCalls.push(callArgs[1] as Record<string, unknown>)
    const r = cfg.rpc ?? { data: { ok: true, order_status: 'ready', stage: 'as', actual_pct: 0, stage_changed: true, actual_changed: false, reached_first: false, skipped: null } }
    return { data: r.data ?? null, error: r.error ?? null }
  }) }
  mocks.createAdminClient.mockReturnValue(client)
  return { client, updates, rpcCalls }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue(MEMBER)
  mocks.requireProjectAdmin.mockResolvedValue(ADMIN)
  mocks.getAgentHub.mockResolvedValue(HUB)
  mocks.applyDelegation.mockResolvedValue({ ok: true })
  for (const m of [mocks.approve, mocks.reject, mocks.unapprove, mocks.rework, mocks.setWbsStage]) m.mockResolvedValue({ ok: true })
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('refreshAgentHub', () => {
  it('멤버 → getAgentHub(projectId, {userId, isAdmin}) 결과', async () => {
    const r = await refreshAgentHub(P1)
    expect(r).toEqual({ ok: true, hub: HUB })
    expect(mocks.getAgentHub).toHaveBeenCalledWith(P1, { userId: 'member-1', isAdmin: false })
  })
  it('관리자면 isAdmin=true 로 넘긴다', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    await refreshAgentHub(P1)
    expect(mocks.getAgentHub).toHaveBeenCalledWith(P1, { userId: 'admin-1', isAdmin: true })
  })
  it('가드 거부 → 오류 그대로, 조회 없음', async () => {
    mocks.requireProjectMember.mockResolvedValue(DENIED)
    expect(await refreshAgentHub(P1)).toEqual(DENIED)
    expect(mocks.getAgentHub).not.toHaveBeenCalled()
  })
  it('조회 throw → 고정 문구', async () => {
    mocks.getAgentHub.mockRejectedValue(new Error('db'))
    expect(await refreshAgentHub(P1)).toEqual({ ok: false, error: '에이전트 현황 재조회에 실패했습니다.' })
  })
  it('잘못된 projectId → 거부', async () => {
    expect(await refreshAgentHub('nope')).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
})

describe('applyHubDelegations — 묶음 1건: 가드 1회 → 항목별 applyDelegation → 허브 재조회를 한 응답에', () => {
  it('관리자: 보낸 순서대로 applyDelegation(isAdmin=true), 실패·경고는 항목별로 모으고 허브를 돌려준다', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    adminClient([{ id: I(1) }, { id: I(2) }, { id: I(3) }])
    mocks.applyDelegation
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: '리프 아님' })
      .mockResolvedValueOnce({ ok: true, warning: '중지 상태' })
    const r = await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }, { itemId: I(2), delegated: true }, { itemId: I(3), delegated: false }])
    expect(r).toEqual({ ok: true, hub: HUB, failed: [{ itemId: I(2), error: '리프 아님' }], warnings: [{ itemId: I(3), warning: '중지 상태' }] })
    expect(mocks.applyDelegation).toHaveBeenCalledTimes(3)
    expect(mocks.applyDelegation.mock.calls[0][1]).toMatchObject({ itemId: I(1), projectId: P1, delegated: true, actorUserId: 'admin-1', isAdmin: true })
    expect(mocks.applyDelegation.mock.calls[2][1]).toMatchObject({ itemId: I(3), delegated: false })
    expect(mocks.getAgentHub).toHaveBeenCalledWith(P1, { userId: 'admin-1', isAdmin: true })
    // 관리자는 로스터 판정을 하지 않는다.
    expect(mocks.viewerEmail).not.toHaveBeenCalled(); expect(mocks.myMemberIds).not.toHaveBeenCalled()
  })
  it('멤버: 로스터 판정은 묶음당 1회, 담당자 본인 항목만 적용하고 남의 항목은 그 항목만 failed', async () => {
    adminClient([{ id: I(1), assignee_member_id: 'm1' }, { id: I(2), assignee_member_id: 'm2' }, { id: I(3), assignee_member_id: null }])
    mocks.viewerEmail.mockResolvedValue('me@x.com')
    mocks.myMemberIds.mockResolvedValue(['m1'])
    const r = await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }, { itemId: I(2), delegated: true }, { itemId: I(3), delegated: true }])
    expect(r).toEqual({
      ok: true, hub: HUB, warnings: [],
      failed: [
        { itemId: I(2), error: '담당자 본인 또는 프로젝트 관리자만 바꿀 수 있습니다.' },
        { itemId: I(3), error: '담당자 본인 또는 프로젝트 관리자만 바꿀 수 있습니다.' },
      ],
    })
    expect(mocks.applyDelegation).toHaveBeenCalledTimes(1)
    expect(mocks.applyDelegation.mock.calls[0][1]).toMatchObject({ itemId: I(1), actorUserId: 'member-1', isAdmin: false })
    expect(mocks.viewerEmail).toHaveBeenCalledTimes(1)
    expect(mocks.myMemberIds).toHaveBeenCalledTimes(1)
    expect(mocks.myMemberIds).toHaveBeenCalledWith(expect.anything(), { userId: 'member-1', userEmail: 'me@x.com', projectId: P1 })
  })
  it('멤버 로스터 판정 실패 → 묶음 전체 거부(fail-closed), 적용 0', async () => {
    adminClient([{ id: I(1), assignee_member_id: 'm1' }])
    mocks.viewerEmail.mockRejectedValue(new Error('auth down'))
    expect(await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }])).toEqual({ ok: false, error: '담당자 판정에 실패했습니다.' })
    expect(mocks.applyDelegation).not.toHaveBeenCalled()
  })
  it('타 프로젝트 항목이 섞이면 전부 거부', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    adminClient([{ id: I(1) }])
    expect(await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }, { itemId: I(2), delegated: true }]))
      .toEqual({ ok: false, error: '이 프로젝트의 항목이 아닌 것이 있습니다.' })
    expect(mocks.applyDelegation).not.toHaveBeenCalled()
  })
  it('항목 조회 실패 → 거부, 적용 0', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    adminClient([], { message: 'boom' })
    expect(await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }])).toEqual({ ok: false, error: '항목 조회 실패: boom' })
    expect(mocks.applyDelegation).not.toHaveBeenCalled()
  })
  it('같은 항목이 여러 번 오면 마지막 값만 1회 적용', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    adminClient([{ id: I(1) }])
    await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }, { itemId: I(1), delegated: false }])
    expect(mocks.applyDelegation).toHaveBeenCalledTimes(1)
    expect(mocks.applyDelegation.mock.calls[0][1]).toMatchObject({ itemId: I(1), delegated: false })
  })
  it('저장 뒤 재조회만 실패 → ok:true + hub:null + hubError (변경은 이미 저장됐다는 사실을 숨기지 않는다)', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    adminClient([{ id: I(1) }])
    mocks.getAgentHub.mockRejectedValue(new Error('db'))
    const r = await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }])
    expect(r).toEqual({ ok: true, hub: null, hubError: '변경은 저장됐지만 현황 재조회에 실패했습니다. 새로고침을 누르세요.', failed: [], warnings: [] })
    expect(mocks.applyDelegation).toHaveBeenCalledTimes(1)
  })
  it('가드 거부 → 오류 그대로, 조회·적용 없음', async () => {
    mocks.requireProjectMember.mockResolvedValue(DENIED)
    expect(await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }])).toEqual(DENIED)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('빈 목록·200 초과·비 uuid·비 boolean → 거부', async () => {
    const BAD = { ok: false, error: '잘못된 요청입니다.' }
    expect(await applyHubDelegations(P1, [])).toEqual(BAD)
    expect(await applyHubDelegations(P1, Array.from({ length: 201 }, (_, i) => ({ itemId: I(i % 10), delegated: true })))).toEqual(BAD)
    expect(await applyHubDelegations(P1, [{ itemId: 'x', delegated: true }])).toEqual(BAD)
    expect(await applyHubDelegations(P1, [{ itemId: I(1), delegated: 'yes' as unknown as boolean }])).toEqual(BAD)
    expect(await applyHubDelegations('nope', [{ itemId: I(1), delegated: true }])).toEqual(BAD)
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
  })
  it('허브 액션은 revalidatePath 를 부르지 않는다 — 응답의 hub 로 갱신하며 페이지 재렌더를 싣지 않는다(소스 문자열 검사)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/actions/agentHub.ts'), 'utf8')
    expect(src).not.toMatch(/revalidatePath\(/)
  })
})

describe('runHubProcessOp — 멤버 이상 가드 → 이 프로젝트 것인지 → 기존 액션 → 허브 재조회를 한 응답에(§11)', () => {
  const ORDERS = { [O(1)]: { project_id: P1, status: 'reported', wbs_item_id: I(1) }, [O(2)]: { project_id: P2, status: 'reported', wbs_item_id: null } }
  const ITEMS = { [I(1)]: { project_id: P1, name: '입측 화면', assignee_member_id: 'm1' }, [I(2)]: { project_id: P2 } }
  // 이 블록의 기본 화자는 관리자 — 승인·회수·단계·재조회 isAdmin 을 확인한다. 멤버 경로는 아래 별도 블록.
  beforeEach(() => { mocks.requireProjectMember.mockResolvedValue(ADMIN) })

  it('approve → approveAgentCompletion(orderId) → hub(isAdmin=true); reject·unapprove·rework 도 각 액션으로', async () => {
    fakeAdmin({ orders: ORDERS })
    expect(await runHubProcessOp(P1, { kind: 'approve', orderId: O(1) })).toEqual({ ok: true, hub: HUB })
    expect(mocks.approve).toHaveBeenCalledWith(O(1))
    expect(mocks.getAgentHub).toHaveBeenCalledWith(P1, { userId: 'admin-1', isAdmin: true })
    await runHubProcessOp(P1, { kind: 'reject', orderId: O(1), note: '다시' })
    expect(mocks.reject).toHaveBeenCalledWith(O(1), '다시')
    await runHubProcessOp(P1, { kind: 'unapprove', orderId: O(1) })
    expect(mocks.unapprove).toHaveBeenCalledWith(O(1))
    await runHubProcessOp(P1, { kind: 'rework', orderId: O(1), note: '테스트 빠짐' })
    expect(mocks.rework).toHaveBeenCalledWith(O(1), '테스트 빠짐')
  })
  it('stage → 항목이 이 프로젝트 것인지 본 뒤 setWbsStage(itemId, stage); null(미지정)도 통과', async () => {
    fakeAdmin({ items: ITEMS })
    expect(await runHubProcessOp(P1, { kind: 'stage', itemId: I(1), stage: 'ip' })).toEqual({ ok: true, hub: HUB })
    expect(mocks.setWbsStage).toHaveBeenCalledWith(I(1), 'ip')
    // fp 는 0096 에서 어휘에서 빠졌다 — 형식 검사에서 거부하고 내부 액션을 부르지 않는다.
    mocks.setWbsStage.mockClear()
    expect(await runHubProcessOp(P1, { kind: 'stage', itemId: I(1), stage: 'fp' as never })).toEqual({ ok: false, error: '잘못된 요청입니다.' })
    expect(mocks.setWbsStage).not.toHaveBeenCalled()
    await runHubProcessOp(P1, { kind: 'stage', itemId: I(1), stage: null })
    expect(mocks.setWbsStage).toHaveBeenCalledWith(I(1), null)
  })
  it('release → claimed 만, 전이 RPC(release 사건 — 점유·heartbeat 흔적 제거는 DB 가 한다), work.released 알림을 배정자에게', async () => {
    const { updates, rpcCalls } = fakeAdmin({ orders: { [O(1)]: { project_id: P1, status: 'claimed', wbs_item_id: I(1) } }, items: ITEMS })
    expect(await runHubProcessOp(P1, { kind: 'release', orderId: O(1) })).toEqual({ ok: true, hub: HUB })
    expect(updates).toHaveLength(0)
    expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'release', p_order_id: O(1), p_actor: 'admin-1', p_agent: null, p_agent_user_id: null })])
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.released', projectId: P1, actorUserId: 'admin-1', entityType: 'agent_order', entityId: O(1),
      payload: expect.objectContaining({ title: '입측 화면', detail: '관리자가 작업을 회수했습니다' }),
      recipientMemberIds: ['m1'],
    }))
  })
  it('release — claimed 가 아니면 거부, 전이 RPC 가 경합(conflict)이면 재시도 문구', async () => {
    fakeAdmin({ orders: ORDERS })
    expect(await runHubProcessOp(P1, { kind: 'release', orderId: O(1) })).toEqual({ ok: false, error: '회수할 수 있는 상태가 아닙니다(reported).' })
    const { rpcCalls } = fakeAdmin({ orders: { [O(1)]: { project_id: P1, status: 'claimed', wbs_item_id: I(1) } }, rpc: { data: { ok: false, conflict: true, order_status: 'ready' } } })
    expect(await runHubProcessOp(P1, { kind: 'release', orderId: O(1) })).toEqual({ ok: false, error: '상태가 바뀌어 회수하지 못했습니다. 다시 시도하세요.' })
    expect(rpcCalls).toHaveLength(1)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })
  it('타 프로젝트 주문·항목 → 거부, 내부 액션 미호출', async () => {
    fakeAdmin({ orders: ORDERS, items: ITEMS })
    expect(await runHubProcessOp(P1, { kind: 'approve', orderId: O(2) })).toEqual({ ok: false, error: '이 프로젝트의 주문이 아닙니다.' })
    expect(await runHubProcessOp(P1, { kind: 'approve', orderId: O(3) })).toEqual({ ok: false, error: '이 프로젝트의 주문이 아닙니다.' })
    expect(await runHubProcessOp(P1, { kind: 'stage', itemId: I(2), stage: 'as' })).toEqual({ ok: false, error: '이 프로젝트의 항목이 아닙니다.' })
    expect(mocks.approve).not.toHaveBeenCalled(); expect(mocks.setWbsStage).not.toHaveBeenCalled()
    expect(mocks.getAgentHub).not.toHaveBeenCalled()
  })
  it('내부 액션 실패 → 오류 그대로, 재조회 없음; warning 은 응답에 싣는다', async () => {
    fakeAdmin({ orders: ORDERS })
    mocks.approve.mockResolvedValueOnce({ ok: false, error: '승인 가능한 상태가 아닙니다(claimed).' })
    expect(await runHubProcessOp(P1, { kind: 'approve', orderId: O(1) })).toEqual({ ok: false, error: '승인 가능한 상태가 아닙니다(claimed).' })
    expect(mocks.getAgentHub).not.toHaveBeenCalled()
    mocks.unapprove.mockResolvedValueOnce({ ok: true, warning: '실적을 되돌리지 않았습니다' })
    expect(await runHubProcessOp(P1, { kind: 'unapprove', orderId: O(1) })).toEqual({ ok: true, hub: HUB, warning: '실적을 되돌리지 않았습니다' })
  })
  it('재조회만 실패 → ok:true + hub:null + hubError', async () => {
    fakeAdmin({ orders: ORDERS })
    mocks.getAgentHub.mockRejectedValueOnce(new Error('db'))
    expect(await runHubProcessOp(P1, { kind: 'approve', orderId: O(1) }))
      .toEqual({ ok: true, hub: null, hubError: '처리는 됐지만 현황 재조회에 실패했습니다. 새로고침을 누르세요.' })
  })
  it('멤버도 아님(조회 전용) → 거부; 입력 검증(kind·uuid·note·stage 코드)', async () => {
    mocks.requireProjectMember.mockResolvedValueOnce(DENIED)
    expect(await runHubProcessOp(P1, { kind: 'approve', orderId: O(1) })).toEqual(DENIED)
    const BAD = { ok: false, error: '잘못된 요청입니다.' }
    expect(await runHubProcessOp('nope', { kind: 'approve', orderId: O(1) })).toEqual(BAD)
    expect(await runHubProcessOp(P1, { kind: 'approve', orderId: 'x' })).toEqual(BAD)
    expect(await runHubProcessOp(P1, { kind: 'reject', orderId: O(1) } as never)).toEqual(BAD)
    expect(await runHubProcessOp(P1, { kind: 'stage', itemId: I(1), stage: 'zz' } as never)).toEqual(BAD)
    expect(await runHubProcessOp(P1, { kind: 'nuke', orderId: O(1) } as never)).toEqual(BAD)
    expect(await runHubProcessOp(P1, null as never)).toEqual(BAD)
    expect(mocks.requireProjectMember).toHaveBeenCalledTimes(1)
  })

  describe('멤버(비관리자) — 반려·승인 취소·재작업은 내부 액션(자격은 그쪽)으로, 회수는 여기서 관리자 또는 서브트리 관리자로 좁힌다(트랙 B)', () => {
    beforeEach(() => {
      mocks.requireProjectMember.mockResolvedValue(MEMBER)
      // requireSubtreeManagerOrAdmin(subtreeManager.ts, 실제 모듈)의 내부 admin fast path 를
      // 이 블록에서는 확실히 막는다 — 안 막으면 최상단 beforeEach 의 requireProjectAdmin 기본값
      // (ADMIN, ok:true)이 그대로 살아 있어 "멤버" 시나리오에서도 회수가 새어 나간다.
      mocks.requireProjectAdmin.mockResolvedValue(DENIED)
      mocks.isSubtreeManager.mockResolvedValue(false)
    })
    it('멤버의 반려는 통과 → rejectAgentCompletion 호출, 허브는 isAdmin=false 로 재조회', async () => {
      fakeAdmin({ orders: ORDERS })
      expect(await runHubProcessOp(P1, { kind: 'reject', orderId: O(1), note: '다시' })).toEqual({ ok: true, hub: HUB })
      expect(mocks.reject).toHaveBeenCalledWith(O(1), '다시')
      expect(mocks.getAgentHub).toHaveBeenCalledWith(P1, { userId: 'member-1', isAdmin: false })
    })
    it('서브트리 관리자가 아닌 멤버의 회수는 여기서 막는다 — 내부 액션·재조회 없음', async () => {
      fakeAdmin({ orders: { [O(1)]: { project_id: P1, status: 'claimed', wbs_item_id: I(1) } } })
      expect(await runHubProcessOp(P1, { kind: 'release', orderId: O(1) }))
        .toEqual({ ok: false, error: '회수는 관리자 또는 서브트리 관리자만 할 수 있습니다.' })
      expect(mocks.emitNotification).not.toHaveBeenCalled()
      expect(mocks.getAgentHub).not.toHaveBeenCalled()
    })
    it('WBS 항목이 삭제된 주문(wbs_item_id 없음)의 회수는 조상을 특정 못 해 관리자만', async () => {
      fakeAdmin({ orders: { [O(1)]: { project_id: P1, status: 'claimed', wbs_item_id: null } } })
      expect(await runHubProcessOp(P1, { kind: 'release', orderId: O(1) }))
        .toEqual({ ok: false, error: '회수는 관리자만 할 수 있습니다.' })
      expect(mocks.isSubtreeManager).not.toHaveBeenCalled()
    })
    it('서브트리 관리자인 멤버의 회수는 허용 — requireSubtreeManagerOrAdmin 을 통해 통과(트랙 B)', async () => {
      mocks.viewerEmail.mockResolvedValue('anc@x.com')
      mocks.myMemberIds.mockResolvedValue(['anc-member'])
      mocks.isSubtreeManager.mockResolvedValue(true)
      const { rpcCalls } = fakeAdmin({ orders: { [O(1)]: { project_id: P1, status: 'claimed', wbs_item_id: I(1) } }, items: ITEMS })
      expect(await runHubProcessOp(P1, { kind: 'release', orderId: O(1) })).toEqual({ ok: true, hub: HUB })
      expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'release', p_actor: 'member-1' })])
      expect(mocks.isSubtreeManager).toHaveBeenCalledWith(
        expect.anything(), { itemId: I(1), projectId: P1, myMemberIds: ['anc-member'] },
      )
      expect(mocks.getAgentHub).toHaveBeenCalledWith(P1, { userId: 'member-1', isAdmin: false })
    })
    it('멤버의 승인 취소·재작업도 내부 액션으로 넘어간다(자격 판정은 loadOrderForReview)', async () => {
      fakeAdmin({ orders: { [O(1)]: { project_id: P1, status: 'approved', wbs_item_id: I(1) } } })
      await runHubProcessOp(P1, { kind: 'unapprove', orderId: O(1) })
      expect(mocks.unapprove).toHaveBeenCalledWith(O(1))
      await runHubProcessOp(P1, { kind: 'rework', orderId: O(1), note: '테스트 빠짐' })
      expect(mocks.rework).toHaveBeenCalledWith(O(1), '테스트 빠짐')
    })
  })
})
