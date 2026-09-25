'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { backfillProjectOrders } from '@/lib/agent/ensureOrder'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { requireProjectAdmin, requireProjectMember } from '@/lib/authz'
import { after } from 'next/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { isUuidLike, type TokenRow } from '@/lib/domain/agentWork'
import { emitNotification } from '@/lib/notify/emit'
import { applyWorkflowEvent, notifyOnReached, SKIPPED_WARN, type WorkflowEventOk, type WorkflowSkipped } from '@/lib/agent/workflowEvent'
import { requireDelegationRight } from '@/lib/agent/delegation'
import { requireSubtreeManagerOrAdmin } from '@/lib/agent/subtreeManager'

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

/**
 * 승인 자격 로더 — 관리자 또는 서브트리 관리자(트랙 B, 2026-09-15). 완료를 확정하는 결정이라
 * 리프 담당자 본인에게는 주지 않는다(분리 원칙: 자기 완료를 자기가 승인 못 함) — isSubtreeManager
 * 는 strict 조상만 보므로 리프 자신의 담당자는 애초에 이 판정에 걸리지 않는다(assignee.ts 계약).
 * WBS 항목이 삭제된 주문(wbs_item_id 없음)은 조상을 특정할 수 없어 관리자만.
 */
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
  if (row.wbs_item_id === null) {
    const g = await requireProjectAdmin(row.project_id)
    if (!g.ok) return { ok: false, error: g.error }
    return { ok: true, order: row, actor: { userId: g.actor.userId } }
  }
  const right = await requireSubtreeManagerOrAdmin(row.wbs_item_id, row.project_id)
  if (!right.ok) return { ok: false, error: right.error }
  return { ok: true, order: row, actor: right.actor }
}

/**
 * 검토 계열(반려·승인 취소·재작업 요청)의 자격 로더(2026-09-14, 사용자 결정 "담당자 본인도 허용";
 * 2026-09-15 트랙 B — 서브트리 관리자 추가). 승인(approve)은 완료를 확정하는 결정이라 별도로
 * loadOrderForAdmin(관리자 또는 서브트리 관리자, 리프 담당자 본인은 제외)을 쓴다. 이쪽은
 * "되돌리는" 결정이라 더 넓다 — 관리자, 그 항목의 담당자 본인(requireDelegationRight), 그
 * 항목의 서브트리 관리자(requireSubtreeManagerOrAdmin) 중 하나면 된다.
 * 담당자 본인 판정(관리자 포함)을 먼저 보고 실패할 때만 서브트리 관리자를 추가로 본다 — 흔한
 * 경로(관리자·담당자 본인)에서는 조상 조회가 돌지 않는다.
 * WBS 항목이 삭제된 주문(wbs_item_id 없음)은 담당자도 조상도 특정할 수 없어 관리자만.
 */
async function loadOrderForReview(orderId: string): Promise<
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
  if (row.wbs_item_id === null) {
    const g = await requireProjectAdmin(row.project_id)
    if (!g.ok) return { ok: false, error: g.error }
    return { ok: true, order: row, actor: { userId: g.actor.userId } }
  }
  const right = await requireDelegationRight(row.wbs_item_id)
  if (right.ok) return { ok: true, order: row, actor: { userId: right.actor.userId } }
  // 관리자도 리프 담당자 본인도 아니다 — 서브트리 관리자인지 추가로 본다. 최종 거부는
  // requireDelegationRight 의 사유를 그대로 쓴다(ERR_NOT_ASSIGNEE — 기존 계약·테스트 유지).
  const subtree = await requireSubtreeManagerOrAdmin(row.wbs_item_id, row.project_id)
  if (!subtree.ok) return { ok: false, error: right.error }
  return { ok: true, order: row, actor: subtree.actor }
}

/**
 * 승인/반려 알림 — fire-and-forget. 수신자는 그 항목의 배정자(없으면 발행 생략).
 * work.unblocked 는 여기서 발행하지 않는다 — 전이 결과(reachedFirst)를 보고 notifyOnReached(후행의 선행 전체
 * 충족 게이트)가 발행한다. 이 함수가 게이트·dedupeKey 없이 판단하면 거짓 알림을 낼 수 있었다(최종 리뷰 I2).
 */
