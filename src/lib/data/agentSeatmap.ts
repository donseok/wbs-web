// 좌석표 조회 — 서버 전용(service_role). 프로젝트 필터는 항상 seatmapProjectIds 로 건다.
// 실패는 throw 한다(에러 3원칙: 조회 실패를 데이터 없음으로 위장하지 않는다).
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/minutes/externalApi'
import type { Actor } from '@/lib/domain/authz'
import { seatmapProjectIds } from '@/lib/authz/agentsAccess'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import {
  assembleSeatmap, type ItemRow, type OrderRow, type ProjectRow, type ReviewRow, type Seatmap, type SeatmapRows, type SeatmapScope, type WatcherRow,
} from '@/lib/domain/seatmap'

/** DONE(approved) 은 최근 7일 것만 층에 접어 둔다. */
export const DONE_WINDOW_MS = 7 * 24 * 3600_000

const ORDER_COLS = 'id, project_id, wbs_item_id, status, claimed_by, claimed_by_user_id, claimed_at, created_at, updated_at, last_heartbeat_at, heartbeat_phase, heartbeat_agent, heartbeat_note'
const ITEM_COLS = 'id, project_id, code, name, parent_id, actual_pct, assignee_member_id, tags'

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
  const orders = must<OrderRow[]>('주문', await q.order('created_at', { ascending: false }).limit(2000))
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

/**
 * 내 로스터 행 id — 접근 가능 프로젝트(null = 전체)의 project_members 중 user_id 가 나이거나 이메일이 같은(대소문자 무시) 행.
 * scope=assigned(src/lib/agent/assignee.ts)와 같은 이중 매칭. 실패는 throw.
 */
export async function fetchMyMemberIds(
  admin: AdminClient, who: { userId: string; userEmail: string | null }, projectIds: string[] | null,
): Promise<string[]> {
  if (projectIds !== null && projectIds.length === 0) return []
  let q = admin.from('project_members').select('id, user_id, email')
  if (projectIds !== null) q = q.in('project_id', projectIds)
  const rows = must<Array<{ id: string; user_id: string | null; email: string | null }>>('로스터', await q)
  const email = who.userEmail?.toLowerCase() ?? null
  const out: string[] = []
  for (const m of rows) {
    if (m.user_id === who.userId || (email !== null && m.email !== null && m.email.toLowerCase() === email)) out.push(m.id)
  }
  return out
}

/** 뷰어의 이메일 — 로스터 이메일 매칭용. 실패는 throw(내 작업이 조용히 빠지면 안 된다). */
export async function viewerEmail(admin: AdminClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error) throw new Error(`[seatmap] 뷰어 조회 실패: ${error.message}`)
  return data.user?.email ?? null
}

export interface SeatmapOptions { projectId?: string }

/**
 * 층 목록 — projectId 가 있으면 접근 가능 범위와 교집합(슈퍼유저는 그대로 [projectId]).
 * 범위 밖이면 [] 라 조회가 일어나지 않는다. 페이지 게이트를 통과했어도 여기서 다시 좁힌다(fail-closed).
 */
export function seatmapFloorIds(actor: Actor, projectId?: string): string[] | null {
  const ids = seatmapProjectIds(actor)
  if (projectId === undefined) return ids
  if (ids === null) return [projectId]
  return ids.includes(projectId) ? [projectId] : []
}

export async function getSeatmap(actor: Actor, nowMs = Date.now(), scope: SeatmapScope = 'mine', opts: SeatmapOptions = {}): Promise<Seatmap> {
  const admin = createAdminClient()
  const projectIds = seatmapFloorIds(actor, opts.projectId)
  const rows = await fetchSeatmapRows(admin, projectIds, nowMs)
  if (scope === 'all') return assembleSeatmap(rows, nowMs)
  const memberIds = await fetchMyMemberIds(admin, { userId: actor.userId, userEmail: await viewerEmail(admin, actor.userId) }, projectIds)
  return assembleSeatmap(rows, nowMs, { mine: { userId: actor.userId, memberIds: new Set(memberIds) } })
}

export interface ProjectOffice { projectName: string | null; seatmap: Seatmap }

/** 프로젝트 가상 오피스 — 이름 + 이 프로젝트 층 하나. 프로젝트가 없으면 projectName null(페이지가 notFound 로 보낸다). */
export async function getProjectOffice(actor: Actor, projectId: string, nowMs = Date.now(), scope: SeatmapScope = 'mine'): Promise<ProjectOffice> {
  const admin = createAdminClient()
  const [project, seatmap] = await Promise.all([
    admin.from('projects').select('id, name').eq('id', projectId).maybeSingle().then(r => {
      if (r.error) throw new Error(`[seatmap] 프로젝트 조회 실패: ${r.error.message}`)
      return r.data as { id: string; name: string } | null
    }),
    getSeatmap(actor, nowMs, scope, { projectId }),
  ])
  return { projectName: project?.name ?? null, seatmap }
}
