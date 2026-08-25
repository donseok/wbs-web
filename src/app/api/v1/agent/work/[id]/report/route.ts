import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import {
  AGENT_LINKS_MAX, validateEvidence, validateReport, isUuidLike, type AgentReportKind,
} from '@/lib/domain/agentWork'
import { applyAgentProgress } from '@/lib/agent/applyProgress'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { emitNotification } from '@/lib/notify/emit'
import { transitionStage } from '@/lib/agent/stageTransition'

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

  try {
    const admin = createAdminClient()
    const actor = await resolveWriteActor(req, admin, raw, 'work:claim')
    if (!actor.ok) return actor.res

    const loaded = actor.principal.kind === 'pat'
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res
    const order = loaded.order
    // 보고는 점유 상태에서만. reported(승인 대기)는 판정 전 원장 동결(스펙 §6).
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

    let appliedToWbs = false
    if (kind === 'progress') {
      // 항목이 삭제된 주문(set null)의 진척은 반영할 곳이 없다 — 실패로 알리고 사람이 정리한다.
      if (!order.wbs_item_id) return apiFail(409, 'wbs_item_missing', 'WBS 항목이 삭제된 주문입니다.')
      const applied = await applyAgentProgress(admin, {
        wbsItemId: order.wbs_item_id, percent, actorUserId: loaded.userId,
      })
      if (!applied.ok) return apiFail(409, 'apply_failed', applied.error)
      appliedToWbs = true
      revalidatePath(`/p/${applied.projectId}`, 'layout')
      after(() => recordProgressSnapshot(applied.projectId, admin as never))
    }

    // 보고 행은 판정·감사의 원천 — 실패를 삼키면 승인 화면이 거짓이 된다(fail-loud 500).
    // completion 은 보고 insert 선행(경합 시 cleanup)이라 재시도 수렴. progress 는 WBS 반영 후 insert — 같은 percent 재보고는 멱등.
    const { data: report, error: repErr } = await admin
      .from('agent_work_reports')
      .insert({
        work_order_id: id, kind, percent, summary, links, evidence: ev.evidence,
        agent: actor.agentLabel, actor_user_id: loaded.userId, applied_to_wbs: appliedToWbs,
      })
      .select('id')
    if (repErr || !report || (report as unknown[]).length === 0) {
      console.error('[agent-api] 보고 기록 실패:', repErr?.message ?? '0행')
      return apiInternalError('보고를 기록하지 못했습니다. 같은 내용으로 재시도하세요.')
    }
    const reportId = ((report as unknown[])[0] as Record<string, unknown>).id

    // completion 은 CAS 로 reported 전이 — 경합 시 cleanup(고아 행 무해) + 409.
    if (kind === 'completion') {
      const casQuery = admin
        .from('agent_work_orders')
        .update({ status: 'reported', updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'claimed')
      const { data: updated, error: casErr } = await (
        actor.principal.kind === 'pat'
          ? casQuery.eq('claimed_by_user_id', actor.userId as string)
          : casQuery.eq('claimed_by', actor.agentLabel)
      ).select('id')
      if (casErr) {
        console.error('[agent-api] completion 전이 실패:', casErr.message)
        // Cleanup: best-effort delete 보고 행
        const { error: cleanupErr } = await admin
          .from('agent_work_reports').delete().eq('id', reportId)
        if (cleanupErr) console.error('[agent-api] 보고 행 cleanup 실패(고아 행 남음):', cleanupErr.message)
        return apiInternalError()
      }
      if (!updated || (updated as unknown[]).length === 0) {
        // Cleanup: best-effort delete 보고 행
        const { error: cleanupErr } = await admin
          .from('agent_work_reports').delete().eq('id', reportId)
        if (cleanupErr) console.error('[agent-api] 보고 행 cleanup 실패(고아 행 남음):', cleanupErr.message)
        return apiFail(409, 'conflict', '완료 요청 가능한 상태가 아닙니다.')
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
      emitNotification({
        type: 'work.reported', projectId: order.project_id, actorUserId: loaded.userId ?? null,
        entityType: 'agent_order', entityId: id,
        payload: { title: itemName, detail: '완료 보고 — 승인 대기', href: `/p/${order.project_id}/wbs` },
        recipientUserIds: ((admins ?? []) as Array<{ user_id: string }>).map(a => a.user_id),
      }).catch(() => {
        // 알림 실패는 로깅만 하고 본 로직에 영향을 주지 않는다.
      })

      // stage 전이 — completion 보고로 reported 전이 확정 후. im 도달이면 내부에서 unblocked 발행까지 이어진다.
      // 실패는 로깅만 — 응답에 영향 없음. progress 보고는 이 분기에 들어오지 않으므로 무간섭.
      if (order.wbs_item_id) {
        try {
          const transitioned = await transitionStage(admin, {
            itemId: order.wbs_item_id, to: 'im', fromIn: ['ip', 'as', 'fp', null], actorUserId: loaded.userId,
          })
          if (!transitioned.ok) console.error('[agent-api] report stage 전이 실패:', order.wbs_item_id)
        } catch (e) {
          console.error('[agent-api] report stage 전이 예외:', e instanceof Error ? e.message : e)
        }
      }
    } else {
      // progress 는 상태 유지 — updated_at 만 갱신해 보드의 활동 시각을 살린다.
      const { error: touchErr } = await admin
        .from('agent_work_orders')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'claimed')
      if (touchErr) console.error('[agent-api] 주문 활동 시각 갱신 실패:', touchErr.message)
    }

    return NextResponse.json(
      kind === 'completion'
        ? { ok: true, status: 'reported' }
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