async function notifyReviewResult(
  admin: AdminClient,
  order: { id: string; project_id: string; wbs_item_id: string | null },
  type: 'work.approved' | 'work.rejected',
  actorUserId: string,
  detail?: string,
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
      detail: detail ?? (type === 'work.approved' ? '완료가 승인되었습니다' : '완료가 반려되었습니다'),
      href: `/p/${order.project_id}/wbs`,
    },
    recipientMemberIds: [item.assignee_member_id],
  }).catch(() => {
    // 알림 실패는 로깅만 하고 본 동작에 영향을 주지 않는다.
  })
}

/** 주문 사건이 단계·실적을 건너뛴 사유가 있으면 사람용 경고로. 사유가 무엇이든 알린다 — 종전 경로에서 'parent' 를 빠뜨려 반쪽 상태가 무음으로 끝난 적이 있다. */
function skippedWarning(skipped: WorkflowSkipped | null): string | undefined {
  if (!skipped) return undefined
  // 모르는 사유도 무음으로 끝내지 않는다 — RPC 가 새 사유를 돌려줘도 여기서 걸리게.
  return SKIPPED_WARN[skipped] ?? `처리는 됐지만 단계·실적을 바꾸지 않았습니다(${skipped}) — 확인하세요.`
}

/** 전이 뒤 공통 부수효과 — 화면 갱신, 실적이 바뀌었으면 진척 스냅샷, im·xx 첫 도달이면 후행 알림. 실패는 로깅만. */
async function afterTransition(
  admin: AdminClient,
  args: { projectId: string; itemId: string | null; actorUserId: string; transition: WorkflowEventOk },
): Promise<void> {
  revalidatePath(`/p/${args.projectId}`, 'layout')
  if (args.transition.actualChanged) after(() => recordProgressSnapshot(args.projectId))
  if (args.transition.reachedFirst && args.itemId) await notifyOnReached(admin, args.itemId, args.actorUserId)
}

/** 최신 completion 보고의 review 필드를 갱신한다 — 전이 뒤 부수 기록이라 실패는 로깅만(전이 자체는 확정됐다). */
async function recordReview(admin: AdminClient, orderId: string, patch: Record<string, unknown>, label: string): Promise<void> {
  const { data: latest, error: latestErr } = await admin
    .from('agent_work_reports').select('id').eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (latestErr || !latest) {
    console.error(`[agentWork] ${label} 보고 조회 실패:`, latestErr?.message ?? '0행')
    return
  }
  const { error: revErr } = await admin.from('agent_work_reports')
    .update(patch).eq('id', (latest as { id: string }).id).select('id')
  if (revErr) console.error(`[agentWork] ${label} 기록 실패:`, revErr.message)
}

/**
 * 승인 — 원자 전이(스펙 2026-09-15 §4). reported→approved CAS + 단계 xx + 실적 100 + change_logs 가 한 트랜잭션이다.
 * 종전에는 실적 100 을 먼저 쓰고 CAS 에서 밀리면 "실적만 100" 인 반쪽 상태가 남았고, 단계 전이는 그 뒤에 따로
 * 실행돼 뒤처지곤 했다(2026-08-25 mes-runlog 리허설 3회). 이제 CAS 가 지면 아무것도 쓰이지 않는다.
 * 주문 사건은 dev_workflow 를 보지 않는다 — 주문의 존재가 곧 워크플로 증거다(구 force 의 일반화).
 * 실적 쓰기가 담당 팀 게이트(updateActual)를 거치지 않는 이유는 종전과 같다 — 승인 자격(관리자·서브트리 관리자)은
 * loadOrderForAdmin 이 이미 확정했고, 실적은 사람이 치는 값이 아니라 승인 사건의 크레딧이다.
 */
