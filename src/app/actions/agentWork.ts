'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { backfillProjectOrders } from '@/lib/agent/ensureOrder'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { requireProjectAdmin, requireProjectMember } from '@/lib/authz'
import { updateActual } from '@/app/actions/wbs'
import { isUuidLike } from '@/lib/domain/agentWork'
import { emitNotification } from '@/lib/notify/emit'
import { transitionStage } from '@/lib/agent/stageTransition'

/**
 * 에이전트 작업 루프 UI 서버 액션 — 스펙 §5. 2026-08-24: 전용 관제 화면(/agent-ops)을 없애고
 * WBS 명세 패널(WbsSpecPanel)의 "진행 상황" 섹션에 흡수했다 — 위임(발행)·회수(취소)는 이미 그 패널의
 * "에이전트 위임" 체크 하나로 되므로 별도 화면이 필요 없었다(사용자 결정). 승인·반려는 여전히 사람만
 * 할 수 있는 행위라 여기 남는다. 알림 href·revalidatePath 는 그 항목이 속한 프로젝트의 WBS 화면을 가리킨다.
 *
 * 쓰기는 admin(service_role) 경유(신규 테이블은 쓰기 RLS 가 없다 — 서버 가드가 유일한 관문).
 * 조회(getAgentOrderForItem)만 세션 클라이언트로 해 RLS 조회 정책을 2차 방어선으로 쓴다.
 */

type ActionResult = { ok: boolean; error?: string; warning?: string }

/**
 * 에이전트 중지/재개(2026-08-24 — 킬스위치). "루프 등록"은 사라졌다: 위임 체크·dev_workflow ON·
 * agent 태그 업로드가 프로젝트를 자동 활성한다(ensureAgentProject). 사람이 명시적으로 하는 건
 * 이 스위치뿐 — 끄면 새 주문이 안 나가고 `GET /agent/me` 에서 프로젝트가 사라져 claim 이 막힌다.
 * 켜면 백필로 dev_workflow 리프 전부에 주문을 보장한다. 권한: 프로젝트 관리자(종전 등록은 슈퍼유저였다 —
 * 위임 체크가 관리자 권한이므로 같은 단계로 내렸다).
 */
export async function setAgentProjectEnabled(projectId: string, enabled: boolean): Promise<ActionResult & { backfilled?: number }> {
  if (!isUuidLike(projectId)) return { ok: false, error: '잘못된 요청입니다.' }
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { data: reg, error: regErr } = await admin
    .from('agent_projects').select('enabled').eq('project_id', projectId).maybeSingle()
  if (regErr) return { ok: false, error: `등록 조회 실패: ${regErr.message}` }
  if (!reg) {
    if (!enabled) return { ok: true } // 활성된 적 없는 프로젝트를 "중지"하는 건 no-op
    const { error: insErr } = await admin.from('agent_projects')
      .insert({ project_id: projectId, created_by: g.actor.userId, note: '설정에서 켬' })
    if (insErr) return { ok: false, error: insErr.message }
  } else if ((reg as { enabled: boolean }).enabled !== enabled) {
    const { error: updErr } = await admin.from('agent_projects')
      .update({ enabled }).eq('project_id', projectId)
    if (updErr) return { ok: false, error: updErr.message }
  }
  let backfilled: number | undefined
  if (enabled) {
    const bf = await backfillProjectOrders(admin, { projectId, actorUserId: g.actor.userId })
    if (!bf.ok) return { ok: false, error: bf.error }
    backfilled = bf.created
  }
  revalidatePath(`/p/${projectId}`, 'layout')
  return backfilled === undefined ? { ok: true } : { ok: true, backfilled }
}

