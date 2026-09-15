// 원자 전이 RPC 래퍼(스펙 2026-09-15 §4) — 인자 매핑·결과 파싱·사유 문구.
import { describe, expect, it, vi } from 'vitest'
import { applyWorkflowEvent, REASON_TEXT } from '@/lib/agent/workflowEvent'

function admin(reply: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn(async () => ({ data: reply.data ?? null, error: reply.error ?? null }))
  return { client: { rpc } as never, rpc }
}
const W1 = '33333333-3333-4333-8333-333333333333'
const O1 = '22222222-2222-4222-8222-222222222222'

describe('applyWorkflowEvent — RPC 인자 매핑·결과 파싱', () => {
  it('인자를 p_* 로 넘기고 성공 jsonb 를 camelCase 로 돌려준다', async () => {
    const { client, rpc } = admin({ data: { ok: true, order_status: 'approved', stage: 'xx', actual_pct: 100, stage_changed: true, actual_changed: true, reached_first: true, skipped: null } })
    const r = await applyWorkflowEvent(client, { event: 'approve', actorUserId: 'u1', orderId: O1 })
    expect(rpc).toHaveBeenCalledWith('apply_workflow_event', {
      p_event: 'approve', p_actor: 'u1', p_item_id: null, p_order_id: O1, p_stage: null, p_agent: null, p_agent_user_id: null,
    })
    expect(r).toEqual({ ok: true, orderStatus: 'approved', stage: 'xx', actualPct: 100, stageChanged: true, actualChanged: true, reachedFirst: true, skipped: null })
  })
  it('numeric 실적이 문자열로 와도 숫자로 바꾼다', async () => {
    const { client } = admin({ data: { ok: true, order_status: null, stage: 'im', actual_pct: '80', stage_changed: true, actual_changed: true, reached_first: true, skipped: null } })
    expect(await applyWorkflowEvent(client, { event: 'set_stage', actorUserId: 'u1', itemId: W1, stage: 'im' })).toMatchObject({ ok: true, actualPct: 80 })
  })
  it('conflict 는 ok:false·conflict:true·현재 status', async () => {
    const { client } = admin({ data: { ok: false, conflict: true, order_status: 'claimed' } })
    const r = await applyWorkflowEvent(client, { event: 'approve', actorUserId: 'u1', orderId: O1 })
    expect(r).toEqual({ ok: false, conflict: true, reason: 'conflict', orderStatus: 'claimed', error: REASON_TEXT.conflict })
  })
  it('reason 은 사람 문구로, 모르는 reason 도 감추지 않는다', async () => {
    const { client } = admin({ data: { ok: false, reason: 'locked' } })
    expect(await applyWorkflowEvent(client, { event: 'set_stage', actorUserId: 'u1', itemId: W1, stage: 'im' }))
      .toMatchObject({ ok: false, conflict: false, reason: 'locked', error: REASON_TEXT.locked })
    const { client: c2 } = admin({ data: { ok: false, reason: 'weird' } })
    expect(await applyWorkflowEvent(c2, { event: 'assign', actorUserId: 'u1', itemId: W1 })).toMatchObject({ ok: false, error: '전이 실패(weird)' })
  })
  it('RPC 오류는 rpc_error 로 그대로 드러낸다', async () => {
    const { client } = admin({ error: { message: 'boom' } })
    expect(await applyWorkflowEvent(client, { event: 'assign', actorUserId: 'u1', itemId: W1 })).toMatchObject({ ok: false, reason: 'rpc_error', error: '전이 실패: boom' })
  })
})
