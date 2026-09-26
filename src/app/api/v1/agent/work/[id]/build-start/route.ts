import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { loadDependsInfo, type DependInfo } from '@/lib/agent/depends'
import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'

export const dynamic = 'force-dynamic'

/**
 * 설계 끝 → 구현 시작(계약 v2.9, 스펙 2026-09-26 §6.3). 설계 선행으로 claim 한(단계 ds) 주문을 ip 로 옮긴다.
 * 점유자 본인·claimed·선행 모두 reached 여야 한다. 이미 ip 이상이면 RPC 가 아무것도 바꾸지 않고 ok 를 준다(멱등 —
 * 옛 claim 은 곧바로 ip). 주문 status 는 claimed 그대로다.
 * 인증·점유자 확인은 report 라우트, 선행 판정은 claim 라우트와 같은 재료(loadDependsInfo 의 reached)를 쓴다.
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
    const order = loaded.order
    // 사람이 중단한 주문은 전용 코드(report 와 같다) — 소유 판정보다 먼저 본다(중단은 점유 흔적을 지운다).
    if (order.status === 'cancelled') return apiFail(409, 'cancelled', '작업이 중단되었습니다.')
    if (order.status !== 'claimed') {
      return apiFail(409, 'conflict', `구현을 시작할 수 있는 상태가 아닙니다(현재: ${order.status}).`)
    }

    // 소유 판정(§2.3) — 교차 소유는 양방향 모두 403 not_claim_owner(report·release 와 같다).
    if (actor.principal.kind === 'pat') {
      if (order.claimed_by_user_id === null) {
        return apiFail(403, 'not_claim_owner', '레거시 세션이 점유한 주문입니다.')
      }
      if (order.claimed_by_user_id !== actor.userId) {
        return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
      }
    } else {
      if (order.claimed_by_user_id !== null) {
        return apiFail(403, 'not_claim_owner', 'PAT 사용자가 점유한 주문입니다.')
      }
      if (order.claimed_by !== actor.agentLabel) {
        return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
      }
    }

    // 선행 관문 — claim 과 같은 재료(reached). 관문 재료 조회 실패는 위장하지 않는다(500, fail-closed).
    let dependsInfo: DependInfo[] = []
    if (order.wbs_item_id) {
      const { data: itemRow, error: itemErr } = await admin
        .from('wbs_items').select('depends, depends_waived').eq('id', order.wbs_item_id).maybeSingle()
      if (itemErr) {
        console.error('[agent-api] build-start 선행 조회 실패(거절):', itemErr.message)
        return apiInternalError()
      }
      const item = itemRow as { depends?: string[] | null; depends_waived?: string[] | null } | null
      const depends = item?.depends ?? []
      if (depends.length > 0) {
        dependsInfo = await loadDependsInfo(admin, { projectId: order.project_id, depends, waived: item?.depends_waived ?? [] })
        const unmet = dependsInfo.filter((d) => !d.reached)
        if (unmet.length > 0) {
          return NextResponse.json({
            error: '선행 작업이 끝나지 않아 구현을 시작할 수 없습니다(검수 대기 이상도, 승인도, 실적 100% 도 아님).', code: 'dependency_not_met',
            unmet: unmet.map((d) => ({ external_ref: d.external_ref, stage: d.stage })),
          }, { status: 403 })
        }
      }
    }

    // 원자 전이 — claimed 확인·점유자 일치 조건은 RPC 가 다시 본다(판정과 쓰기 사이 경합은 409).
    const transition = await applyWorkflowEvent(admin, {
      event: 'build_start', actorUserId: loaded.userId, orderId: id,
      agent: actor.principal.kind === 'pat' ? null : actor.agentLabel,
      agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
    })
    if (!transition.ok) {
      if (transition.conflict) return apiFail(409, 'conflict', '구현을 시작할 수 있는 상태가 아닙니다.')
      console.error('[agent-api] build-start 전이 실패:', transition.error)
      return apiInternalError()
    }
    // claim 라우트와 같은 후처리 — 실적이 바뀌었으면 화면 갱신·진척 스냅샷(실패는 로깅만).
    if (transition.actualChanged) {
      revalidatePath(`/p/${order.project_id}`, 'layout')
      after(() => recordProgressSnapshot(order.project_id, admin as never))
    }
    return NextResponse.json({
      ok: true, status: 'claimed', stage: transition.stage, stage_changed: transition.stageChanged,
      depends_evidence: dependsInfo,
    })
  } catch (e) {
    console.error('[agent-api] build-start 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