/** 프로젝트 에이전트 활성 상태 — 설정 페이지 표시용. 조회 실패는 null(모름)로 넘긴다 — 위장 금지. */
export async function getAgentProjectState(projectId: string): Promise<{ registered: boolean; enabled: boolean } | null> {
  if (!isUuidLike(projectId)) return null
  const sb = await createServerClient()
  const { data, error } = await sb.from('agent_projects').select('enabled').eq('project_id', projectId).maybeSingle()
  if (error) { console.error('[agentWork] 활성 상태 조회 실패:', error.message); return null }
  if (!data) return { registered: false, enabled: false }
  return { registered: true, enabled: (data as { enabled: boolean }).enabled === true }
}

async function loadOrderForAdmin(orderId: string): Promise<
  | { ok: true; order: { id: string; project_id: string; status: string; wbs_item_id: string | null }; actor: { userId: string } }
  | { ok: false; error: string }
> {
  if (!isUuidLike(orderId)) return { ok: false, error: '잘못된 요청입니다.' }
  const admin = createAdminClient()
  const { data: order, error } = await admin
    .from('agent_work_orders').select('id, project_id, status, wbs_item_id').eq('id', orderId).maybeSingle()
  if (error) return { ok: false, error: `주문 조회 실패: ${error.message}` }
  if (!order) return { ok: false, error: '주문 없음' }
  const row = order as { id: string; project_id: string; status: string; wbs_item_id: string | null }
  const g = await requireProjectAdmin(row.project_id)
  if (!g.ok) return { ok: false, error: g.error }
  return { ok: true, order: row, actor: g.actor }
}

/**
 * 승인/반려 알림 — fire-and-forget. 수신자는 그 항목의 배정자(없으면 발행 생략).
 * work.unblocked 는 여기서 발행하지 않는다 — 정본은 setWbsStage(wbsAssign.ts)의 전체-선행-충족
 * 게이트 경로 하나다. 이 액션은 게이트·dedupeKey 없이 판단해 거짓 알림을 낼 수 있었다(최종 리뷰 I2).
 */
async function notifyReviewResult(
  admin: AdminClient,
  order: { id: string; project_id: string; wbs_item_id: string | null },
  type: 'work.approved' | 'work.rejected',
  actorUserId: string,
) {
  if (!order.wbs_item_id) return
  const { data: itemRow, error } = await admin
    .from('wbs_items').select('name, assignee_member_id')
    .eq('id', order.wbs_item_id).maybeSingle()
  if (error) {
    console.error('[agentWork] 알림용 항목 조회 실패:', error.message)
    return
  }
  if (!itemRow) return
  const item = itemRow as { name: string; assignee_member_id: string | null }
  if (!item.assignee_member_id) return
  emitNotification({
    type, projectId: order.project_id, actorUserId,
    entityType: 'agent_order', entityId: order.id,
    payload: {
      title: item.name,
      detail: type === 'work.approved' ? '완료가 승인되었습니다' : '완료가 반려되었습니다',
      href: `/p/${order.project_id}/wbs`,
    },
    recipientMemberIds: [item.assignee_member_id],
  }).catch(() => {
    // 알림 실패는 로깅만 하고 본 동작에 영향을 주지 않는다.
  })
}

