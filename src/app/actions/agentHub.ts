'use server'
// 에이전트 허브 액션 — 재조회와 위임 묶음 저장. 판정은 authz 가드로만, 본체는 src/lib/agent/delegation.ts.
// 스펙: docs/superpowers/specs/2026-09-14-agent-hub-design.md §5
import { requireProjectMember } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { isUuidLike, resumeHostFromClaimLabel } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { getAgentHub } from '@/lib/data/agentHub'
import { viewerEmail } from '@/lib/data/agentSeatmap'
import { myMemberIds } from '@/lib/agent/assignee'
import { applyDelegation, ERR_NOT_ASSIGNEE } from '@/lib/agent/delegation'
import { requireSubtreeManagerOrAdmin } from '@/lib/agent/subtreeManager'
import { emitNotification } from '@/lib/notify/emit'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { after } from 'next/server'
import { approveAgentCompletion, rejectAgentCompletion, requestAgentRework, unapproveAgentCompletion } from '@/app/actions/agentWork'
import { setWbsStage } from '@/app/actions/wbsAssign'
import type { AgentHub } from '@/lib/domain/agentHub'
import { STAGE_CODES as DOMAIN_STAGE_CODES, type StageCode } from '@/lib/domain/stageLabels'

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
  let actualChanged = false
  for (const itemId of ids) {
    const assignee = items.get(itemId)?.assignee_member_id ?? null
    if (mine && !(assignee && mine.has(assignee))) { failed.push({ itemId, error: ERR_NOT_ASSIGNEE }); continue }
    const r = await applyDelegation(admin, {
      itemId, projectId, delegated: wanted.get(itemId) as boolean, actorUserId: g.actor.userId, isAdmin,
    })
    if (!r.ok) failed.push({ itemId, error: r.error ?? '실패' })
    else if (r.warning) warnings.push({ itemId, warning: r.warning })
    if (r.ok && r.actualChanged) actualChanged = true
  }
  // 위임 해제가 진행 중 작업을 멈추고 단계를 as 로 되돌려 실적이 바뀌었으면 진척 스냅샷을 남긴다(묶음당 1회).
  if (actualChanged) after(() => recordProgressSnapshot(projectId))

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
// 개발 프로세스 조정(2026-09-14 허브 스펙 §11, 2026-09-15 트랙 B — 서브트리 관리자 추가) —
// 승인·반려·승인 취소·재작업 요청(=완료 취소)·중단·단계 직접 조정. 세부 자격(관리자 또는
// 서브트리 관리자, 반려 계열은 +담당자 본인)은 기존 액션(agentWork·wbsAssign)이 각자 한다.
// 여기서는 (1) 멤버 가드 1회, (2) 대상이 이 프로젝트 것인지, (3) 중단·재개 요청만 별도로 좁히는 것,
// (4) 실행 뒤 허브 재조회를 한 응답에 싣는 것을 맡는다 — 화면은 요청 1건으로 끝난다(§10 과 같은 원칙).
// ---------------------------------------------------------------------------------------------------------------------

/** 허브 단계 조정이 받는 코드 — 정본은 stageLabels(fp 는 0096 에서 제거). */
export type WbsStageCode = StageCode
const STAGE_CODES: ReadonlySet<string> = new Set(DOMAIN_STAGE_CODES)

export type HubProcessOp =
  | { kind: 'approve'; orderId: string }
  | { kind: 'reject'; orderId: string; note: string }
  | { kind: 'unapprove'; orderId: string }
  /** 완료 취소 — 승인된(xx) 작업을 에이전트에게 되돌린다. 사용자 결정(2026-09-14): "완료취소 = 재작업 요청". */
  | { kind: 'rework'; orderId: string; note: string }
  /**
   * 중단(2026-09-19, 옛 "회수") — 진행 중(claimed) 작업의 위임을 끄고 주문을 cancelled 로. 워커는 다음
   * heartbeat 에서 409 cancelled 를 받고 멈춘다. 다시 맡기려면 사람이 위임 체크를 켠다.
   */
  | { kind: 'stop'; orderId: string }
  /** 재개 요청 — 멈춘(무응답·끊김) 좌석을 팀장이 이어받아 달라는 표식. 상태 전이가 아니다. */
  | { kind: 'resume'; orderId: string }
  | { kind: 'stage'; itemId: string; stage: WbsStageCode | null }

