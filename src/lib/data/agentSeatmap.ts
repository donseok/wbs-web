// 좌석표 조회 — 서버 전용(service_role). 프로젝트 필터는 항상 seatmapProjectIds 로 건다.
// 실패는 throw 한다(에러 3원칙: 조회 실패를 데이터 없음으로 위장하지 않는다).
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { isProjectAdmin, type Actor } from '@/lib/domain/authz'
import { seatmapProjectIds } from '@/lib/authz/agentsAccess'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import {
  assembleSeatmap, type ItemRow, type LeaseRow, type MemberRow, type OrderRow, type PredecessorRow, type ProjectRow, type ReportRow, type ReviewRow, type Seatmap, type SeatmapRows, type SeatmapScope, type SeatmapViewer, type WatcherRow,
} from '@/lib/domain/seatmap'

/** DONE(approved) 은 최근 7일 것만 층에 접어 둔다. */
export const DONE_WINDOW_MS = 7 * 24 * 3600_000
/** 보고 말풍선 재료의 창 — 하루 넘은 보고는 말풍선으로 띄울 일이 없다. */
const REPORT_WINDOW_MS = 24 * 3600_000

const ORDER_COLS = 'id, project_id, wbs_item_id, status, claimed_by, claimed_by_user_id, claimed_at, created_at, updated_at, last_heartbeat_at, heartbeat_phase, heartbeat_agent, heartbeat_note, heartbeat_model, resume_requested_at, resume_requested_host'
const ITEM_COLS = 'id, project_id, code, name, parent_id, actual_pct, assignee_member_id, tags, depends, model, stub_for, depends_waived, planned_start, stage, external_ref'

function must<T>(what: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`[seatmap] ${what} 조회 실패: ${r.error.message}`)
  return (r.data ?? []) as T
}

/** 조상 사슬을 뿌리까지 올라가며 모은다(최대 12단 — 순환·이상 데이터 방어).
 *  구역 라벨은 부모 1단만 쓰지만 서브트리 관리자 판정은 strict 조상 전체를 봐야 한다(스튜디오 v7 결재). */
async function fetchAncestors(admin: AdminClient, seedIds: string[]): Promise<ItemRow[]> {
  const out = new Map<string, ItemRow>()
  let frontier = seedIds
  for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
    const rows = must<ItemRow[]>('조상 항목', await admin.from('wbs_items').select(ITEM_COLS).in('id', frontier))
    for (const r of rows) out.set(r.id, r)
    frontier = [...new Set(rows.map(r => r.parent_id).filter((x): x is string => x !== null && !out.has(x)))]
  }
  return [...out.values()]
}

export async function fetchSeatmapRows(admin: AdminClient, projectIds: string[] | null, nowMs: number): Promise<SeatmapRows> {
  const empty: SeatmapRows = { orders: [], items: [], parents: [], reviews: [], watchers: [], projects: [], members: [], predecessors: [], leases: [] }
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
  // 보고 말풍선 — 점유·보고 중 주문의 최근 하루치만. 말풍선은 주문마다 마지막 한 줄이면 된다.
  const liveIds = orders.filter(o => o.status === 'claimed' || o.status === 'reported').map(o => o.id)
  const [parents, reviews, watchers, projects, members, reports, leases] = await Promise.all([
    parentIds.length ? fetchAncestors(admin, parentIds) : Promise.resolve([] as ItemRow[]),
    admin.from('agent_work_reports').select('work_order_id, review_action, review_note, created_at')
      .in('work_order_id', orderIds).eq('kind', 'completion').then(r => must<ReviewRow[]>('완료 보고', r)),
    admin.from('agent_watchers').select('id, user_id, project_id, agent, host, slots, busy, until_label, last_seen_at')
      .gte('last_seen_at', new Date(nowMs - WATCHER_TTL_MS).toISOString()).then(r => must<WatcherRow[]>('감시자', r)),
    admin.from('projects').select('id, name').in('id', projIds).then(r => must<ProjectRow[]>('프로젝트', r)),
    // 로스터는 담당자 이름·PAT 계정 매칭 재료(착수 대기 사유 §2). 층 프로젝트 범위로만.
    admin.from('project_members').select('id, project_id, user_id, name').in('project_id', projIds).then(r => must<MemberRow[]>('로스터', r)),
    liveIds.length
      ? admin.from('agent_work_reports').select('work_order_id, kind, summary, created_at')
        .in('work_order_id', liveIds).gte('created_at', new Date(nowMs - REPORT_WINDOW_MS).toISOString())
        .order('created_at', { ascending: false }).limit(500).then(r => must<ReportRow[]>('최근 보고', r))
      : Promise.resolve([] as ReportRow[]),
    (() => {
      const lq = admin.from('agent_lead_leases').select('user_id, project_id, host, agent, renewed_at, expires_at')
        .not('holder', 'is', null).gt('expires_at', new Date(nowMs).toISOString()).in('project_id', projIds)
      return lq.then(r => must<LeaseRow[]>('팀장 lease', r))
    })(),
  ])
  // 선행 항목 — ready 주문 항목의 depends 만 모아 프로젝트 안 external_ref 로 1회, 그 id 의 approved 주문 1회. ref 가 없으면 0회.
  // 승인 주문은 위 주문 조회(7일 창)에 없을 수 있어 따로 본다 — 오래전 승인된 선행을 미충족으로 말하면 화면이 거짓말한다.
  const readyItemIds = new Set(orders.filter(o => o.status === 'ready').map(o => o.wbs_item_id))
  const refs = [...new Set(items.filter(i => readyItemIds.has(i.id)).flatMap(i => i.depends ?? []))]
  let predecessors: PredecessorRow[] = []
  if (refs.length) {
    const found = must<Array<Omit<PredecessorRow, 'order_approved'>>>('선행 항목',
      await admin.from('wbs_items').select('id, project_id, external_ref, code, name, stage, actual_pct').in('project_id', projIds).in('external_ref', refs))
    const approved = found.length
      ? must<Array<{ wbs_item_id: string }>>('선행 승인 주문',
        await admin.from('agent_work_orders').select('wbs_item_id').in('wbs_item_id', found.map(p => p.id)).eq('status', 'approved'))
      : []
    const ok = new Set(approved.map(a => a.wbs_item_id))
    predecessors = found.map(p => ({ ...p, order_approved: ok.has(p.id) }))
  }
  return { orders, items, parents, reviews, watchers, projects, members, predecessors, reports, leases }
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
  // 결재 어포던스 재료는 범위와 무관하게 싣는다 — 전체 보기에서도 버튼 노출은 서버 가드와 같은 축이어야 한다.
  // 로스터 조회가 던지면 그대로 올린다(조회 실패를 권한 없음으로 위장하지 않는다).
  const memberIds = new Set(await fetchMyMemberIds(admin, { userId: actor.userId, userEmail: await viewerEmail(admin, actor.userId) }, projectIds))
  const viewer: SeatmapViewer = {
    userId: actor.userId,
    memberIds,
    adminProjectIds: new Set(rows.projects.filter(p => isProjectAdmin(actor, p.id)).map(p => p.id)),
  }
  if (scope === 'all') return assembleSeatmap(rows, nowMs, { viewer })
  return assembleSeatmap(rows, nowMs, { mine: { userId: actor.userId, memberIds }, viewer })
}

export interface ProjectOffice { projectName: string | null; seatmap: Seatmap }

/** 프로젝트 스튜디오 — 이름 + 이 프로젝트 층 하나. 프로젝트가 없으면 projectName null(페이지가 notFound 로 보낸다). */
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
