// tests/actions/design-actions.test.ts — 설계 방식·세 버튼 서버 액션(설계 상태 스펙 7절). 권한·순서·CAS·실패 문구를 고정한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveProjectId: vi.fn(), requireProjectMember: vi.fn(), createAdminClient: vi.fn(),
  requireDelegationRight: vi.fn(), applyDelegation: vi.fn(), applyWorkflowEvent: vi.fn(),
  loadDesignTarget: vi.fn(), after: vi.fn(), recordProgressSnapshot: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ resolveProjectId: mocks.resolveProjectId, requireProjectMember: mocks.requireProjectMember }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('@/lib/agent/delegation', () => ({ requireDelegationRight: mocks.requireDelegationRight, applyDelegation: mocks.applyDelegation }))
// 전이 RPC 만 목으로 바꾸고 나머지(SKIPPED_WARN 등)는 실제 모듈 그대로 둔다 — 목에 없는 이름은 그 경로를 탈 때만 터진다.
vi.mock('@/lib/agent/workflowEvent', async (orig) => ({ ...(await orig<typeof import('@/lib/agent/workflowEvent')>()), applyWorkflowEvent: mocks.applyWorkflowEvent }))
vi.mock('@/lib/agent/designPanel', async (orig) => ({ ...(await orig<typeof import('@/lib/agent/designPanel')>()), loadDesignTarget: mocks.loadDesignTarget }))

import { designAccept, designConfirm, designReopen, getDesignPanel, setDelegationAndMode } from '@/app/actions/designActions'
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
  active: { id: O1, status: 'claimed', designState: 'review', runner: null, lastHeartbeatAt: null, heartbeatPhase: 'wait_review', designNote: null },
  ...over,
})
/** 구현자동(human) 작업의 ready 주문 — 「설계 확정」 자리. */
const humanReady = () => target({
  orderStatuses: ['ready'],
  item: { mode: 'human', stage: 'as', actualPct: 0, delegated: true, hasApprovedOrder: false, preds: 'met' },
  active: { id: O1, status: 'ready', designState: null, runner: null, lastHeartbeatAt: null, heartbeatPhase: null, designNote: null },
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
    const accepted = { id: O1, status: 'claimed', designState: 'accepted', runner: null, lastHeartbeatAt: null, heartbeatPhase: null, designNote: null }
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
  it('처리는 됐지만 단계·실적을 건너뛰었으면 경고로 알린다', async () => {
    admin(null)
    mocks.loadDesignTarget.mockResolvedValue(humanReady())
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: true, actualChanged: false, skipped: 'parent' })
    expect(await designConfirm(W1)).toEqual({ ok: true, warning: SKIPPED_WARN.parent })
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
