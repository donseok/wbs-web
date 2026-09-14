// 좌석표 조회 — 서버 전용(service_role). 프로젝트 필터는 항상 seatmapProjectIds 로 건다.
// 실패는 throw 한다(에러 3원칙: 조회 실패를 데이터 없음으로 위장하지 않는다).
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/minutes/externalApi'
import type { Actor } from '@/lib/domain/authz'
import { seatmapProjectIds } from '@/lib/authz/agentsAccess'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import {
  assembleSeatmap, type ItemRow, type OrderRow, type ProjectRow, type ReviewRow, type Seatmap, type SeatmapRows, type WatcherRow,
} from '@/lib/domain/seatmap'

/** DONE(approved) 은 최근 7일 것만 층에 접어 둔다. */
export const DONE_WINDOW_MS = 7 * 24 * 3600_000

const ORDER_COLS = 'id, project_id, wbs_item_id, status, claimed_by, claimed_by_user_id, claimed_at, created_at, updated_at, last_heartbeat_at, heartbeat_phase, heartbeat_agent, heartbeat_note'
const ITEM_COLS = 'id, project_id, code, name, parent_id, actual_pct'

function must<T>(what: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`[seatmap] ${what} 조회 실패: ${r.error.message}`)
  return (r.data ?? []) as T
}

export async function fetchSeatmapRows(admin: AdminClient, projectIds: string[] | null, nowMs: number): Promise<SeatmapRows> {
  const empty: SeatmapRows = { orders: [], items: [], parents: [], reviews: [], watchers: [], projects: [] }
  if (projectIds !== null && projectIds.length === 0) return empty

  const doneSince = new Date(nowMs - DONE_WINDOW_MS).toISOString()
  let q = admin.from('agent_work_orders').select(ORDER_COLS)
    .or(`status.in.(ready,claimed,reported),and(status.eq.approved,updated_at.gte.${doneSince})`)
  if (projectIds !== null) q = q.in('project_id', projectIds)
  const orders = must<OrderRow[]>('주문', await q.order('created_at', { ascending: true }).limit(2000))
  if (orders.length === 0) return empty

  const itemIds = [...new Set(orders.map(o => o.wbs_item_id).filter((x): x is string => !!x))]
  const orderIds = orders.map(o => o.id)
  const projIds = [...new Set(orders.map(o => o.project_id))]

  const items = itemIds.length
    ? must<ItemRow[]>('항목', await admin.from('wbs_items').select(ITEM_COLS).in('id', itemIds))
    : []
  const parentIds = [...new Set(items.map(i => i.parent_id).filter((x): x is string => !!x))]
  const [parents, reviews, watchers, projects] = await Promise.all([
    parentIds.length
      ? admin.from('wbs_items').select(ITEM_COLS).in('id', parentIds).then(r => must<ItemRow[]>('부모 항목', r))
      : Promise.resolve([] as ItemRow[]),
    admin.from('agent_work_reports').select('work_order_id, review_action, review_note, created_at')
      .in('work_order_id', orderIds).eq('kind', 'completion').then(r => must<ReviewRow[]>('완료 보고', r)),
    admin.from('agent_watchers').select('id, user_id, project_id, agent, host, slots, busy, until_label, last_seen_at')
      .gte('last_seen_at', new Date(nowMs - WATCHER_TTL_MS).toISOString()).then(r => must<WatcherRow[]>('감시자', r)),
    admin.from('projects').select('id, name').in('id', projIds).then(r => must<ProjectRow[]>('프로젝트', r)),
  ])
  return { orders, items, parents, reviews, watchers, projects }
}

export async function getSeatmap(actor: Actor, nowMs = Date.now()): Promise<Seatmap> {
  const rows = await fetchSeatmapRows(createAdminClient(), seatmapProjectIds(actor), nowMs)
  return assembleSeatmap(rows, nowMs)
}
