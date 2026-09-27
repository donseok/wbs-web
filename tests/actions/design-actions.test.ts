// tests/actions/design-actions.test.ts — 설계 방식·세 버튼 서버 액션(설계 상태 스펙 7절). 권한·순서·CAS·실패 문구를 고정한다.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveProjectId: vi.fn(), requireProjectMember: vi.fn(), createAdminClient: vi.fn(),
  requireDelegationRight: vi.fn(), applyDelegation: vi.fn(), applyWorkflowEvent: vi.fn(),
  loadDesignTarget: vi.fn(), after: vi.fn(), recordProgressSnapshot: vi.fn(), revalidatePath: vi.fn(),
  // 아래 "옮겨 온 단언"이 실제 위임 모듈(importActual)을 부를 때 그 모듈이 기대는 것들
  requireProjectAdmin: vi.fn(), myMemberIds: vi.fn(), viewerEmail: vi.fn(),
  ensureAgentProject: vi.fn(), backfillProjectOrders: vi.fn(), ensureOrderForWorkflowLeaf: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  resolveProjectId: mocks.resolveProjectId, requireProjectMember: mocks.requireProjectMember, requireProjectAdmin: mocks.requireProjectAdmin,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('@/lib/agent/delegation', () => ({
  requireDelegationRight: mocks.requireDelegationRight, applyDelegation: mocks.applyDelegation,
  ERR_NOT_ASSIGNEE: '담당자 본인 또는 프로젝트 관리자만 바꿀 수 있습니다.',
}))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: mocks.myMemberIds }))
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: mocks.viewerEmail, DONE_WINDOW_MS: 0 }))
vi.mock('@/lib/agent/ensureOrder', () => ({
  ensureAgentProject: mocks.ensureAgentProject, backfillProjectOrders: mocks.backfillProjectOrders,
  ensureOrderForWorkflowLeaf: mocks.ensureOrderForWorkflowLeaf,
}))
// 전이 RPC 만 목으로 바꾸고 나머지(SKIPPED_WARN 등)는 실제 모듈 그대로 둔다 — 목에 없는 이름은 그 경로를 탈 때만 터진다.
vi.mock('@/lib/agent/workflowEvent', async (orig) => ({ ...(await orig<typeof import('@/lib/agent/workflowEvent')>()), applyWorkflowEvent: mocks.applyWorkflowEvent }))
vi.mock('@/lib/agent/designPanel', async (orig) => ({ ...(await orig<typeof import('@/lib/agent/designPanel')>()), loadDesignTarget: mocks.loadDesignTarget }))

import { designAccept, designConfirm, designReopen, getDesignPanel, setDelegationAndMode } from '@/app/actions/designActions'
import { updateAgentPrompt } from '@/app/actions/wbsSpec'
import { SKIPPED_WARN } from '@/lib/agent/workflowEvent'

const P1 = '11111111-1111-4111-8111-111111111111'
const W1 = '33333333-3333-4333-8333-333333333333'
const O1 = '44444444-4444-4444-8444-444444444444'
const RIGHT = { ok: true, actor: { userId: 'u1' }, projectId: P1, isAdmin: false }
const DENIED = { ok: false, error: '담당자 본인 또는 프로젝트 관리자만 바꿀 수 있습니다.' }
const LOCKED = '설계가 확정·검토 중이거나 에이전트가 작업 중이라 설계 방식을 바꿀 수 없습니다.'