export async function approveAgentCompletion(orderId: string): Promise<ActionResult> {
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  const { order, actor } = loaded
  if (order.status !== 'reported') return { ok: false, error: `승인 가능한 상태가 아닙니다(${order.status}).` }
  if (!order.wbs_item_id) return { ok: false, error: 'WBS 항목이 삭제된 주문입니다. 취소로 정리하세요.' }

  const admin = createAdminClient()
  const transition = await applyWorkflowEvent(admin, { event: 'approve', actorUserId: actor.userId, orderId })
  if (!transition.ok) {
    return { ok: false, error: transition.conflict ? '상태가 바뀌어 승인하지 못했습니다. 다시 시도하세요.' : transition.error }
  }
  await recordReview(admin, orderId, { review_action: 'approve', reviewed_by: actor.userId, reviewed_at: new Date().toISOString() }, '승인')
  await notifyReviewResult(admin, order, 'work.approved', actor.userId)
  await afterTransition(admin, { projectId: order.project_id, itemId: order.wbs_item_id, actorUserId: actor.userId, transition })
  const warning = skippedWarning(transition.skipped)
  return warning ? { ok: true, warning } : { ok: true }
}

/** 반려 — 원자 전이. reported→claimed CAS + 단계 ip + 실적 표.rw(반려·재작업 크레딧 — 작업은 했으므로 claim 보다 높다, 스펙 D4). */
export async function rejectAgentCompletion(orderId: string, note: string): Promise<ActionResult> {
  const trimmed = note.trim()
  if (!trimmed) return { ok: false, error: '반려 사유가 필요합니다.' }
  const loaded = await loadOrderForReview(orderId)
  if (!loaded.ok) return loaded
  const { order, actor } = loaded
  if (order.status !== 'reported') {
    return { ok: false, error: `반려 가능한 상태가 아닙니다(${order.status}).` }
  }
  const admin = createAdminClient()
  const transition = await applyWorkflowEvent(admin, { event: 'reject', actorUserId: actor.userId, orderId })
  if (!transition.ok) {
    return { ok: false, error: transition.conflict ? '상태가 바뀌어 반려하지 못했습니다.' : transition.error }
  }
  await recordReview(admin, orderId, { review_action: 'reject', reviewed_by: actor.userId, reviewed_at: new Date().toISOString(), review_note: trimmed }, '반려')
  await notifyReviewResult(admin, order, 'work.rejected', actor.userId)
  await afterTransition(admin, { projectId: order.project_id, itemId: order.wbs_item_id, actorUserId: actor.userId, transition })
  const warning = skippedWarning(transition.skipped)
  return warning ? { ok: true, warning } : { ok: true }
}

/**
 * 승인 되감기 공통부(2026-08-27) — 승인 취소(reported 로)와 재작업 요청(claimed 로). 원자 전이 RPC 가 주문 CAS·
 * 단계·실적을 한 트랜잭션으로 쓴다(스펙 §3.4): 승인 취소 = 단계 im·실적 표.im, 재작업 = 단계 ip·실적 표.rw.
 * 종전에는 change_logs 에서 승인 전 실적을 찾아 되돌렸는데, 승인 이후 이력이 바뀌면 복원을 포기하고 경고만 남겼다.
 * 사건 표의 크레딧으로 쓰면 되돌릴 값을 추측할 필요가 없다.
 *
 * 승인 취소가 단계를 im 에 두는 이유는 그대로다 — im 아래로 내리면 이 항목을 선행으로 둔 후속 작업의 claim 이
 * 다시 막히는데, "선행 완료, 착수 가능" 알림은 이미 나갔고 회수할 수 없다.
 */
async function unapproveOrder(
  orderId: string,
  opts: { to: 'reported' | 'claimed'; note: string | null; detail: string },
): Promise<ActionResult> {
  const loaded = await loadOrderForReview(orderId)
  if (!loaded.ok) return loaded
  const { order, actor } = loaded
  if (order.status !== 'approved') return { ok: false, error: `승인을 무를 수 있는 상태가 아닙니다(${order.status}).` }
  if (!order.wbs_item_id) return { ok: false, error: 'WBS 항목이 삭제된 주문입니다. 취소로 정리하세요.' }

  const admin = createAdminClient()
  const transition = await applyWorkflowEvent(admin, {
    event: opts.to === 'reported' ? 'unapprove' : 'rework', actorUserId: actor.userId, orderId,
  })
  if (!transition.ok) {
    return { ok: false, error: transition.conflict ? '상태가 바뀌어 처리하지 못했습니다. 다시 시도하세요.' : transition.error }
  }
  // 재작업은 반려로 남긴다(사유 보존) — review_action 은 CHECK 로 approve|reject 뿐이고,
  // 에이전트 쪽 반려 감지가 이 값을 본다. 승인 취소는 "아직 검토 안 함"으로 되돌린다.
  const reviewPatch = opts.note === null
    ? { review_action: null, reviewed_by: null, reviewed_at: null, review_note: null }
    : { review_action: 'reject', reviewed_by: actor.userId, reviewed_at: new Date().toISOString(), review_note: opts.note }
  await recordReview(admin, orderId, reviewPatch, '되감기')
  await notifyReviewResult(admin, order, 'work.rejected', actor.userId, opts.detail)
  await afterTransition(admin, { projectId: order.project_id, itemId: order.wbs_item_id, actorUserId: actor.userId, transition })
  const warning = skippedWarning(transition.skipped)
  return warning ? { ok: true, warning } : { ok: true }
}