export type HubProcessResult =
  | { ok: true; hub: AgentHub | null; hubError?: string; warning?: string }
  | { ok: false; error: string }

function isProcessOp(op: unknown): op is HubProcessOp {
  if (op === null || typeof op !== 'object') return false
  const o = op as Record<string, unknown>
  const uuid = (v: unknown) => typeof v === 'string' && isUuidLike(v)
  switch (o.kind) {
    case 'approve': case 'unapprove': case 'stop': case 'resume':
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
 * 중단 본체(2026-09-19 중단 설계 §1) — 호출부(runHubProcessOp)가 관리자 또는 서브트리 관리자로 자격을 이미 가렸다.
 *
 * 위임 해제 경로(applyDelegation, delegated:false)를 그대로 탄다: 태그 해제 → ready·claimed 주문 cancelled(CAS)
 * → claimed 를 취소했으면 set_stage as. 체크 해제로 위임을 끄는 길과 똑같이 동작하게 하려는 것이다.
 * release 사건(→ ready)을 쓰지 않는 이유: ready 를 거치면 그 사이 /dflow-team·/dflow-poll 이 다시 집어 가
 * 같은 태스크를 두 워커가 동시에 개발한다. cancelled 는 종착 상태라 그 틈이 없다.
 * WBS 항목이 지워진 주문은 위임 태그가 없으므로 주문만 CAS 로 cancelled 로 바꾼다.
 * 알림은 러너 반납(release 라우트)과 같은 work.released 타입을 배정자에게 — fire-and-forget.
 */
async function stopOrderByAdmin(
  admin: AdminClient, orderId: string, actorUserId: string, projectId: string, isAdmin: boolean,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const { data, error } = await admin
    .from('agent_work_orders').select('id, project_id, wbs_item_id, status').eq('id', orderId).maybeSingle()
  if (error) return { ok: false, error: `주문 조회 실패: ${error.message}` }
  const order = data as { id: string; project_id: string; wbs_item_id: string | null; status: string } | null
  if (!order) return { ok: false, error: '주문 없음' }
  if (order.status !== 'claimed') return { ok: false, error: `중단할 수 있는 상태가 아닙니다(${order.status}).` }

  let warning: string | undefined
  if (order.wbs_item_id) {
    const r = await applyDelegation(admin, { itemId: order.wbs_item_id, projectId, delegated: false, actorUserId, isAdmin })
    if (!r.ok) return { ok: false, error: r.error ?? '중단에 실패했습니다.' }
    // 위임 해제는 항목 단위라, 그 사이 이 주문이 보고(reported)로 넘어갔으면 이 주문은 멈추지 않았다 — 성공으로 덮지 않는다.
    if (!(r.cancelledClaimedIds ?? []).includes(orderId)) {
      return { ok: false, error: '상태가 바뀌어 작업을 중단하지 못했습니다 — 위임은 해제됐습니다. 새로고침 후 확인하세요.' }
    }
    warning = r.warning
    // 허브 액션은 페이지 재렌더를 싣지 않는다(응답의 hub 로 갱신) — 실적이 바뀌었으면 진척 스냅샷만 남긴다.
    if (r.actualChanged) after(() => recordProgressSnapshot(projectId))
  } else {
    const { data: updated, error: upErr } = await admin
      .from('agent_work_orders')
      .update({ status: 'cancelled', claimed_by: null, claimed_by_user_id: null, claimed_at: null, updated_at: new Date().toISOString() })
      .eq('id', orderId).eq('status', 'claimed')
      .select('id')
    if (upErr) return { ok: false, error: `주문 취소 실패: ${upErr.message}` }
    if (!updated || (updated as unknown[]).length === 0) {
      return { ok: false, error: '상태가 바뀌어 작업을 중단하지 못했습니다. 다시 시도하세요.' }
    }
  }

  let itemName = '작업'
  let assigneeMemberId: string | null = null
  if (order.wbs_item_id) {
    const { data: itemRow, error: itemErr } = await admin
      .from('wbs_items').select('name, assignee_member_id').eq('id', order.wbs_item_id).maybeSingle()
    if (itemErr) console.error('[agentHub] 중단 알림용 항목 조회 실패(알림 계속):', itemErr.message)
    else if (itemRow) {
      const row = itemRow as { name: string; assignee_member_id: string | null }
      itemName = row.name
      assigneeMemberId = row.assignee_member_id ?? null
    }
  }
  emitNotification({
    type: 'work.released', projectId: order.project_id, actorUserId,
    entityType: 'agent_order', entityId: order.id,
    payload: { title: itemName, detail: '관리자가 작업을 중단했습니다', href: `/p/${order.project_id}/agents` },
    recipientMemberIds: assigneeMemberId ? [assigneeMemberId] : [],
  }).catch(() => {})
  return warning ? { ok: true, warning } : { ok: true }
}

/**
 * 재개 요청 본체 — 주문은 claimed 그대로 두고 표식 세 열만 얹는다(0099).
 * 상태를 바꾸지 않는 이유: 중단(stop)은 주문을 끝내고 claimed_by 를 지우는데, 그러면 어느 PC 의
 * 워크트리에 산출물이 남아 있는지 알 길이 없어진다. 워커는 개발 마지막 단계에서만 push 하므로
 * 진행 중 작업의 원격 브랜치는 대개 없다 — 점유 라벨이 유일한 좌표다.
 * updated_at 을 건드리지 않는 것도 의도다: 그 열은 좌석 침묵 판정(lastSignalMs)의 재료라,
 * 여기서 touch 하면 멈춘 좌석이 ACTIVE 로 되돌아가 요청한 사람이 상황을 잘못 읽는다.
 * 같은 버튼을 두 번 눌러도 같은 행을 덮어쓸 뿐이다(단일 슬롯).
 */
async function requestResumeOnOrder(
  admin: AdminClient, orderId: string, actorUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await admin
    .from('agent_work_orders').select('id, status, claimed_by').eq('id', orderId).maybeSingle()
  if (error) return { ok: false, error: `주문 조회 실패: ${error.message}` }
  const order = data as { id: string; status: string; claimed_by: string | null } | null
  if (!order) return { ok: false, error: '주문 없음' }
  if (order.status !== 'claimed') return { ok: false, error: `재개를 요청할 수 있는 상태가 아닙니다(${order.status}).` }
  // 호스트는 서버가 점유 라벨에서 파생한다 — 클라이언트가 보낸 값을 믿으면 엉뚱한 PC 가 집어 간다.
  const host = resumeHostFromClaimLabel(order.claimed_by)
  if (!host) {
    return { ok: false, error: '점유 라벨에서 이어받을 PC 를 읽지 못했습니다 — 중단한 뒤 다시 위임하세요.' }
  }
  const { data: updated, error: upErr } = await admin
    .from('agent_work_orders')
    .update({ resume_requested_at: new Date().toISOString(), resume_requested_by: actorUserId, resume_requested_host: host })
    .eq('id', orderId).eq('status', 'claimed')
    .select('id')
  if (upErr) return { ok: false, error: `재개 요청 기록 실패: ${upErr.message}` }
  if (!updated || (updated as unknown[]).length === 0) {
    return { ok: false, error: '상태가 바뀌어 재개를 요청하지 못했습니다. 다시 시도하세요.' }
  }
  return { ok: true }
}

export async function runHubProcessOp(projectId: string, op: HubProcessOp): Promise<HubProcessResult> {
  if (!isUuidLike(projectId) || !isProcessOp(op)) return { ok: false, error: ERR_BAD }
  // 멤버 이상이면 문을 연다 — 승인·단계는 내부 액션(loadOrderForAdmin·setWbsStage)이 "관리자 또는
  // 서브트리 관리자"로, 반려·승인 취소·재작업 요청은 내부 액션(loadOrderForReview)이 "관리자·담당자
  // 본인·서브트리 관리자"로 판정한다(2026-09-14 담당자 본인, 2026-09-15 트랙 B 서브트리 관리자).
  // 중단·재개 요청은 아래서 별도로 좁힌다 — 남의 PC 러너를 세우거나 되살리는 관리 행위라 일반 멤버에겐 안 연다.
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const isAdmin = isProjectAdmin(g.actor, projectId)
  const admin = createAdminClient()

  // 대상이 이 프로젝트 것인지 화면 단위로 한 번 더 본다 — 내부 액션도 각자 가드하지만, 남의 프로젝트 주문 id 를
  // 이 화면에 끼워 넣는 길은 여기서 닫는다(fail-closed). stop·resume 은 이 조회로 얻은 wbs_item_id 를
  // 아래 서브트리 관리자 판정에도 그대로 쓴다(재조회 없이).
  let orderItemId: string | null = null
  if (op.kind === 'stage') {
    const { data, error } = await admin.from('wbs_items').select('project_id').eq('id', op.itemId).maybeSingle()
    if (error) return { ok: false, error: `항목 조회 실패: ${error.message}` }
    if (!data || (data as { project_id: string }).project_id !== projectId) return { ok: false, error: '이 프로젝트의 항목이 아닙니다.' }
  } else {
    const { data, error } = await admin.from('agent_work_orders').select('project_id, wbs_item_id').eq('id', op.orderId).maybeSingle()
    if (error) return { ok: false, error: `주문 조회 실패: ${error.message}` }
    if (!data || (data as { project_id: string }).project_id !== projectId) return { ok: false, error: '이 프로젝트의 주문이 아닙니다.' }
    orderItemId = (data as { wbs_item_id: string | null }).wbs_item_id
  }

  // 중단은 관리자 또는 서브트리 관리자(트랙 B, 2026-09-15 — 옛 회수와 같은 자격). WBS 항목이 삭제된 주문
  // (wbs_item_id 없음)은 조상을 특정할 수 없어 관리자만.
  // 재개 요청도 같은 축이다 — 남의 PC 러너를 되살리라고 지시하는 관리 행위라 담당자 본인에게는 열지 않는다.
  if ((op.kind === 'stop' || op.kind === 'resume') && !isAdmin) {
    // 문구는 op 마다 통째로 둔다 — 조사를 붙여 만들면 "재개 요청는" 같은 말이 나온다.
    const [adminOnly, subtreeOnly] = op.kind === 'stop'
      ? ['중단은 관리자만 할 수 있습니다.', '중단은 관리자 또는 서브트리 관리자만 할 수 있습니다.']
      : ['재개 요청은 관리자만 할 수 있습니다.', '재개 요청은 관리자 또는 서브트리 관리자만 할 수 있습니다.']
    if (!orderItemId) return { ok: false, error: adminOnly }
    const subtree = await requireSubtreeManagerOrAdmin(orderItemId, projectId)
    if (!subtree.ok) return { ok: false, error: subtreeOnly }
  }

  let r: { ok: boolean; error?: string; warning?: string }
  switch (op.kind) {
    case 'approve': r = await approveAgentCompletion(op.orderId); break
    case 'reject': r = await rejectAgentCompletion(op.orderId, op.note); break
    case 'unapprove': r = await unapproveAgentCompletion(op.orderId); break
    case 'rework': r = await requestAgentRework(op.orderId, op.note); break
    case 'stop': r = await stopOrderByAdmin(admin, op.orderId, g.actor.userId, projectId, isAdmin); break
    case 'resume': r = await requestResumeOnOrder(admin, op.orderId, g.actor.userId); break
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
