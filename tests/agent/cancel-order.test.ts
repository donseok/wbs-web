// 공용 취소(D14) — 주문마다 cancel 사건 RPC. conflict 는 건너뛰고, 그 밖의 실패는 모은다.
import { describe, expect, it, vi } from 'vitest'
import { cancelOrders } from '@/lib/agent/cancelOrder'

const O1 = '22222222-2222-4222-8222-222222222222'
const O2 = '33333333-3333-4333-8333-333333333333'
function admin(replies: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const rpc = vi.fn(async () => { const r = replies.shift() ?? { data: null }; return { data: r.data ?? null, error: r.error ?? null } })
  return { client: { rpc } as never, rpc }
}
const ok = (prev: string, actualChanged = false) => ({ data: { ok: true, order_status: 'cancelled', prev_status: prev, stage: 'as', actual_pct: 0, stage_changed: actualChanged, actual_changed: actualChanged, reached_first: false, skipped: null } })

describe('cancelOrders', () => {
  it('주문마다 cancel 사건을 부르고 직전 status 를 모은다', async () => {
    const { client, rpc } = admin([ok('claimed', true), ok('ready')])
    const r = await cancelOrders(client, { orderIds: [O1, O2], actorUserId: 'u1' })
    expect(rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'cancel', p_order_id: O1, p_actor: 'u1' }))
    expect(r).toEqual({ cancelled: [{ id: O1, prevStatus: 'claimed' }, { id: O2, prevStatus: 'ready' }], conflicts: [], failed: [], actualChanged: true })
  })
  it('상태가 바뀐 주문은 conflicts, RPC 오류는 failed', async () => {
    const { client } = admin([{ data: { ok: false, conflict: true, order_status: 'reported' } }, { error: { message: 'boom' } }])
    const r = await cancelOrders(client, { orderIds: [O1, O2], actorUserId: 'u1' })
    expect(r.cancelled).toEqual([])
    expect(r.conflicts).toEqual([O1])
    expect(r.failed).toEqual([{ id: O2, error: '전이 실패: boom' }])
  })
  it('빈 목록이면 RPC 를 부르지 않는다', async () => {
    const { client, rpc } = admin([])
    expect(await cancelOrders(client, { orderIds: [], actorUserId: 'u1' })).toEqual({ cancelled: [], conflicts: [], failed: [], actualChanged: false })
    expect(rpc).not.toHaveBeenCalled()
  })
})