/** wbs_items.design_mode 한 번 읽기 흉내 — 고른 열을 기록한다(select 에서 design_mode 가 빠지면 드러나게). */
function admin(row: { design_mode: string | null } | null, error: { message: string } | null = null) {
  const selected: string[] = []
  const client = { from: vi.fn(() => {
    const b: Record<string, unknown> = {}
    b.select = (cols: string) => { selected.push(cols); return b }
    b.eq = () => b
    b.maybeSingle = async () => ({ data: error ? null : row, error })
    return b
  }) }
  mocks.createAdminClient.mockReturnValue(client)
  return { client, selected }
}
const target = (over: Record<string, unknown> = {}) => ({
  itemId: W1, projectId: P1, lastReview: null, orderStatuses: ['claimed'],
  item: { mode: 'review', stage: 'dd', actualPct: 20, delegated: true, hasApprovedOrder: false, preds: 'met' },
  active: { id: O1, status: 'claimed', designState: 'review', runner: null, lastHeartbeatAt: null, heartbeatPhase: 'wait_review', designNote: null, claimedBy: null },
  ...over,
})
/** 구현자동(human) 작업의 ready 주문 — 「설계 확정」 자리. */
const humanReady = () => target({
  orderStatuses: ['ready'],
  item: { mode: 'human', stage: 'as', actualPct: 0, delegated: true, hasApprovedOrder: false, preds: 'met' },
  active: { id: O1, status: 'ready', designState: null, runner: null, lastHeartbeatAt: null, heartbeatPhase: null, designNote: null, claimedBy: null },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireDelegationRight.mockResolvedValue(RIGHT)
  mocks.applyDelegation.mockResolvedValue({ ok: true })
  mocks.applyWorkflowEvent.mockResolvedValue({ ok: true, designModeChanged: true, actualChanged: false, skipped: null })
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'u1' } })
})