/** 승인 — WBS 100% 반영이 먼저다. 반영 실패면 주문은 reported 로 남아 재시도 가능해야 한다. */
export async function approveAgentCompletion(orderId: string): Promise<ActionResult> {
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  const { order, actor } = loaded
  if (order.status !== 'reported') return { ok: false, error: `승인 가능한 상태가 아닙니다(${order.status}).` }
  if (!order.wbs_item_id) return { ok: false, error: 'WBS 항목이 삭제된 주문입니다. 취소로 정리하세요.' }

  const applied = await updateActual(order.wbs_item_id, 100)
  if (!applied.ok) return { ok: false, error: applied.error ?? 'WBS 반영 실패' }

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data: updated, error: casErr } = await admin
    .from('agent_work_orders')
    .update({ status: 'approved', updated_at: now })
    .eq('id', orderId).eq('status', 'reported')
    .select('id')
  if (casErr) return { ok: false, error: casErr.message }
  if (!updated || updated.length === 0) {
    // WBS 는 100 이 됐는데 주문 전이가 경합으로 밀렸다 — 재시도하면 updateActual(100) 은 멱등.
    // 경합 시나리오: 승인자 A 가 updateActual(100) 을 실행하는 사이 다른 관리자 B 가 같은 주문을
    // 반려(reported→claimed)하면, 이 CAS(.eq('status','reported')) 는 0행이 된다. 이때 WBS 실적은
    // 이미 100%로 반영된 채 남고 주문은 claimed(반려됨)로 보인다 — 침묵하면 사람이 그 사실을 놓친다.
    // 그래서 현재 상태를 재조회해 claimed 면 "실적이 이미 100%로 반영됐다"고 명시적으로 알린다.
    const { data: current, error: reErr } = await admin
      .from('agent_work_orders').select('status').eq('id', orderId).maybeSingle()
    if (reErr) {
      console.error('[agentWork] 승인 경합 재조회 실패:', reErr.message)
    } else if ((current as { status?: string } | null)?.status === 'claimed') {
      return {
        ok: false,
        error: '다른 관리자의 반려와 경합했습니다. WBS 실적이 이미 100%로 반영되었으니 확인 후 정정하세요.',
      }
    }
    return { ok: false, error: '상태가 바뀌어 승인하지 못했습니다. 다시 시도하세요.' }
  }
  const { data: latest, error: latestErr } = await admin
    .from('agent_work_reports').select('id').eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (latestErr || !latest) {
    console.error('[agentWork] 승인 보고 조회 실패:', latestErr?.message ?? '0행')
  } else {
    const { error: revErr } = await admin.from('agent_work_reports')
      .update({ review_action: 'approve', reviewed_by: actor.userId, reviewed_at: now })
      .eq('id', (latest as { id: string }).id).select('id')
    if (revErr) console.error('[agentWork] 승인 기록 실패:', revErr.message)
  }
  await notifyReviewResult(admin, order, 'work.approved', actor.userId)

  // stage 전이 — 사람 검수 통과가 곧 완료(정본: accept 는 사람만).
  // force: dev_workflow 가 꺼져 있어도 넘어간다. 이 게이트가 ok:true 로 조용히 빠져나가는 바람에
  // 승인은 성공인데 stage 만 뒤처진 반쪽 상태가 세 번 재발했고(2026-08-25 mes-runlog 리허설),
  // 그 상태는 승인 버튼으로 자가 복구가 안 된다(:127 에서 status!=='reported' 로 막힌다).
  // wbs_item_id 는 위에서 이미 null 이 아님이 확인됐다.
  let stageWarn: string | null = null
  try {
    const transitioned = await transitionStage(admin, {
      itemId: order.wbs_item_id as string, to: 'xx', fromIn: ['im', 'ip', 'as', 'fp', null],
      actorUserId: actor.userId, force: true,
    })
    if (!transitioned.ok) {
      console.error('[agentWork] 승인 stage 전이 실패:', order.wbs_item_id)
      stageWarn = '승인은 처리됐지만 WBS 단계를 완료로 바꾸지 못했습니다 — 단계를 직접 확인하세요.'
    } else if (transitioned.skipped === 'stage') {
      // 사람이 손으로 옮겨 둔 단계라 자동 전이가 비켜간 것 — 침묵하면 후속 claim 이 막힌 이유를 아무도 못 찾는다.
      console.error('[agentWork] 승인 stage 전이 비적용(현재 단계가 전이 대상 밖):', order.wbs_item_id)
      stageWarn = '승인은 처리됐지만 현재 WBS 단계가 자동 전이 대상이 아니라 그대로 두었습니다 — 단계를 확인하세요.'
    }
  } catch (e) {
    console.error('[agentWork] 승인 stage 전이 예외:', e instanceof Error ? e.message : e)
    stageWarn = '승인은 처리됐지만 WBS 단계 전이 중 오류가 났습니다 — 단계를 직접 확인하세요.'
  }

  revalidatePath(`/p/${order.project_id}/wbs`)
  return stageWarn ? { ok: true, warning: stageWarn } : { ok: true }
}

