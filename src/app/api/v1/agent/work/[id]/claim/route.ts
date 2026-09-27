import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { myMemberIds } from '@/lib/agent/assignee'
import { ITEM_DETAIL_COLUMNS, loadDependsInfo, type DependInfo } from '@/lib/agent/depends'
import { hasApprovedOrder, orderFactsOf } from '@/lib/agent/designFacts'
import { CLAIM_REQUEST_SCOPES, canClaim, predsState, toDesignMode, type ClaimScope } from '@/lib/domain/designGate'
import { emitNotification } from '@/lib/notify/emit'
import { applyWorkflowEvent, notifyOnReached } from '@/lib/agent/workflowEvent'
import { recordProgressSnapshot } from '@/lib/data/snapshots'

export const dynamic = 'force-dynamic'

type ItemDetail = Record<string, unknown> & {
  name?: string; assignee_member_id?: string | null; depends?: string[] | null; depends_waived?: string[] | null
  stage?: string | null; tags?: string[] | null; actual_pct?: number | string | null; design_mode?: string | null
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('경로 id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  // 설계 선행(계약 v2.9, 스펙 2026-09-26 §6.3) — 요청 값은 full·legacy 범위에서만 쓴다. design 범위는 선행으로 정하고
  // build 범위는 끈다(designGate.canClaim). 없거나 false 면 설계 선행 없이 claim 한다.
  const designFirstRaw = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).design_first : undefined
  if (designFirstRaw !== undefined && typeof designFirstRaw !== 'boolean') return apiBadRequest('design_first는 불리언이어야 합니다.')
  const designFirst = designFirstRaw === true
  // 범위(계약 2.11, 설계 상태 스펙 5.2·D21) — 없으면 legacy(옛 킷·수동 claim). 모르는 값은 조용히 legacy 로 삼키지 않는다.
  const scopeRaw = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).scope : undefined
  if (scopeRaw !== undefined && (typeof scopeRaw !== 'string' || !(CLAIM_REQUEST_SCOPES as readonly string[]).includes(scopeRaw))) {
    return apiBadRequest(`scope 는 ${CLAIM_REQUEST_SCOPES.join('|')} 중 하나여야 합니다.`)
  }
  const scope: ClaimScope = (scopeRaw as ClaimScope | undefined) ?? 'legacy'
  let unmetOut: { external_ref: string; stage: string | null }[] = []
  try {
    const admin = createAdminClient()
    const actor = await resolveWriteActor(req, admin, raw, 'work:claim')
    if (!actor.ok) return actor.res

    const loaded = actor.principal.kind === 'pat'
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res

    // 배정 제한(①)·선행 게이트(결정 C-①)·응답 확장이 모두 쓰는 항목 상세 —
    // ITEM_DETAIL_COLUMNS 로 1회만 로드한다.
    let item: ItemDetail | null = null
    let dependsInfo: DependInfo[] = []
    if (loaded.order.wbs_item_id) {
      const { data: itemRow, error: itemErr } = await admin
        .from('wbs_items').select(`${ITEM_DETAIL_COLUMNS}, actual_pct, design_mode`).eq('id', loaded.order.wbs_item_id).maybeSingle()
      if (itemErr) {
        console.error('[agent-api] 배정 확인 실패(거절):', itemErr.message) // fail-closed
        return apiInternalError()
      }
      item = itemRow as ItemDetail | null

      // actor 신원 — PAT 는 principal, legacy 는 loadGatedOrder 가 해석한 userId + body email.
      const actorUserId = actor.principal.kind === 'pat' ? (actor.userId as string) : loaded.userId
      const actorEmail = actor.principal.kind === 'pat'
        ? actor.principal.userEmail
        : (parseAgentActor(raw) as { userEmail: string }).userEmail

      const assignee = item?.assignee_member_id ?? null
      if (assignee) {
        const mine = await myMemberIds(admin, {
          userId: actorUserId, userEmail: actorEmail, projectId: loaded.order.project_id,
        })
        if (!mine.includes(assignee)) {
          return apiFail(403, 'not_assignee', '담당자가 배정된 작업입니다. 담당자만 착수할 수 있습니다.')
        }
      }

      const depends = item?.depends ?? []
      if (depends.length > 0) {
        dependsInfo = await loadDependsInfo(admin, { projectId: loaded.order.project_id, depends, waived: item?.depends_waived ?? [] })
        // 충족 판정은 depends_evidence 의 reached 하나다(predecessorReached — 스펙 2026-09-15 §3.7). 응답의 reached 와 같은
        // 값으로 막아야 스킬과 서버가 서로 다른 판정을 하지 않는다. 설계 선행은 미충족 선행이 모두 dd·ip 면 허용한다(설계 상태 스펙 D15).
        unmetOut = dependsInfo.filter((d) => !d.reached).map((d) => ({ external_ref: d.external_ref, stage: d.stage }))
      }
    }

    // 설계 관문(설계 상태 스펙 5.2 claim·D26) — 방식·설계 상태·진행 여부·선행을 designGate 하나로 판정한다.
    // 항목이 지워진 주문은 관문을 보지 않는다(종전처럼 claim 되고 RPC 가 단계·실적만 건너뛴다).
    // status 가 ready 가 아니면(레거시 점유·reported·approved 등) 관문도 보지 않는다 — 그런 주문은
    // RPC 의 CAS 가 conflict 로 답해야지, alreadyProgressed(단계 ip 이상)에 걸려 남이 이미 진행 중인
    // 작업에 "단계를 되돌리거나 재작업을 쓰라"는 엉뚱한 사유(design_gate)를 내면 안 된다(리뷰 1회차).
    const order = orderFactsOf(loaded.order)
    const mode = toDesignMode(item?.design_mode)
    if (item && loaded.order.wbs_item_id && loaded.order.status === 'ready') {
      const refusal = canClaim({
        mode, stage: item.stage ?? null, actualPct: item.actual_pct == null ? null : Number(item.actual_pct),
        delegated: (item.tags ?? []).includes('agent'), hasApprovedOrder: await hasApprovedOrder(admin, loaded.order.wbs_item_id),
        preds: predsState(unmetOut),
      }, order.designState, scope, designFirst)
      if (refusal) {
        return NextResponse.json({
          error: refusal.message, code: refusal.code, ...(refusal.reason ? { reason: refusal.reason } : {}),
          ...(refusal.code === 'dependency_not_met' ? { unmet: unmetOut } : {}),
        }, { status: refusal.status })
      }
    }

    // 원자 전이(스펙 2026-09-15 §4) — 주문 ready→claimed CAS + 단계 ip(설계 선행이면 ds) + 실적 크레딧이 한 트랜잭션.
    // 점유자 신원은 서버 유도값이다(claimed_by_user_id 는 PAT 경로에서만 — body 에서 받지 않는다).
    // 항목이 지워진 주문은 RPC 가 단계·실적만 건너뛴다(skipped:'no_item') — claim 자체는 종전처럼 된다.
    const transition = await applyWorkflowEvent(admin, {
      event: 'claim', actorUserId: loaded.userId, orderId: id,
      // legacy 범위에서만 p_stage 가 뜻이 있다(0107 설계 선행). full·design·build 는 RPC 가 범위로 단계를 정한다.
      stage: scope === 'legacy' && designFirst ? 'ds' : null,
      scope: scope === 'legacy' ? null : scope,
      cas: { design_state: order.designState, ...(item ? { design_mode: mode } : {}) },
      agent: actor.agentLabel,
      agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
      runner: actor.agentLabel,
    })
    if (!transition.ok) {
      if (transition.conflict) {
        return NextResponse.json(
          { error: '이미 다른 에이전트가 점유했거나 점유 불가 상태입니다.', code: 'conflict', status: transition.orderStatus ?? 'unknown' },
          { status: 409 },
        )
      }
      console.error('[agent-api] claim 전이 실패:', transition.error)
      return apiInternalError()
    }

    // 새 점유자에게 옛 재개 요청을 물려주지 않는다(0099). 회수→재claim 경로에서 표식이 남으면
    // 좌석이 「재개 요청됨」으로 잠기고, 팀장의 watch 가 방금 정상 점유된 주문을 되살릴 대상으로
    // 집어 가 같은 워크트리에 워커를 겹쳐 띄운다. heartbeat 가 지워 주기를 기다릴 수 없다 —
    // 훅이 없는 세션은 heartbeat 를 아예 보내지 않아 표식이 영영 남는다.
    // 전이는 이미 성공했으므로 이 뒷정리의 실패로 claim 을 되돌리지 않는다(로깅만).
    const { error: resumeClearErr } = await admin
      .from('agent_work_orders')
      .update({ resume_requested_at: null, resume_requested_by: null, resume_requested_host: null })
      .eq('id', id)
    if (resumeClearErr) console.error('[agent-api] claim 뒤 재개 요청 정리 실패:', resumeClearErr.message)

    // claim 알림 — fire-and-forget. 본인 배정 작업 본인 claim 은 행위자 제외 규칙(emitNotification)으로 자동 무발행.
    // actorUserId 는 legacy 도 loaded.userId 로 채운다(release/report 관례) — principal.userId 는
    // legacy 에서 undefined 라 null 로 새면 자기제외가 비활성화되어 본인 claim 에도 알림이 간다.
    emitNotification({
      type: 'work.claimed', projectId: loaded.order.project_id,
      actorUserId: loaded.userId,
      entityType: 'agent_order', entityId: id,
      payload: { title: item?.name ?? '작업', detail: '작업이 시작되었습니다', href: `/p/${loaded.order.project_id}/wbs` },
      recipientMemberIds: item?.assignee_member_id ? [item.assignee_member_id] : [],
    }).catch(() => {
      // 알림 실패는 로깅만 하고 본 로직에 영향을 주지 않는다.
    })

    // 실적이 바뀌었으면 진척 스냅샷, im·xx 첫 도달이면 후행 알림 — 둘 다 실패는 로깅만(응답에 영향 없음).
    if (transition.actualChanged) {
      revalidatePath(`/p/${loaded.order.project_id}`, 'layout')
      after(() => recordProgressSnapshot(loaded.order.project_id, admin as never))
    }
    if (transition.reachedFirst && loaded.order.wbs_item_id) await notifyOnReached(admin, loaded.order.wbs_item_id, loaded.userId)

    return NextResponse.json({
      ok: true, status: 'claimed', item, depends_evidence: dependsInfo,
      ...(designFirst ? { design_first: true, unmet: unmetOut } : {}),
      ...(actor.principal.kind === 'pat' ? { claim_scope: scope } : {}),
    })
  } catch (e) {
    console.error('[agent-api] claim 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
