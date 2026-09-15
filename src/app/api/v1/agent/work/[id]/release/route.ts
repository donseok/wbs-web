import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'
import { emitNotification } from '@/lib/notify/emit'
import type { AdminClient } from '@/lib/minutes/externalApi'

export const dynamic = 'force-dynamic'

/** 반납 알림 — fire-and-forget. 수신자는 그 항목의 배정자(없으면 발행 없이 종료). */
async function emitReleaseNotification(
  admin: AdminClient,
  order: { id: string; project_id: string; wbs_item_id: string | null },
  actorUserId: string,
) {
  let itemName = '작업'
  let assigneeMemberId: string | null = null
  if (order.wbs_item_id) {
    const { data: itemRow, error } = await admin
      .from('wbs_items').select('name, assignee_member_id').eq('id', order.wbs_item_id).maybeSingle()
    if (error) console.error('[agent-api] 항목 조회 실패(알림 계속):', error.message)
    else if (itemRow) {
      const row = itemRow as { name: string; assignee_member_id: string | null }
      itemName = row.name
      assigneeMemberId = row.assignee_member_id ?? null
    }
  }
  emitNotification({
    type: 'work.released', projectId: order.project_id, actorUserId,
    entityType: 'agent_order', entityId: order.id,
    payload: { title: itemName, detail: '작업이 반납되었습니다', href: `/p/${order.project_id}/wbs` },
    recipientMemberIds: assigneeMemberId ? [assigneeMemberId] : [],
  }).catch(() => {
    // 알림 실패는 로깅만 하고 본 로직에 영향을 주지 않는다.
  })
}

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
    const order = loaded.order

    // 소유 판정(§2.3) — 교차 소유는 양방향 모두 403 not_claim_owner. 하나의 조건에 OR 로 섞지 않는다.
    if (actor.principal.kind === 'pat') {
      if (order.claimed_by_user_id === null) {
        return apiFail(403, 'not_claim_owner', '레거시 세션이 점유한 주문입니다.')
      }
      if (order.claimed_by_user_id !== actor.userId) {
        return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 반납할 수 있습니다.')
      }
    } else {
      // legacy — v1 그대로 + PAT 점유 주문 차단 한 줄.
      if (order.claimed_by_user_id !== null) {
        return apiFail(403, 'not_claim_owner', 'PAT 사용자가 점유한 주문입니다.')
      }
      if (order.claimed_by !== actor.agentLabel) {
        return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 반납할 수 있습니다.')
      }
    }

    // 원자 전이(스펙 2026-09-15 §4) — claimed→ready CAS(점유자 일치 조건 포함) + 단계 as + 실적 표.as.
    // 점유·heartbeat 흔적도 같은 트랜잭션에서 지운다. 판정과 쓰기 사이의 경합은 RPC 의 CAS 가 409 로 돌려준다.
    const transition = await applyWorkflowEvent(admin, {
      event: 'release', actorUserId: loaded.userId, orderId: id,
      agent: actor.principal.kind === 'pat' ? null : actor.agentLabel,
      agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
    })
    if (!transition.ok) {
      if (transition.conflict) return apiFail(409, 'conflict', '반납 가능한 상태가 아닙니다.')
      console.error('[agent-api] release 전이 실패:', transition.error)
      return apiInternalError()
    }
    if (transition.actualChanged) {
      revalidatePath(`/p/${order.project_id}`, 'layout')
      after(() => recordProgressSnapshot(order.project_id, admin as never))
    }
    await emitReleaseNotification(admin, order, loaded.userId)
    return NextResponse.json({ ok: true, status: 'ready' })
  } catch (e) {
    console.error('[agent-api] release 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
