// 강제 진행 본체(스펙 2026-09-23 §3.2·F8·F12). 'use server' 파일이 아니다 — 가드 없는 본체를 액션 모듈에 두면
// 누구나 부를 수 있는 액션이 된다(delegation.ts 와 같은 분리).
import type { AdminClient } from '@/lib/minutes/externalApi'
import { WAIVE_BLOCK_TEXT } from '@/lib/domain/forceProgress'
import { ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'

export const WAIVER_REASON_TEXT: Record<string, string> = {
  ...WAIVE_BLOCK_TEXT,
  reason_required: '사유를 입력하세요.',
  item_not_found: '항목 없음',
  pred_not_found: '선행 작업을 프로젝트에서 찾을 수 없습니다.',
}

export async function applyWaiver(
  admin: AdminClient,
  a: { projectId: string; itemId: string; predRef: string; waive: boolean; reason: string; actorUserId: string },
): Promise<{ ok: true; subTaskId: string | null; subTaskCreated: boolean; warning?: string } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc('set_dependency_waiver', {
    p_item_id: a.itemId, p_pred_ref: a.predRef, p_waive: a.waive, p_reason: a.reason, p_actor: a.actorUserId,
  })
  if (error) return { ok: false, error: `강제 진행 처리 실패: ${error.message}` }
  const r = (data ?? {}) as { ok?: boolean; reason?: string; sub_task_id?: string | null; sub_task_created?: boolean }
  if (r.ok !== true) return { ok: false, error: WAIVER_REASON_TEXT[r.reason ?? ''] ?? `강제 진행 처리 실패(${r.reason ?? 'unknown'})` }
  const subTaskId = r.sub_task_id ?? null
  const subTaskCreated = r.sub_task_created === true
  if (subTaskId) {
    // 하위 주문은 트랜잭션 밖에서 보장한다 — 실패해도 면제·하위는 이미 커밋됐고, 위임 토글·백필이 다시 만든다(멱등).
    const ord = await ensureOrderForWorkflowLeaf(admin, { projectId: a.projectId, wbsItemId: subTaskId, actorUserId: a.actorUserId })
    if (!ord.ok) {
      console.error('[forceProgress] 하위 주문 보장 실패:', subTaskId, ord.error)
      return { ok: true, subTaskId, subTaskCreated, warning: `스텁 제거 작업은 만들었지만 주문 발행에 실패했습니다 — ${ord.error}` }
    }
  }
  return { ok: true, subTaskId, subTaskCreated }
}

export const ERR_NOT_STUB = '스텁 제거 작업이 아닙니다.'
export const ERR_STUB_HELD = '에이전트가 작업 중이거나 보고한 스텁 제거 작업은 취소할 수 없습니다 — 중단·반려로 먼저 정리하세요.'

/** F12 — 스텁이 아직 없을 때 사람이 하위 Task 를 치운다. ready 주문 취소 → 행 삭제. 에이전트가 쥐었으면 거부. */
export async function cancelStub(admin: AdminClient, subTaskId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: orders, error: oErr } = await admin.from('agent_work_orders').select('id, status')
    .eq('wbs_item_id', subTaskId).in('status', ['ready', 'claimed', 'reported'])
  if (oErr) return { ok: false, error: `주문 조회 실패: ${oErr.message}` }
  const list = (orders ?? []) as Array<{ id: string; status: string }>
  if (list.some(o => o.status !== 'ready')) return { ok: false, error: ERR_STUB_HELD }
  if (list.length > 0) {
    const { data: done, error: cErr } = await admin.from('agent_work_orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('id', list.map(o => o.id)).eq('status', 'ready').select('id')
    if (cErr) return { ok: false, error: `주문 취소 실패: ${cErr.message}` }
    if (((done ?? []) as unknown[]).length !== list.length) return { ok: false, error: '상태가 바뀌어 취소하지 못했습니다. 다시 시도하세요.' }
  }
  const { data: del, error: dErr } = await admin.from('wbs_items').delete().eq('id', subTaskId).not('stub_for', 'is', null).select('id')
  if (dErr) return { ok: false, error: `삭제 실패: ${dErr.message}` }
  if (((del ?? []) as unknown[]).length === 0) return { ok: false, error: ERR_NOT_STUB }
  return { ok: true }
}