describe('setDelegationAndMode — 위임 표식과 설계 방식을 한 번에(스펙 7절)', () => {
  it('위임을 켤 때 방식이 바뀌면 방식을 먼저 쓰고 위임을 나중에 쓴다', async () => {
    const { selected } = admin({ design_mode: 'auto' })
    const order: string[] = []
    mocks.applyWorkflowEvent.mockImplementation(async () => { order.push('mode'); return { ok: true, designModeChanged: true } })
    mocks.applyDelegation.mockImplementation(async () => { order.push('delegate'); return { ok: true } })
    expect(await setDelegationAndMode(W1, true, 'review')).toEqual({ ok: true, modeChanged: true })
    expect(order).toEqual(['mode', 'delegate'])
    expect(selected).toEqual(['design_mode'])
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), { event: 'set_design_mode', actorUserId: 'u1', itemId: W1, mode: 'review' })
    expect(mocks.applyDelegation).toHaveBeenCalledWith(expect.anything(), { itemId: W1, projectId: P1, delegated: true, actorUserId: 'u1', isAdmin: false })
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/p/${P1}`, 'layout')
  })
  it('방식이 그대로면 방식 사건을 부르지 않는다(승인 이력이 있는 항목의 재위임이 방식 잠금에 막히지 않게) — 빈 방식은 auto', async () => {
    admin({ design_mode: 'review' })
    expect(await setDelegationAndMode(W1, true, 'review')).toEqual({ ok: true, modeChanged: false })
    admin({ design_mode: null })
    expect(await setDelegationAndMode(W1, true, 'auto')).toEqual({ ok: true, modeChanged: false })
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
    expect(mocks.applyDelegation).toHaveBeenCalledTimes(2)
  })
  it('해제면 위임을 먼저 풀고(주문 취소로 방식 잠금이 풀린다) 방식을 쓴다 — 실적이 바뀌었으면 스냅샷', async () => {
    admin({ design_mode: 'review' })
    const order: string[] = []
    mocks.applyWorkflowEvent.mockImplementation(async () => { order.push('mode'); return { ok: true, designModeChanged: true } })
    mocks.applyDelegation.mockImplementation(async () => { order.push('delegate'); return { ok: true, cancelledClaimedIds: [O1], actualChanged: true } })
    expect(await setDelegationAndMode(W1, false, 'human')).toEqual({ ok: true, cancelledClaimedIds: [O1], actualChanged: true, modeChanged: true })
    expect(order).toEqual(['delegate', 'mode'])
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })
  it('방식이 잠겨 있으면(design_mode_locked) 위임을 건드리지 않고 사유를 돌려준다', async () => {
    admin({ design_mode: 'auto' })
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: false, conflict: false, reason: 'design_mode_locked', orderStatus: null, error: LOCKED })
    expect(await setDelegationAndMode(W1, true, 'human')).toEqual({ ok: false, error: LOCKED })
    expect(mocks.applyDelegation).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
  it('켤 때 방식은 바뀌었는데 위임이 실패하면 실패와 함께 modeChanged 를 싣는다(화면이 바뀐 방식을 알게)', async () => {
    admin({ design_mode: 'auto' })
    mocks.applyDelegation.mockResolvedValue({ ok: false, error: '프로젝트 에이전트가 꺼져 있습니다. 관리자가 에이전트 페이지에서 켜야 합니다.' })
    expect(await setDelegationAndMode(W1, true, 'human'))
      .toEqual({ ok: false, error: '프로젝트 에이전트가 꺼져 있습니다. 관리자가 에이전트 페이지에서 켜야 합니다.', modeChanged: true })
  })
  it('해제 뒤 방식 쓰기가 실패하면 위임 해제는 성공으로 두고 경고한다(로그도 남긴다)', async () => {
    admin({ design_mode: 'review' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: false, conflict: false, reason: 'rpc_error', orderStatus: null, error: '전이 실패: x' })
    const r = await setDelegationAndMode(W1, false, 'human')
    expect(r).toMatchObject({ ok: true, modeChanged: false })
    expect(r.warning).toBe('위임은 풀었지만 설계 방식을 바꾸지 못했습니다 — 전이 실패: x')
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('현재 방식을 읽지 못하면 아무것도 쓰지 않는다(에러 3원칙 ②), 항목이 없으면 대상 없음', async () => {
    admin(null, { message: 'db' })
    expect(await setDelegationAndMode(W1, true, 'review')).toEqual({ ok: false, error: '항목 조회 실패: db' })
    admin(null)
    expect(await setDelegationAndMode(W1, true, 'review')).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
    expect(mocks.applyDelegation).not.toHaveBeenCalled()
  })
  it('잘못된 입력·권한 없음은 거부', async () => {
    const BAD = { ok: false, error: '잘못된 요청입니다.' }
    expect(await setDelegationAndMode(W1, true, 'weird' as never)).toEqual(BAD)
    expect(await setDelegationAndMode(W1, 'yes' as never, 'auto')).toEqual(BAD)
    expect(await setDelegationAndMode('nope', true, 'auto')).toEqual(BAD)
    expect(mocks.requireDelegationRight).not.toHaveBeenCalled()
    mocks.requireDelegationRight.mockResolvedValue(DENIED)
    expect(await setDelegationAndMode(W1, true, 'auto')).toEqual(DENIED)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})

describe('설계 세 버튼 — 서버 판정으로 다시 보고, CAS 로 쓴다', () => {
  it('「설계 승인」 — 버튼이 서버 판정에도 있을 때만 design_accept 를 CAS 와 함께 부른다', async () => {
    admin(null)
    mocks.loadDesignTarget.mockResolvedValue(target())
    expect(await designAccept(W1)).toEqual({ ok: true })
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), {
      event: 'design_accept', actorUserId: 'u1', orderId: O1, note: null, cas: { design_state: 'review', design_mode: 'review' },
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/p/${P1}`, 'layout')
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it('「설계 확정」 — ready 주문에도 같은 design_accept 사건(RPC 가 주문 status 로 가른다), 실적이 바뀌면 스냅샷', async () => {
    admin(null)
    mocks.loadDesignTarget.mockResolvedValue(humanReady())
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: true, actualChanged: true, skipped: null })
    expect(await designConfirm(W1)).toEqual({ ok: true })
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), {
      event: 'design_accept', actorUserId: 'u1', orderId: O1, note: null, cas: { design_state: null, design_mode: 'human' },
    })
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })
  it('서버 판정에 버튼이 없으면 거부한다(화면이 낡았다) — 활성 주문이 없어도 같다', async () => {
    admin(null)
    mocks.loadDesignTarget.mockResolvedValue(target())
    expect(await designConfirm(W1)).toEqual({ ok: false, error: '지금은 누를 수 없습니다 — 화면을 새로 고친 뒤 다시 보세요.' })
    mocks.loadDesignTarget.mockResolvedValue(target({ active: null, orderStatuses: [] }))
    expect(await designAccept(W1)).toEqual({ ok: false, error: '지금은 누를 수 없습니다 — 화면을 새로 고친 뒤 다시 보세요.' })
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
  })
  it('CAS 충돌은 새로 고치라고 알리고, 그 밖의 전이 실패는 사유 문구 그대로', async () => {
    admin(null)
    mocks.loadDesignTarget.mockResolvedValue(target())
    mocks.applyWorkflowEvent.mockResolvedValueOnce({ ok: false, conflict: true, reason: 'conflict', orderStatus: 'claimed', error: 'x' })
    expect(await designAccept(W1)).toEqual({ ok: false, error: '그 사이 상태가 바뀌었습니다 — 화면을 새로 고친 뒤 다시 보세요.' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.applyWorkflowEvent.mockResolvedValueOnce({ ok: false, conflict: false, reason: 'design_gate', orderStatus: 'claimed', error: '설계 상태 때문에 처리할 수 없습니다.' })
    expect(await designAccept(W1)).toEqual({ ok: false, error: '설계 상태 때문에 처리할 수 없습니다.' })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
  it('「설계 되돌리기」 — 사유를 다듬어 싣고, 비면 서버 기본 사유', async () => {
    admin(null)
    const accepted = { id: O1, status: 'claimed', designState: 'accepted', runner: null, lastHeartbeatAt: null, heartbeatPhase: null, designNote: null, claimedBy: null }
    mocks.loadDesignTarget.mockResolvedValue(target({ active: accepted }))
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: true, actualChanged: true, skipped: null })
    expect(await designReopen(W1, '  테스트 전략이 모자람  ')).toEqual({ ok: true })
    expect(mocks.applyWorkflowEvent).toHaveBeenLastCalledWith(expect.anything(), {
      event: 'design_reopen', actorUserId: 'u1', orderId: O1, note: '테스트 전략이 모자람', cas: { design_state: 'accepted', design_mode: 'review' },
    })
    expect(mocks.after).toHaveBeenCalledTimes(1)
    await designReopen(W1, '   ')
    expect(mocks.applyWorkflowEvent).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ note: '사람이 설계를 되돌렸습니다.' }))
    await designReopen(W1, 'x'.repeat(600))
    expect(mocks.applyWorkflowEvent).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ note: 'x'.repeat(500) }))
  })
  it('처리는 됐지만 단계·실적을 건너뛰었으면 경고로 알린다 — parent 는 위임 해제 안내를 덧붙인다(SKIPPED_WARN 자체는 안 바꾼다)', async () => {
    admin(null)
    mocks.loadDesignTarget.mockResolvedValue(humanReady())
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: true, actualChanged: false, skipped: 'parent' })
    expect(await designConfirm(W1)).toEqual({ ok: true, warning: `${SKIPPED_WARN.parent} 이 주문을 끝내려면 위임을 해제하세요 — 주문이 취소됩니다.` })
    // parent 가 아닌 skipped 는 SKIPPED_WARN 그대로 — 덧붙이지 않는다.
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: true, actualChanged: false, skipped: 'stage' })
    expect(await designConfirm(W1)).toEqual({ ok: true, warning: SKIPPED_WARN.stage })
  })
  it('설계 상태를 읽지 못하면 조회 실패로 알리고(없음으로 위장하지 않는다), 항목이 없으면 대상 없음', async () => {
    admin(null)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.loadDesignTarget.mockRejectedValue(new Error('주문 조회 실패: db'))
    expect(await designAccept(W1)).toEqual({ ok: false, error: '설계 상태를 읽지 못했습니다.' })
    err.mockRestore()
    mocks.loadDesignTarget.mockResolvedValue(null)
    expect(await designAccept(W1)).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
  })
  it('위임 권한이 없으면 읽지도 쓰지도 않는다(D10), 잘못된 itemId 는 거부', async () => {
    admin(null)
    mocks.requireDelegationRight.mockResolvedValue(DENIED)
    expect(await designAccept(W1)).toEqual(DENIED)
    expect(await designReopen(W1, '이유')).toEqual(DENIED)
    expect(mocks.loadDesignTarget).not.toHaveBeenCalled()
    expect(await designConfirm('nope')).toEqual({ ok: false, error: '잘못된 요청입니다.' })
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
  })
})

