import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { myMemberIds } from '@/lib/agent/assignee'
import { ITEM_DETAIL_COLUMNS, loadDependsInfo, type DependInfo } from '@/lib/agent/depends'
import { emitNotification } from '@/lib/notify/emit'
import { applyWorkflowEvent, notifyOnReached } from '@/lib/agent/workflowEvent'
import { recordProgressSnapshot } from '@/lib/data/snapshots'

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
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
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
        // 충족 판정은 depends_evidence 의 reached 하나다(predecessorReached — 스펙 2026-09-15 §3.7):
        // stage ≥ im, **또는** 선행에 approved 주문이 있음(2026-08-25 — 승인이 반쪽으로 끝난 선행이 후속을
        // 영구히 막던 교착), **또는** 선행 실적 100(위임하지 않은 사람 Task). 응답에 실린 reached 와 같은
        // 값으로 막아야 스킬과 서버가 서로 다른 판정을 하지 않는다.
        const unmet = dependsInfo.filter((d) => !d.reached)
        if (unmet.length > 0) {
          return NextResponse.json({
            error: '선행 작업이 끝나지 않았습니다(검수 대기 이상도, 승인도, 실적 100% 도 아님).', code: 'dependency_not_met',
            unmet: unmet.map((d) => ({ external_ref: d.external_ref, stage: d.stage })),
          }, { status: 403 })
        }
      }
    }

    // 원자 전이(스펙 2026-09-15 §4) — 주문 ready→claimed CAS + 단계 ip + 실적 크레딧이 한 트랜잭션.
    // 점유자 신원은 서버 유도값이다(claimed_by_user_id 는 PAT 경로에서만 — body 에서 받지 않는다).
    // 항목이 지워진 주문은 RPC 가 단계·실적만 건너뛴다(skipped:'no_item') — claim 자체는 종전처럼 된다.
    const transition = await applyWorkflowEvent(admin, {
      event: 'claim', actorUserId: loaded.userId, orderId: id,
      agent: actor.agentLabel,
      agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
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
