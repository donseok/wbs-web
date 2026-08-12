import { NextRequest, NextResponse } from 'next/server'
import { isUuidLike, stageAtLeast } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { myMemberIds } from '@/lib/agent/assignee'
import { ITEM_DETAIL_COLUMNS, loadDependsInfo, type DependInfo } from '@/lib/agent/depends'
import { emitNotification } from '@/lib/notify/emit'

export const dynamic = 'force-dynamic'

type ItemDetail = Record<string, unknown> & { name?: string; assignee_member_id?: string | null; depends?: string[] | null }

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
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res

    // 배정 제한(①)·선행 게이트(결정 C-①)·응답 확장이 모두 쓰는 항목 상세 —
    // ITEM_DETAIL_COLUMNS 로 1회만 로드한다.
    let item: ItemDetail | null = null
    let dependsInfo: DependInfo[] = []
    if (loaded.order.wbs_item_id) {
      const { data: itemRow, error: itemErr } = await admin
        .from('wbs_items').select(ITEM_DETAIL_COLUMNS).eq('id', loaded.order.wbs_item_id).maybeSingle()
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
        dependsInfo = await loadDependsInfo(admin, { projectId: loaded.order.project_id, depends })
        const unmet = dependsInfo.filter((d) => !stageAtLeast(d.stage, 'im'))
        if (unmet.length > 0) {
          return NextResponse.json({
            error: '선행 작업이 완료(im 이상)되지 않았습니다.', code: 'dependency_not_met',
            unmet: unmet.map((d) => ({ external_ref: d.external_ref, stage: d.stage })),
          }, { status: 403 })
        }
      }
    }

    // CAS: ready 일 때만 점유된다 — 동시 claim 은 한쪽이 0행을 본다.
    // claimed_by_user_id 는 PAT 경로에서만 서버 유도값으로 기록한다(body 에서 받지 않는다).
    const { data: updated, error: casErr } = await admin
      .from('agent_work_orders')
      .update({
        status: 'claimed', claimed_by: actor.agentLabel,
        claimed_by_user_id: actor.principal.kind === 'pat' ? actor.userId : null,
        claimed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      .eq('id', id).eq('status', 'ready')
      .select('id')
    if (casErr) {
      console.error('[agent-api] claim 갱신 실패:', casErr.message)
      return apiInternalError()
    }
    if (!updated || (updated as unknown[]).length === 0) {
      const { data: cur, error: curErr } = await admin
        .from('agent_work_orders').select('status').eq('id', id).maybeSingle()
      // 표시=로깅 원칙 — 재조회 실패도 조용히 unknown 으로 삼키지 않고 남긴다(동작은 폴백 유지).
      if (curErr) console.error('[agent-api] claim 충돌 재조회 실패:', curErr.message)
      return NextResponse.json(
        { error: '이미 다른 에이전트가 점유했거나 점유 불가 상태입니다.', code: 'conflict', status: (cur as { status?: string } | null)?.status ?? 'unknown' },
        { status: 409 },
      )
    }

    // claim 알림 — fire-and-forget. 본인 배정 작업 본인 claim 은 행위자 제외 규칙(emitNotification)으로 자동 무발행.
    // actorUserId 는 legacy 도 loaded.userId 로 채운다(release/report 관례) — principal.userId 는
    // legacy 에서 undefined 라 null 로 새면 자기제외가 비활성화되어 본인 claim 에도 알림이 간다.
    emitNotification({
      type: 'work.claimed', projectId: loaded.order.project_id,
      actorUserId: loaded.userId,
      entityType: 'agent_order', entityId: id,
      payload: { title: item?.name ?? '작업', detail: '작업이 시작되었습니다', href: '/agent-ops' },
      recipientMemberIds: item?.assignee_member_id ? [item.assignee_member_id] : [],
    }).catch(() => {
      // 알림 실패는 로깅만 하고 본 로직에 영향을 주지 않는다.
    })

    return NextResponse.json({ ok: true, status: 'claimed', item, depends_evidence: dependsInfo })
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