describe('getDesignPanel — 멤버면 보고, 버튼은 위임 권한이 있을 때만', () => {
  it('위임 권한이 있으면 canAct=true, 없으면 false — 판정은 서버의 designPanelOf', async () => {
    admin(null)
    mocks.loadDesignTarget.mockResolvedValue(target())
    expect(await getDesignPanel(W1)).toMatchObject({ ok: true, canAct: true, panel: { designState: 'review', buttons: ['accept'], screen: { row: 1 } } })
    mocks.requireDelegationRight.mockResolvedValue(DENIED)
    expect(await getDesignPanel(W1)).toMatchObject({ ok: true, canAct: false, panel: { buttons: ['accept'] } })
  })
  it('위임 권한 판정이 담당자 아님이 아닌 이유로 실패하면 로그를 남긴다(담당자 아님은 정상 소음이라 남기지 않는다), canAct 은 그대로 boolean', async () => {
    admin(null)
    mocks.loadDesignTarget.mockResolvedValue(target())
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.requireDelegationRight.mockResolvedValue({ ok: false, error: '항목 조회 실패: db' })
    expect(await getDesignPanel(W1)).toMatchObject({ ok: true, canAct: false })
    expect(err).toHaveBeenCalledWith(expect.stringContaining('[designActions]'), '항목 조회 실패: db')
    err.mockClear()
    mocks.requireDelegationRight.mockResolvedValue(DENIED)
    expect(await getDesignPanel(W1)).toMatchObject({ ok: true, canAct: false })
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })
  it('멤버가 아니면 읽지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '권한이 없습니다.' })
    expect(await getDesignPanel(W1)).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(mocks.loadDesignTarget).not.toHaveBeenCalled()
  })
  it('조회 실패는 오류로(없음으로 위장하지 않는다), 항목이 없으면 대상 없음, 잘못된 itemId 는 거부', async () => {
    admin(null)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.loadDesignTarget.mockRejectedValue(new Error('x'))
    expect(await getDesignPanel(W1)).toEqual({ ok: false, error: '설계 상태를 읽지 못했습니다.' })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
    mocks.loadDesignTarget.mockResolvedValue(null)
    expect(await getDesignPanel(W1)).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(await getDesignPanel('nope')).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
})

// ── 옮겨 온 단언(Task 25) ────────────────────────────────────────────────────────────────────────
// setAgentDelegation 을 지우며 tests/actions/wbs-spec-delegation-right.test.ts 에서 옮겼다. 그 파일은 실제 위임 가드
// (requireDelegationRight)와 위임 본체(applyDelegation)를 검사하던 유일한 곳이다. 위 describe 들은 두 함수를 목으로 두므로
// 아래는 실제 모듈을 importActual 로 불러 자격 규칙(D10: 관리자 또는 담당자 본인)과 본체의 갈래를 고정한다.
// 해제 갈래는 공용 취소(Task 7, cancel 사건) 기준이다 — Task 7 이 그 파일에서 고친 취소 단언을 여기서 대신한다.

type Resp = { data?: unknown; error?: { message: string } | null }
/** 큐 기반 admin 목 — 테이블별 순차 응답 + update/insert payload 캡처 + 호출된 테이블 목록. */
function queueAdmin(queues: Record<string, Resp[]>) {
  const captured: Record<string, unknown[]> = {}
  const calls: string[] = []
  const client = {
    from: vi.fn((table: string) => {
      calls.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'neq', 'order', 'limit']) b[k] = () => b
      b.update = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { client, captured, calls }
}
const MEMBER = { ok: true, actor: { userId: 'member-1' } }
const GUARD_DENIED = { ok: false, error: '권한이 없습니다.' }
const actualDelegation = () => vi.importActual<typeof import('@/lib/agent/delegation')>('@/lib/agent/delegation')

describe('requireDelegationRight — 위임 권한은 관리자 또는 담당자 본인(D10, 실제 가드)', () => {
  let d: Awaited<ReturnType<typeof actualDelegation>>
  beforeAll(async () => { d = await actualDelegation() })
  beforeEach(() => {
    mocks.requireProjectAdmin.mockResolvedValue(GUARD_DENIED)
    mocks.requireProjectMember.mockResolvedValue(MEMBER)
    mocks.viewerEmail.mockResolvedValue('yoo@example.com')
    mocks.myMemberIds.mockResolvedValue(['m1'])
  })
  it('관리자면 멤버 판정·담당자 조회 없이 통과', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
    const { calls } = queueAdmin({})
    expect(await d.requireDelegationRight(W1)).toEqual({ ok: true, actor: { userId: 'admin-1' }, projectId: P1, isAdmin: true })
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })
  it('멤버 + 담당자 본인(로스터 id 일치) → 통과, isAdmin=false', async () => {
    queueAdmin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }] })
    expect(await d.requireDelegationRight(W1)).toEqual({ ok: true, actor: { userId: 'member-1' }, projectId: P1, isAdmin: false })
    expect(mocks.myMemberIds).toHaveBeenCalledWith(expect.anything(), { userId: 'member-1', userEmail: 'yoo@example.com', projectId: P1 })
  })
  it('멤버 + 담당자가 남 → 거부(ERR_NOT_ASSIGNEE)', async () => {
    queueAdmin({ wbs_items: [{ data: { assignee_member_id: 'm9' } }] })
    expect(await d.requireDelegationRight(W1)).toEqual({ ok: false, error: d.ERR_NOT_ASSIGNEE })
  })
  it('멤버 + 담당자 미배정 → 거부', async () => {
    queueAdmin({ wbs_items: [{ data: { assignee_member_id: null } }] })
    expect(await d.requireDelegationRight(W1)).toEqual({ ok: false, error: d.ERR_NOT_ASSIGNEE })
  })
  it('멤버도 아니면 멤버 가드 오류 그대로', async () => {
    mocks.requireProjectMember.mockResolvedValue(GUARD_DENIED)
    expect(await d.requireDelegationRight(W1)).toEqual(GUARD_DENIED)
  })
  it('resolveProjectId 실패면 담당자 조회 전에 중단', async () => {
    mocks.resolveProjectId.mockResolvedValue({ ok: false, error: '대상을 찾을 수 없습니다.' })
    const { calls } = queueAdmin({})
    expect(await d.requireDelegationRight(W1)).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(calls).toEqual([])
  })
  it('뷰어 이메일 조회가 throw 하면 거부(fail-closed)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    queueAdmin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }] })
    mocks.viewerEmail.mockRejectedValue(new Error('auth down'))
    expect((await d.requireDelegationRight(W1)).ok).toBe(false)
    err.mockRestore()
  })
  it('잘못된 itemId → 거부', async () => {
    expect(await d.requireDelegationRight('nope')).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
})

