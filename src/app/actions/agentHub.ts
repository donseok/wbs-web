'use server'
// 에이전트 허브 액션 — 재조회와 위임 묶음 저장. 판정은 authz 가드로만, 본체는 src/lib/agent/delegation.ts.
// 스펙: docs/superpowers/specs/2026-09-14-agent-hub-design.md §5
import { requireProjectMember } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { getAgentHub } from '@/lib/data/agentHub'
import { viewerEmail } from '@/lib/data/agentSeatmap'
import { myMemberIds } from '@/lib/agent/assignee'
import { applyDelegation, ERR_NOT_ASSIGNEE } from '@/lib/agent/delegation'
import { emitNotification } from '@/lib/notify/emit'
import { approveAgentCompletion, rejectAgentCompletion, requestAgentRework, unapproveAgentCompletion } from '@/app/actions/agentWork'
import { setWbsStage } from '@/app/actions/wbsAssign'
import type { AgentHub } from '@/lib/domain/agentHub'

const ERR_BAD = '잘못된 요청입니다.'
const BULK_MAX = 200

export async function refreshAgentHub(projectId: string): Promise<{ ok: true; hub: AgentHub } | { ok: false; error: string }> {
  if (!isUuidLike(projectId)) return { ok: false, error: ERR_BAD }
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  try {
    return { ok: true, hub: await getAgentHub(projectId, { userId: g.actor.userId, isAdmin: isProjectAdmin(g.actor, projectId) }) }
  } catch (e) {
    // 상세는 로그에, 화면에는 고정 문구 — 조회 실패를 빈 화면으로 위장하지 않되 내부 오류 문자열을 흘리지 않는다.
    console.error('[agentHub] 재조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: '에이전트 현황 재조회에 실패했습니다.' }
  }
}

export type HubDelegationChange = { itemId: string; delegated: boolean }
export type HubDelegationsResult =
  | {
      ok: true
      /** 저장 뒤 다시 읽은 허브. 재조회만 실패하면 null + hubError — 변경은 이미 저장된 상태다. */
      hub: AgentHub | null
      hubError?: string
      failed: { itemId: string; error: string }[]
      warnings: { itemId: string; warning: string }[]
    }
  | { ok: false; error: string }

/**
 * 위임 변경 묶음 저장(2026-09-14 체크 지연 개선). 허브 표의 체크는 클라이언트가 1.5초 모았다가 여기로 한 번에 보낸다.
 *
 * 종전엔 체크 하나 = 액션 2건 직렬(쓰기 + 재조회)에 각각 가드가 붙고, 쓰기 응답에는 revalidatePath 가 만든
 * 페이지 재렌더(18KB·서버 0.5초)까지 실렸는데 허브는 useState(initial) 이라 그 재렌더를 쓰지도 않았다
 * (스테이징 실측 0.8~1.0초 잠김). 이 액션은 가드 1회 → 항목별 applyDelegation → 허브 재조회를 한 응답에 담고
 * revalidatePath 를 부르지 않는다. 허브·WBS 페이지는 둘 다 동적 렌더라 다음 방문 때 새로 읽는다.
 *
 * 자격은 항목마다 setAgentDelegation 과 같다(허브 스펙 §3): 관리자, 또는 그 항목의 담당자 본인(멤버).
 * 멤버의 로스터 판정은 묶음당 1회만 하고, 자격 없는 항목은 그 항목만 failed 로 돌려보낸다.
 * 같은 항목이 여러 번 오면 마지막 값만 적용한다. 다른 프로젝트 항목이 섞이면 묶음 전체를 거부한다.
 */
export async function applyHubDelegations(projectId: string, changes: HubDelegationChange[]): Promise<HubDelegationsResult> {
  if (!isUuidLike(projectId) || !Array.isArray(changes) || changes.length === 0 || changes.length > BULK_MAX
    || !changes.every(c => c != null && typeof c === 'object' && isUuidLike(c.itemId) && typeof c.delegated === 'boolean')) {
    return { ok: false, error: ERR_BAD }
  }
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const isAdmin = isProjectAdmin(g.actor, projectId)
  const wanted = new Map<string, boolean>()
  for (const c of changes) wanted.set(c.itemId, c.delegated)
  const ids = [...wanted.keys()]

  const admin = createAdminClient()
  const { data, error } = await admin.from('wbs_items').select('id, assignee_member_id').eq('project_id', projectId).in('id', ids)
  if (error) return { ok: false, error: `항목 조회 실패: ${error.message}` }
  const items = new Map(((data ?? []) as { id: string; assignee_member_id: string | null }[]).map(i => [i.id, i]))
  if (items.size !== ids.length) return { ok: false, error: '이 프로젝트의 항목이 아닌 것이 있습니다.' }

  // 멤버(비관리자)는 담당자 본인 항목만 — 로스터 판정은 묶음당 1회. 조회 실패는 거부(fail-closed).
  let mine: Set<string> | null = null
  if (!isAdmin) {
    try {
      const email = await viewerEmail(admin, g.actor.userId)
      mine = new Set(await myMemberIds(admin, { userId: g.actor.userId, userEmail: email ?? '', projectId }))
    } catch (e) {
      console.error('[agentHub] 담당자 판정 실패:', e instanceof Error ? e.message : e)
      return { ok: false, error: '담당자 판정에 실패했습니다.' }
    }
  }

  const failed: { itemId: string; error: string }[] = []
  const warnings: { itemId: string; warning: string }[] = []
  for (const itemId of ids) {
    const assignee = items.get(itemId)?.assignee_member_id ?? null
    if (mine && !(assignee && mine.has(assignee))) { failed.push({ itemId, error: ERR_NOT_ASSIGNEE }); continue }
    const r = await applyDelegation(admin, {
      itemId, projectId, delegated: wanted.get(itemId) as boolean, actorUserId: g.actor.userId, isAdmin,
    })
    if (!r.ok) failed.push({ itemId, error: r.error ?? '실패' })
    else if (r.warning) warnings.push({ itemId, warning: r.warning })
  }

  try {
    const hub = await getAgentHub(projectId, { userId: g.actor.userId, isAdmin })
    return { ok: true, hub, failed, warnings }
  } catch (e) {
    // 저장은 끝났다. 재조회만 실패했음을 분명히 알려 클라이언트가 대기분을 되돌리지 않게 한다(표시 = 로깅).
    console.error('[agentHub] 저장 뒤 재조회 실패:', e instanceof Error ? e.message : e)
    return { ok: true, hub: null, hubError: '변경은 저장됐지만 현황 재조회에 실패했습니다. 새로고침을 누르세요.', failed, warnings }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 개발 프로세스 조정(2026-09-14 허브 스펙 §11) — 승인·반려·승인 취소·재작업 요청(=완료 취소)·회수·단계 직접 조정.
// 판정은 기존 액션(agentWork·wbsAssign)이 각자 한다. 여기서는 (1) 관리자 가드 1회, (2) 대상이 이 프로젝트 것인지,
// (3) 실행 뒤 허브 재조회를 한 응답에 싣는 것만 맡는다 — 화면은 요청 1건으로 끝난다(§10 과 같은 원칙).
// ---------------------------------------------------------------------------------------------------------------------

export type WbsStageCode = 'as' | 'fp' | 'ip' | 'im' | 'xx'
const STAGE_CODES: ReadonlySet<string> = new Set(['as', 'fp', 'ip', 'im', 'xx'])

export type HubProcessOp =
  | { kind: 'approve'; orderId: string }
  | { kind: 'reject'; orderId: string; note: string }
  | { kind: 'unapprove'; orderId: string }
  /** 완료 취소 — 승인된(xx) 작업을 에이전트에게 되돌린다. 사용자 결정(2026-09-14): "완료취소 = 재작업 요청". */
  | { kind: 'rework'; orderId: string; note: string }
  /** 사람 회수 — 점유(claimed)를 풀어 대기(ready)로. 작업 루프 스펙의 "응답 없음 카드 사람 회수". */
  | { kind: 'release'; orderId: string }
  | { kind: 'stage'; itemId: string; stage: WbsStageCode | null }

export type HubProcessResult =
  | { ok: true; hub: AgentHub | null; hubError?: string; warning?: string }
  | { ok: false; error: string }

function isProcessOp(op: unknown): op is HubProcessOp {
  if (op === null || typeof op !== 'object') return false
  const o = op as Record<string, unknown>
  const uuid = (v: unknown) => typeof v === 'string' && isUuidLike(v)
  switch (o.kind) {
    case 'approve': case 'unapprove': case 'release':
      return uuid(o.orderId)
    case 'reject': case 'rework':
      return uuid(o.orderId) && typeof o.note === 'string'
    case 'stage':
      return uuid(o.itemId) && (o.stage === null || (typeof o.stage === 'string' && STAGE_CODES.has(o.stage)))
    default:
      return false
  }
}

/**
 * 관리자 회수 — claimed → ready(CAS). 점유·heartbeat 흔적을 지워 표에 옛 에이전트 이름이 남지 않게 한다.
 * 러너는 다음 heartbeat·report 에서 409 를 받고 멈춘다(보고 라우트가 status=claimed 만 받는다).
 * 알림은 러너 반납(release 라우트)과 같은 work.released 를 배정자에게 — fire-and-forget.
 */
async function releaseOrderByAdmin(
  admin: AdminClient, orderId: string, actorUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await admin
    .from('agent_work_orders').select('id, project_id, wbs_item_id, status').eq('id', orderId).maybeSingle()
  if (error) return { ok: false, error: `주문 조회 실패: ${error.message}` }
  const order = data as { id: string; project_id: string; wbs_item_id: string | null; status: string } | null
  if (!order) return { ok: false, error: '주문 없음' }
  if (order.status !== 'claimed') return { ok: false, error: `회수할 수 있는 상태가 아닙니다(${order.status}).` }
  const { data: updated, error: upErr } = await admin
    .from('agent_work_orders')
    .update({
      status: 'ready', claimed_by: null, claimed_by_user_id: null, claimed_at: null,
      last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, heartbeat_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId).eq('status', 'claimed').select('id')
  if (upErr) return { ok: false, error: upErr.message }
  if (!updated || updated.length === 0) return { ok: false, error: '상태가 바뀌어 회수하지 못했습니다. 다시 시도하세요.' }

  let itemName = '작업'
  let assigneeMemberId: string | null = null
  if (order.wbs_item_id) {
    const { data: itemRow, error: itemErr } = await admin
      .from('wbs_items').select('name, assignee_member_id').eq('id', order.wbs_item_id).maybeSingle()
    if (itemErr) console.error('[agentHub] 회수 알림용 항목 조회 실패(알림 계속):', itemErr.message)
    else if (itemRow) {
      const row = itemRow as { name: string; assignee_member_id: string | null }
      itemName = row.name
      assigneeMemberId = row.assignee_member_id ?? null
    }
  }
  emitNotification({
    type: 'work.released', projectId: order.project_id, actorUserId,
    entityType: 'agent_order', entityId: order.id,
    payload: { title: itemName, detail: '관리자가 작업을 회수했습니다', href: `/p/${order.project_id}/agents` },
    recipientMemberIds: assigneeMemberId ? [assigneeMemberId] : [],
  }).catch(() => {})
  return { ok: true }
}

export async function runHubProcessOp(projectId: string, op: HubProcessOp): Promise<HubProcessResult> {
  if (!isUuidLike(projectId) || !isProcessOp(op)) return { ok: false, error: ERR_BAD }
  // 멤버 이상이면 문을 연다 — 승인·회수·단계는 아래에서 관리자만으로 다시 좁히고, 반려·승인 취소·재작업 요청은
  // 내부 액션(loadOrderForReview)이 "관리자 또는 담당자 본인"으로 판정한다(2026-09-14, 사용자 결정 "담당자 본인도 허용").
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const isAdmin = isProjectAdmin(g.actor, projectId)
  // 회수는 담당자에게 넓힌 집합에 없다 — 러너의 점유를 강제로 푸는 관리 행위라 관리자만.
  if (op.kind === 'release' && !isAdmin) return { ok: false, error: '회수는 관리자만 할 수 있습니다.' }
  const admin = createAdminClient()

  // 대상이 이 프로젝트 것인지 화면 단위로 한 번 더 본다 — 내부 액션도 각자 가드하지만, 남의 프로젝트 주문 id 를
  // 이 화면에 끼워 넣는 길은 여기서 닫는다(fail-closed).
  if (op.kind === 'stage') {
    const { data, error } = await admin.from('wbs_items').select('project_id').eq('id', op.itemId).maybeSingle()
    if (error) return { ok: false, error: `항목 조회 실패: ${error.message}` }
    if (!data || (data as { project_id: string }).project_id !== projectId) return { ok: false, error: '이 프로젝트의 항목이 아닙니다.' }
  } else {
    const { data, error } = await admin.from('agent_work_orders').select('project_id').eq('id', op.orderId).maybeSingle()
    if (error) return { ok: false, error: `주문 조회 실패: ${error.message}` }
    if (!data || (data as { project_id: string }).project_id !== projectId) return { ok: false, error: '이 프로젝트의 주문이 아닙니다.' }
  }

  let r: { ok: boolean; error?: string; warning?: string }
  switch (op.kind) {
    case 'approve': r = await approveAgentCompletion(op.orderId); break
    case 'reject': r = await rejectAgentCompletion(op.orderId, op.note); break
    case 'unapprove': r = await unapproveAgentCompletion(op.orderId); break
    case 'rework': r = await requestAgentRework(op.orderId, op.note); break
    case 'release': r = await releaseOrderByAdmin(admin, op.orderId, g.actor.userId); break
    case 'stage': r = await setWbsStage(op.itemId, op.stage); break
  }
  if (!r.ok) return { ok: false, error: r.error ?? '처리에 실패했습니다.' }
  const warning = r.warning ? { warning: r.warning } : {}
  try {
    const hub = await getAgentHub(projectId, { userId: g.actor.userId, isAdmin })
    return { ok: true, hub, ...warning }
  } catch (e) {
    console.error('[agentHub] 조정 뒤 재조회 실패:', e instanceof Error ? e.message : e)
    return { ok: true, hub: null, hubError: '처리는 됐지만 현황 재조회에 실패했습니다. 새로고침을 누르세요.', ...warning }
  }
}
