import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'
import { orderFactsOf } from '@/lib/agent/designFacts'
import { canDesignDone } from '@/lib/domain/designGate'

export const dynamic = 'force-dynamic'

/**
 * 설계를 마치고 멈춘다(계약 2.11, 설계 상태 스펙 4.1 design_done·6.3). 워커가 design.md·state.json 을 push 한 뒤 부른다.
 * 서버가 단계 ds → dd·실적 dd 로 두고, review 방식이거나 claim_scope design 이면 설계 상태 review·heartbeat phase wait_review·
 * runner 없음으로 둔다(설계 검토 대기). 그 밖(auto 설계 선행)은 설계 상태 없이 phase wait_pred, runner 유지.
 * 점유자 본인만 부른다(build-start 와 같은 소유 판정). 단계 ip 이상이면 409 design_gate.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('경로 id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
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
    const facts = orderFactsOf(row)
    const g = canDesignDone(null, facts)
    if (g) return NextResponse.json({ error: g.message, code: g.code, reason: 'order_changed' }, { status: 409 })
    if (actor.principal.kind === 'pat') {
      if (row.claimed_by_user_id === null) return apiFail(403, 'not_claim_owner', '레거시 세션이 점유한 주문입니다.')
      if (row.claimed_by_user_id !== actor.userId) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    } else {
      if (row.claimed_by_user_id !== null) return apiFail(403, 'not_claim_owner', 'PAT 사용자가 점유한 주문입니다.')
      if (row.claimed_by !== actor.agentLabel) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    }
    const transition = await applyWorkflowEvent(admin, {
      event: 'design_done', actorUserId: loaded.userId, orderId: id,
      cas: { design_state: facts.designState },
      agent: actor.principal.kind === 'pat' ? null : actor.agentLabel,
      agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
      runner: actor.agentLabel,
    })
    if (!transition.ok) {
      if (transition.reason === 'design_gate') return apiFail(409, 'design_gate', '구현이 시작된 작업은 설계 완료로 되돌릴 수 없습니다.')
      if (transition.conflict) return NextResponse.json({ error: '상태가 바뀌어 설계 완료를 기록하지 못했습니다.', code: 'design_gate', reason: 'order_changed' }, { status: 409 })
      console.error('[agent-api] design-done 전이 실패:', transition.error)
      return apiInternalError()
    }
    if (transition.actualChanged) {
      revalidatePath(`/p/${row.project_id}`, 'layout')
      after(() => recordProgressSnapshot(row.project_id, admin as never))
    }
    return NextResponse.json({ ok: true, status: 'claimed', stage: transition.stage, design_state: transition.designState })
  } catch (e) {
    console.error('[agent-api] design-done 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
