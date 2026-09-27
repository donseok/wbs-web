import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { myMemberIds } from '@/lib/agent/assignee'
import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'
import { orderFactsOf } from '@/lib/agent/designFacts'

export const dynamic = 'force-dynamic'
const REASON_MAX = 500

/**
 * 설계를 사람에게 되돌린다(계약 2.11, 설계 상태 스펙 4.1 design_reopen·6.2 띄우기 전 검사·6.4). human 은 사람 설계 대기(as),
 * 그 밖은 설계 검토 대기(review)로 간다. 사유는 design_note 에 남아 화면이 보인다.
 * 부르는 쪽(8절): claimed 면 점유자, ready 면 그 주문을 후보로 받는 에이전트 PAT(담당자가 있으면 담당자 신원 — claim 과 같다).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('경로 id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (!reason || reason.length > REASON_MAX) return apiBadRequest(`reason 은 1~${REASON_MAX}자여야 합니다(되돌리는 이유 — 화면에 보인다).`)
  try {
    const admin = createAdminClient()
    const actor = await resolveWriteActor(req, admin, raw, 'work:claim')
    if (!actor.ok) return actor.res
    const loaded = actor.principal.kind === 'pat'
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res
    const row = loaded.order
    if (row.status === 'cancelled') return apiFail(409, 'cancelled', '작업이 중단되었습니다.')
    if (row.status === 'claimed') {
      if (actor.principal.kind === 'pat') {
        if (row.claimed_by_user_id !== actor.userId) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 되돌릴 수 있습니다.')
      } else if (row.claimed_by_user_id !== null || row.claimed_by !== actor.agentLabel) {
        return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 되돌릴 수 있습니다.')
      }
    } else if (row.status === 'ready') {
      if (actor.principal.kind !== 'pat') return apiFail(403, 'not_claim_owner', '대기 주문은 PAT 로만 되돌릴 수 있습니다.')
      if (row.wbs_item_id) {
        const { data: item, error: itemErr } = await admin.from('wbs_items').select('assignee_member_id').eq('id', row.wbs_item_id).maybeSingle()
        if (itemErr) { console.error('[agent-api] design-reopen 담당자 조회 실패(거절):', itemErr.message); return apiInternalError() }
        const assignee = (item as { assignee_member_id: string | null } | null)?.assignee_member_id ?? null
        if (assignee) {
          const mine = await myMemberIds(admin, { userId: actor.userId as string, userEmail: actor.principal.userEmail, projectId: row.project_id })
          if (!mine.includes(assignee)) return apiFail(403, 'not_assignee', '담당자가 배정된 작업입니다. 담당자만 되돌릴 수 있습니다.')
        }
      }
    } else {
      return apiFail(409, 'design_gate', `되돌릴 수 있는 상태가 아닙니다(현재: ${row.status}).`)
    }
    const transition = await applyWorkflowEvent(admin, {
      event: 'design_reopen', actorUserId: loaded.userId, orderId: id, note: reason,
      cas: { design_state: orderFactsOf(row).designState },
    })
    if (!transition.ok) {
      if (transition.reason === 'design_gate') return apiFail(409, 'design_gate', '되돌릴 수 있는 설계가 없습니다(설계 완료 단계의 승인·확정된 설계만 되돌립니다).')
      if (transition.conflict) return NextResponse.json({ error: '상태가 바뀌어 되돌리지 못했습니다.', code: 'design_gate', reason: 'order_changed' }, { status: 409 })
      console.error('[agent-api] design-reopen 전이 실패:', transition.error)
      return apiInternalError()
    }
    if (transition.actualChanged) {
      revalidatePath(`/p/${row.project_id}`, 'layout')
      after(() => recordProgressSnapshot(row.project_id, admin as never))
    }
    return NextResponse.json({ ok: true, status: transition.orderStatus, stage: transition.stage, design_state: transition.designState })
  } catch (e) {
    console.error('[agent-api] design-reopen 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