describe('applyDelegation — 위임 본체(멤버는 등록·활성 프로젝트에서만 켠다, 실제 본체)', () => {
  let d: Awaited<ReturnType<typeof actualDelegation>>
  beforeAll(async () => { d = await actualDelegation() })
  beforeEach(() => {
    mocks.ensureAgentProject.mockResolvedValue({ ok: true, enabled: true, activated: false, stopped: false })
    mocks.ensureOrderForWorkflowLeaf.mockResolvedValue({ ok: true, created: true })
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: true })
  })
  const asMember = (delegated: boolean) => ({ itemId: W1, projectId: P1, delegated, actorUserId: 'member-1', isAdmin: false })
  const asAdmin = (delegated: boolean) => ({ itemId: W1, projectId: P1, delegated, actorUserId: 'admin-1', isAdmin: true })
  const offQueues = (status: string) => ({
    wbs_items: [{ data: { tags: ['agent'], dev_workflow: true } }, { data: [{ id: W1 }] }],
    agent_work_orders: [{ data: [{ id: 'o1', status }] }],
  })

  it('멤버가 켜기 — 프로젝트가 등록·활성이면 태그를 붙이고 주문을 보장한다', async () => {
    const { client, captured } = queueAdmin({
      wbs_items: [{ data: { tags: [], dev_workflow: true } }, { data: [{ id: W1 }] }],
      agent_projects: [{ data: { enabled: true } }],
    })
    expect((await d.applyDelegation(client as never, asMember(true))).ok).toBe(true)
    expect((captured.wbs_items?.[0] as { tags: string[] }).tags).toEqual(['agent'])
    expect(mocks.ensureAgentProject).toHaveBeenCalled()
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalled()
  })
  it('멤버가 켜기 — 프로젝트가 등록되지 않았으면 ERR_AGENT_OFF, 태그 쓰기 0, 프로젝트를 켜지 않는다', async () => {
    const { client, captured } = queueAdmin({ wbs_items: [{ data: { tags: [], dev_workflow: true } }], agent_projects: [{ data: null }] })
    expect(await d.applyDelegation(client as never, asMember(true))).toEqual({ ok: false, error: d.ERR_AGENT_OFF })
    expect(captured.wbs_items).toBeUndefined()
    expect(mocks.ensureAgentProject).not.toHaveBeenCalled()
  })
  it('멤버가 켜기 — 프로젝트가 중지(enabled=false)면 ERR_AGENT_OFF', async () => {
    const { client } = queueAdmin({ wbs_items: [{ data: { tags: [], dev_workflow: true } }], agent_projects: [{ data: { enabled: false } }] })
    expect(await d.applyDelegation(client as never, asMember(true))).toEqual({ ok: false, error: d.ERR_AGENT_OFF })
  })
  it('멤버의 해제는 프로젝트 상태를 보지 않는다 — ready 주문은 cancel 사건 하나로 취소하고 단계는 따로 건드리지 않는다', async () => {
    const { client, calls } = queueAdmin(offQueues('ready'))
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: true, prevStatus: 'ready', actualChanged: false })
    expect(await d.applyDelegation(client as never, asMember(false))).toEqual({ ok: true })
    expect(calls).not.toContain('agent_projects')
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), { event: 'cancel', actorUserId: 'member-1', orderId: 'o1' })
  })
  it('해제가 claimed 주문을 취소하면 cancelledClaimedIds·actualChanged 를 싣는다 — 단계 되돌리기는 cancel 사건이 한다(D14)', async () => {
    const { client, calls } = queueAdmin(offQueues('claimed'))
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: true, prevStatus: 'claimed', actualChanged: true })
    expect(await d.applyDelegation(client as never, asMember(false))).toEqual({ ok: true, cancelledClaimedIds: ['o1'], actualChanged: true })
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledTimes(1)
    // 태그를 먼저 쓰고(wbs_items) 그 뒤에 활성 주문을 읽어 취소한다(agent_work_orders) — 옮기기 전 테스트의 순서 단언(D21).
    expect(calls.lastIndexOf('agent_work_orders')).toBeGreaterThan(calls.lastIndexOf('wbs_items'))
  })
  it('취소가 경합으로 막히면(conflict) 경고로 알리고, 그 밖의 취소 실패는 오류로 돌려준다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.applyWorkflowEvent.mockResolvedValueOnce({ ok: false, conflict: true, reason: 'conflict', orderStatus: 'reported', error: 'x' })
    const r = await d.applyDelegation(queueAdmin(offQueues('claimed')).client as never, asMember(false))
    expect(r.ok).toBe(true)
    expect(r.cancelledClaimedIds).toBeUndefined()
    expect(r.warning).toContain('완료 보고가 이미 올라왔거나 그 사이 다른 곳에서 상태가 바뀌었습니다')
    mocks.applyWorkflowEvent.mockResolvedValueOnce({ ok: false, conflict: false, reason: 'rpc_error', orderStatus: null, error: '전이 실패: boom' })
    expect(await d.applyDelegation(queueAdmin(offQueues('claimed')).client as never, asMember(false)))
      .toEqual({ ok: false, error: '주문 취소 실패: 전이 실패: boom' })
    err.mockRestore()
  })
  it('관리자 경로는 agent_projects 사전 확인 없이 ensureAgentProject 로 간다(종전 동작)', async () => {
    const { client, calls } = queueAdmin({ wbs_items: [{ data: { tags: [], dev_workflow: true } }, { data: [{ id: W1 }] }] })
    expect((await d.applyDelegation(client as never, asAdmin(true))).ok).toBe(true)
    expect(mocks.ensureAgentProject).toHaveBeenCalled()
    expect(calls.filter(t => t === 'agent_projects')).toEqual([])
  })
  it('dev_workflow 가 꺼져 있던 리프는 켜면서 이력 1건 + 담당자 있고 단계 없으면 assign 사건', async () => {
    const { client, captured } = queueAdmin({
      wbs_items: [
        { data: { tags: [], dev_workflow: false } },                                      // 본체 첫 조회
        { data: [{ id: W1 }] },                                                            // 태그 update
        { data: [{ id: W1, assignee_member_id: 'm1', stage: null }] },                     // dev_workflow update
      ],
    })
    expect((await d.applyDelegation(client as never, asAdmin(true))).ok).toBe(true)
    expect((captured.wbs_items?.[1] as { dev_workflow: boolean }).dev_workflow).toBe(true)
    expect((captured.change_logs?.[0] as { field: string; new_value: string })).toMatchObject({ field: 'dev_workflow', new_value: 'true', wbs_item_id: W1 })
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), { event: 'assign', actorUserId: 'admin-1', itemId: W1 })
  })
  it('프로젝트가 중지 상태면 태그는 붙고 주문은 안 나가며 warning 에 에이전트 페이지 안내', async () => {
    mocks.ensureAgentProject.mockResolvedValue({ ok: true, enabled: false, activated: false, stopped: true })
    const { client } = queueAdmin({ wbs_items: [{ data: { tags: [], dev_workflow: true } }, { data: [{ id: W1 }] }] })
    const r = await d.applyDelegation(client as never, asAdmin(true))
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('에이전트 페이지에서 켜면')
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
  })
})

describe('updateAgentPrompt — 자격은 위임 권한과 같다(관리자 또는 담당자 본인)', () => {
  it('위임 권한이 있으면(담당자 본인 포함) 다듬어 저장한다', async () => {
    const { captured } = queueAdmin({ wbs_items: [{ data: [{ id: W1 }] }] })
    expect(await updateAgentPrompt(W1, ' 지시 ')).toEqual({ ok: true })
    expect(mocks.requireDelegationRight).toHaveBeenCalledWith(W1)
    expect((captured.wbs_items?.[0] as { agent_prompt: string }).agent_prompt).toBe('지시')
  })
  it('위임 권한이 없으면 그 오류로 거부하고 쓰지 않는다', async () => {
    mocks.requireDelegationRight.mockResolvedValue(DENIED)
    const { captured } = queueAdmin({})
    expect(await updateAgentPrompt(W1, 'x')).toEqual(DENIED)
    expect(captured.wbs_items).toBeUndefined()
  })
})