/** 승인 취소 — 검토 대기열(reported)로 되돌린다. 아무도 작업하지 않는 상태이며 다시 승인/반려할 수 있다. */
export async function unapproveAgentCompletion(orderId: string): Promise<ActionResult> {
  return unapproveOrder(orderId, { to: 'reported', note: null, detail: '완료 승인이 취소되었습니다' })
}

/** 재작업 요청 — 에이전트에게 되돌린다(claimed). 반려와 같은 착지점이라 에이전트 쪽 감지가 그대로 동작한다. */
export async function requestAgentRework(orderId: string, note: string): Promise<ActionResult> {
  const trimmed = note.trim()
  if (!trimmed) return { ok: false, error: '재작업 사유가 필요합니다.' }
  return unapproveOrder(orderId, { to: 'claimed', note: trimmed, detail: '재작업이 요청되었습니다' })
}

/**
 * 이 WBS 항목의 최신 에이전트 주문 + 그 앞에 있던 주문들 — 명세 패널 "진행 상황" 섹션이 읽는다
 * (2026-08-24, agent-ops 대체).
 * 위임한 적 없으면 order:null. 조회 실패는 null 로 위장하지 않고 error 를 그대로 올린다(3원칙).
 * 프로젝트 멤버면 누구나 읽을 수 있다(스펙 읽기와 같은 등급) — 승인·반려 버튼 노출 여부는 호출부가
 * editable(관리자)로 가리고, 액션 자체도 requireProjectAdmin 으로 재검증한다.
 */
export type AgentOrderReport = {
  id: string; kind: 'progress' | 'completion'; percent: number; summary: string
  links: { label?: string; url: string }[]; agent: string
  review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string
  /** 워커 결정 목록(0102). null = 제출 안 됨. 화면은 parseDecisions 로 읽는다. */
  decisions?: unknown
  /** 그 단계를 돌린 모델(0105) — 보고 시점의 heartbeat_model. null = 모름(0105 이전 보고·heartbeat 없음). */
  model?: string | null
}
export type AgentOrderStatus = {
  id: string; status: string
  claimed_by: string | null; claimed_at: string | null; updated_at: string
  /** 마지막 heartbeat 의 실행 모델(0100). last_heartbeat_at 이 null 이면 무효 — orderTimeline 이 거른다. */
  heartbeat_model?: string | null; last_heartbeat_at?: string | null
  reports: AgentOrderReport[]
  /** 주문의 사용 토큰 행(0104, 세션×모델). 화면은 sumTokenUsage 로 합친다. 없으면 빈 배열. */
  tokens?: TokenRow[]
}
/** 이전 주문 한 줄 — 본문 없이 "있었다"는 사실만. 상세는 주문 id 로 단건 조회한다. */
export type AgentOrderBrief = { id: string; status: string; updated_at: string }

export async function getAgentOrderForItem(itemId: string): Promise<
  | { ok: true; order: AgentOrderStatus | null; priorOrders: AgentOrderBrief[]; projectId: string }
  | { ok: false; error: string }
> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const sb = await createServerClient()
  const { data: item, error: itemErr } = await sb.from('wbs_items').select('project_id').eq('id', itemId).maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '대상을 찾을 수 없습니다.' }
  const g = await requireProjectMember((item as { project_id: string }).project_id)
  if (!g.ok) return { ok: false, error: g.error }

  // limit(1) 을 쓰지 않는다 — 한 항목에 주문이 여러 개 쌓인다. approved 는 "활성 주문" 검사
  // 어디에도 안 들어가므로(ensureOrder Step4·wbsImport:361·unique index) 승인된 주문은 항목을
  // 비워주고, 재발행이 새 주문을 만든다. 최신 하나만 읽으면 그 앞의 승인 이력이 통째로 사라진다.
  const { data: orders, error: ordErr } = await sb
    .from('agent_work_orders')
    .select('id, status, claimed_by, claimed_at, updated_at, heartbeat_model, last_heartbeat_at')
    .eq('wbs_item_id', itemId)
    .order('updated_at', { ascending: false })
  if (ordErr) return { ok: false, error: `주문 조회 실패: ${ordErr.message}` }
  const rows = (orders ?? []) as Array<{
    id: string; status: string; claimed_by: string | null; claimed_at: string | null; updated_at: string
    heartbeat_model: string | null; last_heartbeat_at: string | null
  }>
  const projectId = (item as { project_id: string }).project_id
  if (rows.length === 0) return { ok: true, order: null, priorOrders: [], projectId }
  const row = rows[0]
  const priorOrders: AgentOrderBrief[] = rows.slice(1)
    .map(o => ({ id: o.id, status: o.status, updated_at: o.updated_at }))

  const { data: reports, error: repErr } = await sb
    .from('agent_work_reports')
    .select('id, kind, percent, summary, links, agent, review_action, review_note, created_at, decisions, model')
    .eq('work_order_id', row.id)
    .order('created_at', { ascending: true })
  if (repErr) return { ok: false, error: `보고 조회 실패: ${repErr.message}` }
  // 사용 토큰(0104) — 조회 실패를 "토큰 없음"으로 위장하지 않는다(3원칙). 표가 없는 DB(마이그레이션 전)도 실패로 드러난다.
  const { data: tokens, error: tokErr } = await sb
    .from('agent_work_order_tokens')
    .select('model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens')
    .eq('work_order_id', row.id)
  if (tokErr) return { ok: false, error: `토큰 조회 실패: ${tokErr.message}` }
  return { ok: true, order: { ...row, reports: (reports ?? []) as AgentOrderReport[], tokens: (tokens ?? []) as TokenRow[] }, priorOrders, projectId }
}

/**
 * 주문의 최신 completion 보고의 결정 목록(과제 C, 스펙 §7.3) — 오피스 상세 패널이 열릴 때 한 번 읽는다.
 * 좌석표는 수(decision_count)만 싣고 본문을 끌어오지 않으므로 여기서 좁게 읽는다.
 * 세션 클라이언트 + requireProjectMember — getAgentOrderForItem 과 같은 등급이고 RLS 가 2차 방어선이다.
 * 조회 실패를 빈 목록으로 위장하지 않는다(3원칙) — 호출부가 오류 문구와 재시도를 그린다.
 */
export async function getReportDecisions(orderId: string): Promise<
  | { ok: true; decisions: unknown }
  | { ok: false; error: string }
> {
  if (!isUuidLike(orderId)) return { ok: false, error: '잘못된 요청입니다.' }
  const sb = await createServerClient()
  const { data: order, error: orderErr } = await sb.from('agent_work_orders').select('project_id').eq('id', orderId).maybeSingle()
  if (orderErr) return { ok: false, error: `주문 조회 실패: ${orderErr.message}` }
  if (!order) return { ok: false, error: '대상을 찾을 수 없습니다.' }
  const g = await requireProjectMember((order as { project_id: string }).project_id)
  if (!g.ok) return { ok: false, error: g.error }
  const { data: rep, error: repErr } = await sb
    .from('agent_work_reports')
    .select('decisions, created_at')
    .eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1)
    .maybeSingle()
  if (repErr) return { ok: false, error: `보고 조회 실패: ${repErr.message}` }
  if (!rep) return { ok: false, error: '완료 보고가 없습니다.' }
  return { ok: true, decisions: (rep as { decisions: unknown }).decisions ?? null }
}
