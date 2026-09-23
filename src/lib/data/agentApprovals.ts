// 사이드바 「에이전트」 메뉴의 결재 대기 배지(2026-09-18 사용자 요청) — 서버 전용.
// "승인할 것이 있으면 왼쪽 에이전트 아이콘에 표시가 있어야 사람이 알 수 있다."
//
// 셸 조회(/api/shell)는 내비게이션마다 부르므로 허브 조회(getAgentHub, 8건)를 쓰지 않고 좁게 읽는다:
// 승인 대기(reported) 주문 → 0건이면 끝. 관리자는 그 수 그대로, 아니면 로스터 + 항목 트리를 읽어
// 서브트리 관리자로서 승인할 수 있는 것만 센다(seatOps.ts: 승인은 관리자·서브트리 관리자만).
// service_role 로 읽으므로 RLS 가 없다 — 판정은 여기서 세션 actor 로 직접 한다. 셸 라우트에 가드가 없어
// 임의의 menu=<uuid> 가 들어올 수 있으니, 관리자가 아니면 로스터에 내가 없을 때 0 이다(남의 프로젝트 수를 흘리지 않는다).
import { createAdminClient } from '@/lib/supabase/admin'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { isSubtreeManagerOf } from '@/lib/domain/seatmap'
import { myMemberIds } from '@/lib/agent/assignee'
import { viewerEmail } from '@/lib/data/agentSeatmap'
import { stubPendingByItem } from '@/lib/domain/forceProgress'

type ItemRow = { id: string; parent_id: string | null; assignee_member_id: string | null; stub_for?: string | null }

type StubRow = { id: string; parent_id: string | null; stub_for: string | null; stage: string | null }

/** 순수 판정 — 관리자면 전부, 아니면 내가 조상 담당자인(서브트리 관리자) 항목의 주문만.
 *  스텁 잔존(강제 진행 스펙 §3.6) 주문은 지금 승인할 수 없으므로 세지 않는다 — stubRows 는 주문 항목들의 stub 하위. */
export function countApprovable(
  orders: ReadonlyArray<{ wbs_item_id: string | null }>,
  items: ReadonlyArray<ItemRow>,
  viewer: { isAdmin: boolean; memberIds: readonly string[] },
  stubRows: ReadonlyArray<StubRow> = [],
): number {
  const locked = stubPendingByItem(stubRows)
  const approvable = orders.filter(o => o.wbs_item_id === null || !locked.has(o.wbs_item_id))
  if (viewer.isAdmin) return approvable.length
  if (viewer.memberIds.length === 0) return 0
  const itemById = new Map(items.map(i => [i.id, i]))
  const mine = new Set(viewer.memberIds)
  return approvable.filter(o => o.wbs_item_id !== null && isSubtreeManagerOf(o.wbs_item_id, itemById, mine)).length
}

/** 이 프로젝트에서 내가 승인할 수 있는 결재 대기 수. 비로그인·잘못된 id 는 0. 조회 실패는 throw(호출부가 로깅). */
export async function getPendingApprovalCount(projectId: string): Promise<number> {
  if (!isUuidLike(projectId)) return 0
  const actor = await getActorForView()
  if (!actor) return 0
  const admin = createAdminClient()
  const { data: orders, error } = await admin.from('agent_work_orders')
    .select('wbs_item_id').eq('project_id', projectId).eq('status', 'reported').limit(500)
  if (error) throw new Error(`[approvals] 결재 대기 조회 실패: ${error.message}`)
  const rows = (orders ?? []) as Array<{ wbs_item_id: string | null }>
  if (rows.length === 0) return 0
  // 스텁 잔존 주문은 세지 않는다 — 주문 항목들의 stub 하위만 좁게 읽는다(셸 조회 원칙).
  const orderItemIds = rows.map(r => r.wbs_item_id).filter((x): x is string => x !== null)
  const { data: stubData, error: stubErr } = orderItemIds.length === 0
    ? { data: [], error: null }
    : await admin.from('wbs_items').select('id, parent_id, stub_for, stage').in('parent_id', orderItemIds).not('stub_for', 'is', null)
  if (stubErr) throw new Error(`[approvals] 스텁 하위 조회 실패: ${stubErr.message}`)
  const stubRows = (stubData ?? []) as StubRow[]
  if (isProjectAdmin(actor, projectId)) return countApprovable(rows, [], { isAdmin: true, memberIds: [] }, stubRows)
  const email = await viewerEmail(admin, actor.userId)
  const memberIds = await myMemberIds(admin, { userId: actor.userId, userEmail: email ?? '', projectId })
  if (memberIds.length === 0) return 0
  const { data: items, error: itemErr } = await admin.from('wbs_items')
    .select('id, parent_id, assignee_member_id, stub_for').eq('project_id', projectId)
  if (itemErr) throw new Error(`[approvals] 항목 트리 조회 실패: ${itemErr.message}`)
  return countApprovable(rows, (items ?? []) as ItemRow[], { isAdmin: false, memberIds }, stubRows)
}
