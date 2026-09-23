// 사이드바 「에이전트」 메뉴의 결재 대기 배지(2026-09-18 사용자 요청) — 서버 전용.
// "승인할 것이 있으면 왼쪽 에이전트 아이콘에 표시가 있어야 사람이 알 수 있다."
//
// 셸 조회(/api/shell)는 내비게이션마다 부르므로 허브 조회(getAgentHub, 8건)를 쓰지 않고 좁게 읽는다:
// 승인 대기(reported) 주문 → 0건이면 끝. 관리자는 그 수 그대로, 아니면 로스터 + 항목 트리를 읽어
// 서브트리 관리자로서 승인할 수 있는 것만 센다(seatOps.ts: 승인은 관리자·서브트리 관리자만).
// service_role 로 읽으므로 RLS 가 없다 — 판정은 여기서 세션 actor 로 직접 한다. 셸 라우트에 가드가 없어
// 임의의 menu=<uuid> 가 들어올 수 있으니, 관리자가 아니면 로스터에 내가 없을 때 0 이다(남의 프로젝트 수를 흘리지 않는다).
//
// 확인 필요 결정 수(과제 C, 스펙 §7.4) — 이미 고른 승인 가능 주문의 completion 보고에서만 센다(같은 성질을 잇는다).
// 주문마다 최신 completion 의 decision_count 만 더한다(반려된 옛 회차와 합산하지 않는다). null(구 CLI)은 0 으로 세지
// 않고 partial 로 알린다. 결정 수 조회만 실패하면 건수는 두고 decisions:null — 모름을 0 으로 위장하지 않는다.
import { createAdminClient } from '@/lib/supabase/admin'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { isSubtreeManagerOf } from '@/lib/domain/seatmap'
import { myMemberIds } from '@/lib/agent/assignee'
import { viewerEmail } from '@/lib/data/agentSeatmap'

type ItemRow = { id: string; parent_id: string | null; assignee_member_id: string | null }
type OrderRow = { id: string; wbs_item_id: string | null }
type DecisionReportRow = { work_order_id: string; decision_count: number | null; created_at: string }

/** 순수 판정 — 관리자면 전부, 아니면 내가 조상 담당자인(서브트리 관리자) 항목의 주문만. */
export function pickApprovable<T extends { wbs_item_id: string | null }>(
  orders: readonly T[],
  items: ReadonlyArray<ItemRow>,
  viewer: { isAdmin: boolean; memberIds: readonly string[] },
): T[] {
  if (viewer.isAdmin) return [...orders]
  if (viewer.memberIds.length === 0) return []
  const itemById = new Map(items.map(i => [i.id, i]))
  const mine = new Set(viewer.memberIds)
  return orders.filter(o => o.wbs_item_id !== null && isSubtreeManagerOf(o.wbs_item_id, itemById, mine))
}

export function countApprovable(
  orders: ReadonlyArray<{ wbs_item_id: string | null }>,
  items: ReadonlyArray<ItemRow>,
  viewer: { isAdmin: boolean; memberIds: readonly string[] },
): number {
  return pickApprovable(orders, items, viewer).length
}

/** 주문마다 최신 completion 의 결정 수 합. 최신이 null(구 CLI)이거나 보고가 없으면 더하지 않고 partial. */
export function sumLatestDecisions(orderIds: readonly string[], reports: ReadonlyArray<DecisionReportRow>): { known: number; partial: boolean } {
  const latest = new Map<string, DecisionReportRow>()
  for (const r of reports) {
    const cur = latest.get(r.work_order_id)
    if (!cur || Date.parse(r.created_at) > Date.parse(cur.created_at)) latest.set(r.work_order_id, r)
  }
  let known = 0
  let partial = false
  for (const id of orderIds) {
    const n = latest.get(id)?.decision_count
    if (typeof n === 'number') known += n
    else partial = true
  }
  return { known, partial }
}

export type PendingApprovals = { count: number; decisions: number | null; decisionsPartial: boolean }
const NONE: PendingApprovals = { count: 0, decisions: 0, decisionsPartial: false }

/** 이 프로젝트에서 내가 승인할 수 있는 결재 대기 수와 거기 딸린 확인 필요 결정 수. 주문 조회 실패는 throw(호출부가 로깅). */
export async function getPendingApprovals(projectId: string): Promise<PendingApprovals> {
  if (!isUuidLike(projectId)) return NONE
  const actor = await getActorForView()
  if (!actor) return NONE
  const admin = createAdminClient()
  const { data: orders, error } = await admin.from('agent_work_orders')
    .select('id, wbs_item_id').eq('project_id', projectId).eq('status', 'reported').limit(500)
  if (error) throw new Error(`[approvals] 결재 대기 조회 실패: ${error.message}`)
  const rows = (orders ?? []) as OrderRow[]
  if (rows.length === 0) return NONE
  let approvable: OrderRow[]
  if (isProjectAdmin(actor, projectId)) {
    approvable = rows
  } else {
    const email = await viewerEmail(admin, actor.userId)
    const memberIds = await myMemberIds(admin, { userId: actor.userId, userEmail: email ?? '', projectId })
    if (memberIds.length === 0) return NONE
    const { data: items, error: itemErr } = await admin.from('wbs_items')
      .select('id, parent_id, assignee_member_id').eq('project_id', projectId)
    if (itemErr) throw new Error(`[approvals] 항목 트리 조회 실패: ${itemErr.message}`)
    approvable = pickApprovable(rows, (items ?? []) as ItemRow[], { isAdmin: false, memberIds })
  }
  if (approvable.length === 0) return NONE
  const ids = approvable.map(o => o.id)
  const { data: reps, error: repErr } = await admin.from('agent_work_reports')
    .select('work_order_id, decision_count, created_at').in('work_order_id', ids).eq('kind', 'completion')
  if (repErr) {
    console.error('[approvals] 확인 필요 결정 수 조회 실패:', repErr.message)
    return { count: approvable.length, decisions: null, decisionsPartial: false }
  }
  const s = sumLatestDecisions(ids, (reps ?? []) as DecisionReportRow[])
  return { count: approvable.length, decisions: s.known, decisionsPartial: s.partial }
}

/** 수만 필요한 호출부용(종전 이름). */
export async function getPendingApprovalCount(projectId: string): Promise<number> {
  return (await getPendingApprovals(projectId)).count
}