export async function rejectAgentCompletion(orderId: string, note: string): Promise<ActionResult> {
  const trimmed = note.trim()
  if (!trimmed) return { ok: false, error: '반려 사유가 필요합니다.' }
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  const { order, actor } = loaded
  if (order.status !== 'reported') {
    return { ok: false, error: `반려 가능한 상태가 아닙니다(${order.status}).` }
  }
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data: updated, error: casErr } = await admin
    .from('agent_work_orders')
    .update({ status: 'claimed', updated_at: now })
    .eq('id', orderId).eq('status', 'reported')
    .select('id')
  if (casErr) return { ok: false, error: casErr.message }
  if (!updated || updated.length === 0) return { ok: false, error: '상태가 바뀌어 반려하지 못했습니다.' }
  const { data: latest, error: latestErr } = await admin
    .from('agent_work_reports').select('id').eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (latestErr || !latest) {
    console.error('[agentWork] 반려 보고 조회 실패:', latestErr?.message ?? '0행')
  } else {
    const { error: revErr } = await admin.from('agent_work_reports')
      .update({ review_action: 'reject', reviewed_by: actor.userId, reviewed_at: now, review_note: trimmed })
      .eq('id', (latest as { id: string }).id).select('id')
    if (revErr) console.error('[agentWork] 반려 기록 실패:', revErr.message)
  }
  await notifyReviewResult(admin, order, 'work.rejected', actor.userId)
  revalidatePath(`/p/${order.project_id}/wbs`)
  return { ok: true }
}

/**
 * 이 WBS 항목의 최신 에이전트 주문 — 명세 패널 "진행 상황" 섹션이 읽는다(2026-08-24, agent-ops 대체).
 * 위임한 적 없으면 order:null. 조회 실패는 null 로 위장하지 않고 error 를 그대로 올린다(3원칙).
 * 프로젝트 멤버면 누구나 읽을 수 있다(스펙 읽기와 같은 등급) — 승인·반려 버튼 노출 여부는 호출부가
 * editable(관리자)로 가리고, 액션 자체도 requireProjectAdmin 으로 재검증한다.
 */
export type AgentOrderReport = {
  id: string; kind: 'progress' | 'completion'; percent: number; summary: string
  links: { label?: string; url: string }[]; agent: string
  review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string
}
export type AgentOrderStatus = {
  id: string; status: string
  claimed_by: string | null; claimed_at: string | null; updated_at: string
  reports: AgentOrderReport[]
}
export async function getAgentOrderForItem(itemId: string): Promise<
  | { ok: true; order: AgentOrderStatus | null }
  | { ok: false; error: string }
> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const sb = await createServerClient()
  const { data: item, error: itemErr } = await sb.from('wbs_items').select('project_id').eq('id', itemId).maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '대상을 찾을 수 없습니다.' }
  const g = await requireProjectMember((item as { project_id: string }).project_id)
  if (!g.ok) return { ok: false, error: g.error }

  const { data: order, error: ordErr } = await sb
    .from('agent_work_orders')
    .select('id, status, claimed_by, claimed_at, updated_at')
    .eq('wbs_item_id', itemId)
    .order('updated_at', { ascending: false })
    .limit(1).maybeSingle()
  if (ordErr) return { ok: false, error: `주문 조회 실패: ${ordErr.message}` }
  if (!order) return { ok: true, order: null }
  const row = order as { id: string; status: string; claimed_by: string | null; claimed_at: string | null; updated_at: string }

  const { data: reports, error: repErr } = await sb
    .from('agent_work_reports')
    .select('id, kind, percent, summary, links, agent, review_action, review_note, created_at')
    .eq('work_order_id', row.id)
    .order('created_at', { ascending: true })
  if (repErr) return { ok: false, error: `보고 조회 실패: ${repErr.message}` }
  return { ok: true, order: { ...row, reports: (reports ?? []) as AgentOrderReport[] } }
}
