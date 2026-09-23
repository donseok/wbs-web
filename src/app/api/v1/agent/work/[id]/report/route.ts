import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import {
  AGENT_LINKS_MAX, validateDecisions, validateEvidence, validateReport, isUuidLike, type AgentReportKind,
} from '@/lib/domain/agentWork'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { emitNotification } from '@/lib/notify/emit'
import { applyWorkflowEvent, notifyOnReached } from '@/lib/agent/workflowEvent'

export const dynamic = 'force-dynamic'

type Link = { label?: string; url: string }

function parseLinks(raw: unknown): Link[] | { error: string } {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return { error: 'links는 배열이어야 합니다.' }
  if (raw.length > AGENT_LINKS_MAX) return { error: `links는 ${AGENT_LINKS_MAX}건 이하여야 합니다.` }
  const out: Link[] = []
  for (const l of raw) {
    if (typeof l !== 'object' || l === null) return { error: 'links의 각 원소는 객체여야 합니다.' }
    const { url, label } = l as Record<string, unknown>
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return { error: 'links[].url은 http(s) URL이어야 합니다.' }
    out.push({ url, ...(typeof label === 'string' && label ? { label } : {}) })
  }
  return out
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const kind = b.kind
  if (kind !== 'progress' && kind !== 'completion') return apiBadRequest('kind는 progress 또는 completion이어야 합니다.')
  const percent = typeof b.percent === 'number' ? b.percent : NaN
  const invalid = validateReport(kind as AgentReportKind, percent)
  if (invalid) return apiBadRequest(invalid)
  const summary = typeof b.summary === 'string' ? b.summary.trim() : ''
  if (!summary) return apiBadRequest('summary가 필요합니다.')
  const links = parseLinks(b.links)
  if ('error' in links) return apiBadRequest(links.error)
  const ev = validateEvidence(b.evidence)
  if (!ev.ok) return apiBadRequest(ev.error)
  // 결정 목록(과제 C, 계약 2.6) — 승인자가 보는 것은 완료 보고라 completion 에서만 받는다(D6).
  // kind 를 먼저 본다: progress 에 실린 결정은 모양과 무관하게 받을 자리가 없다.
  if (b.decisions !== undefined && kind !== 'completion') {
    return apiBadRequest('decisions는 완료 보고(kind=completion)에서만 받습니다.')
  }
  const dec = validateDecisions(b.decisions)
  if (!dec.ok) return apiBadRequest(dec.error)

  try {
    const admin = createAdminClient()
    const actor = await resolveWriteActor(req, admin, raw, 'work:claim')
    if (!actor.ok) return actor.res
    // v1 요청 형식은 불변(api-contract.md 머리말) — 레거시 경로는 결정을 받지 않는다.
    if (dec.decisions !== null && actor.principal.kind !== 'pat') {
      return apiBadRequest('decisions는 PAT 호출에서만 받습니다.')
    }

    const loaded = actor.principal.kind === 'pat'
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res
    const order = loaded.order
    // 보고는 점유 상태에서만. reported(승인 대기)는 판정 전 원장 동결(스펙 §6).
    // 사람이 중단한 주문(2026-09-19 중단 설계 §2) — 워커가 구분해 멈추도록 전용 코드를 준다(훅·dflow.sh exit 10).
    // 소유 판정보다 먼저 본다: 중단은 점유 흔적을 지우므로 뒤에 두면 403 not_claim_owner 로 뭉개진다.
    if (order.status === 'cancelled') return apiFail(409, 'cancelled', '작업이 중단되었습니다.')
    if (order.status !== 'claimed') {
      return apiFail(409, 'conflict', `보고 가능한 상태가 아닙니다(현재: ${order.status}).`)
    }

    // 소유 판정(§2.3) — 교차 소유는 양방향 모두 403 not_claim_owner.
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
        return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 보고할 수 있습니다.')
      }
    }

    // 계약 v2.3(스펙 2026-09-15 §3.4) — progress 보고는 보고 행만 남긴다. 실적은 단계 전이 사건의 크레딧과
    // 사람의 수기 입력으로만 바뀐다(에이전트가 찍는 임의의 % 대신 정해진 값). 응답 필드는 호환을 위해 둔다.
    const appliedToWbs = false

    // 보고 행은 판정·감사의 원천 — 실패를 삼키면 승인 화면이 거짓이 된다(fail-loud 500).
    // completion 은 보고 insert 선행(경합 시 cleanup)이라 재시도 수렴. progress 는 보고 행만 남긴다.
    const { data: report, error: repErr } = await admin
      .from('agent_work_reports')
      .insert({
        work_order_id: id, kind, percent, summary, links, evidence: ev.evidence,
        agent: actor.agentLabel, actor_user_id: loaded.userId, applied_to_wbs: appliedToWbs,
        // 필드가 없으면 키 자체를 넣지 않는다 — 행은 null = 제출 안 됨.
        ...(dec.decisions !== null ? { decisions: dec.decisions } : {}),
      })
      .select('id')
    if (repErr || !report || (report as unknown[]).length === 0) {
      console.error('[agent-api] 보고 기록 실패:', repErr?.message ?? '0행')
      return apiInternalError('보고를 기록하지 못했습니다. 같은 내용으로 재시도하세요.')
    }
    const reportId = ((report as unknown[])[0] as Record<string, unknown>).id

    // completion 은 CAS 로 reported 전이 — 경합 시 cleanup(고아 행 무해) + 409.
    if (kind === 'completion') {
      // 원자 전이(스펙 §4) — claimed→reported CAS(점유자 일치) + 단계 im + 실적 표.im 이 한 트랜잭션.
      // 경합·오류는 보고 행을 지워(고아 행 무해) 같은 내용의 재시도가 수렴하게 한다.
      const transition = await applyWorkflowEvent(admin, {
        event: 'report_completion', actorUserId: loaded.userId, orderId: id,
        agent: actor.principal.kind === 'pat' ? null : actor.agentLabel,
        agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
      })
      if (!transition.ok) {
        const { error: cleanupErr } = await admin
          .from('agent_work_reports').delete().eq('id', reportId)
        if (cleanupErr) console.error('[agent-api] 보고 행 cleanup 실패(고아 행 남음):', cleanupErr.message)
        if (transition.conflict) return apiFail(409, 'conflict', '완료 요청 가능한 상태가 아닙니다.')
        console.error('[agent-api] completion 전이 실패:', transition.error)
        return apiInternalError()
      }
      if (transition.actualChanged) {
        revalidatePath(`/p/${order.project_id}`, 'layout')
        after(() => recordProgressSnapshot(order.project_id, admin as never))
      }
      // 알림 발행 — completion→reported 전이 성공 직후. progress 보고에는 발행하지 않는다(fire-and-forget).
      const { data: admins, error: adminsErr } = await admin
        .from('project_roles').select('user_id').eq('project_id', order.project_id).eq('role', 'admin')
      if (adminsErr) console.error('[agent-api] 관리자 조회 실패(알림 생략):', adminsErr.message)
      let itemName = '작업'
      if (order.wbs_item_id) {
        const { data: itemRow, error: itemNameErr } = await admin
          .from('wbs_items').select('name').eq('id', order.wbs_item_id).maybeSingle()
        if (itemNameErr) console.error('[agent-api] 항목 이름 조회 실패(알림 계속):', itemNameErr.message)
        else if (itemRow) itemName = (itemRow as { name: string }).name
      }
      // 결정이 딸린 보고는 알림만 보고도 알 수 있게 한다(미결 1 — 별도 알림 유형은 두지 않는다).
      const decisionCount = dec.decisions?.length ?? 0
      emitNotification({
        type: 'work.reported', projectId: order.project_id, actorUserId: loaded.userId ?? null,
        entityType: 'agent_order', entityId: id,
        payload: {
          title: itemName,
          detail: decisionCount > 0 ? `완료 보고 — 승인 대기 · 확인 필요 결정 ${decisionCount}건` : '완료 보고 — 승인 대기',
          href: `/p/${order.project_id}/wbs`,
        },
        recipientUserIds: ((admins ?? []) as Array<{ user_id: string }>).map(a => a.user_id),
      }).catch(() => {
        // 알림 실패는 로깅만 하고 본 로직에 영향을 주지 않는다.
      })

      // im 첫 도달이면 후행 unblocked 알림(§2.10) — 실패는 로깅만, 응답에 영향 없음.
      if (transition.reachedFirst && order.wbs_item_id) await notifyOnReached(admin, order.wbs_item_id, loaded.userId)
    } else {
      // progress 는 상태 유지 — updated_at 만 갱신해 보드의 활동 시각을 살린다.
      const { error: touchErr } = await admin
        .from('agent_work_orders')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'claimed')
      if (touchErr) console.error('[agent-api] 주문 활동 시각 갱신 실패:', touchErr.message)
    }

    // decisions_recorded: 보내지 않았으면 null, 보냈으면 저장 건수. CLI 는 이 키가 없으면 구 서버로 보고 경고한다(D9).
    return NextResponse.json(
      kind === 'completion'
        ? { ok: true, status: 'reported', decisions_recorded: dec.decisions === null ? null : dec.decisions.length }
        : { ok: true, status: 'claimed', applied_to_wbs: appliedToWbs },
    )
  } catch (e) {
    console.error('[agent-api] report 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
