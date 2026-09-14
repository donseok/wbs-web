// 에이전트 허브 조립 — 순수 함수. 트리 순서·행 상태·카운터·승인 큐·좌석 층을 한 번에 만든다. DB·세션을 모른다.
// 스펙: docs/superpowers/specs/2026-09-14-agent-hub-design.md §4-2
import { deriveSeatState, isWatcherAlive, lastSignalMs, type OrderStatus, type SeatState } from './seatState'
import {
  AGENT_TAG, assembleSeatmap, type Floor, type ItemRow, type OrderRow, type ReviewRow, type Watcher, type WatcherRow,
} from './seatmap'

export interface HubItemRow {
  id: string; project_id: string; parent_id: string | null; code: string; name: string; sort_order: number
  milestone: boolean; dev_workflow: boolean; tags: string[] | null
  assignee_member_id: string | null; agent_prompt: string | null; actual_pct: number | null; stage: string | null
}
export interface HubMemberRow { id: string; name: string; email: string | null; user_id: string | null }
export interface HubReportRow {
  work_order_id: string; percent: number; summary: string; links: { label?: string; url: string }[]; agent: string
  review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string
}
export interface AgentHubRows {
  project: { id: string; name: string } | null
  agentProject: { enabled: boolean } | null
  items: HubItemRow[]; orders: OrderRow[]; reports: HubReportRow[]; watchers: WatcherRow[]; members: HubMemberRow[]
}
export type HubOrderState = SeatState
export interface HubRow {
  itemId: string; code: string; name: string; depth: number; parentId: string | null
  isLeaf: boolean; milestone: boolean
  assigneeName: string | null; assigneeMine: boolean
  delegated: boolean; devWorkflow: boolean
  order: { id: string; status: OrderStatus; state: HubOrderState; agent: string | null; lastSignalAt: string | null } | null
  prompt: string | null
  /** 리프 && 마일스톤 아님 && (관리자 || 담당자 본인) — 화면의 체크 활성 판정. 서버 가드(requireDelegationRight)와 같은 규칙. */
  canToggle: boolean
}
export interface HubQueueEntry {
  orderId: string; itemId: string | null; code: string; name: string; agent: string; percent: number; summary: string
  links: { label?: string; url: string }[]; reportedAt: string
}
export interface AgentHub {
  projectId: string; projectName: string
  registered: boolean; enabled: boolean
  counters: { delegated: number; ready: number; working: number; waiting: number }
  watchers: Watcher[]
  /** 트리 전위 순서(부모 → 자식). 형제는 sort_order 오름차순, 같으면 code. 고아는 루트 뒤. */
  rows: HubRow[]
  /** reported 주문, 오래된 보고 먼저. */
  queue: HubQueueEntry[]
  /** 이 프로젝트 층 — 좌석표 규칙(agent 태그 주문만). 없으면 null. */
  floor: Floor | null
  fetchedAt: string
  viewer: { isAdmin: boolean; memberIds: string[] }
}
export interface HubViewer { userId: string; userEmail: string | null; isAdmin: boolean }

const LIVE: readonly OrderStatus[] = ['ready', 'claimed', 'reported']
const WORKING: readonly SeatState[] = ['ACTIVE', 'STALE', 'OFFLINE', 'BLOCKED', 'REJECTED']

/** 로스터 이중 매칭(src/lib/agent/assignee.ts 와 같은 규칙): user_id 링크 또는 이메일 소문자 일치. */
export function myMemberIdsOf(members: HubMemberRow[], viewer: { userId: string; userEmail: string | null }): string[] {
  const email = viewer.userEmail?.toLowerCase() ?? null
  const out: string[] = []
  for (const m of members) {
    if (m.user_id === viewer.userId || (email !== null && m.email !== null && m.email.toLowerCase() === email)) out.push(m.id)
  }
  return out
}

const cmp = (a: HubItemRow, b: HubItemRow) => a.sort_order - b.sort_order || a.code.localeCompare(b.code)

/** 전위 순서로 편다 — 루트(parent null) → 자식, 고아(부모가 목록에 없음)는 루트 뒤. */
function flatten(items: HubItemRow[]): { item: HubItemRow; depth: number }[] {
  const ids = new Set(items.map(i => i.id))
  const children = new Map<string, HubItemRow[]>()
  const roots: HubItemRow[] = [], orphans: HubItemRow[] = []
  for (const it of items) {
    if (it.parent_id === null) roots.push(it)
    else if (!ids.has(it.parent_id)) orphans.push(it)
    else { const l = children.get(it.parent_id); if (l) l.push(it); else children.set(it.parent_id, [it]) }
  }
  const out: { item: HubItemRow; depth: number }[] = []
  const walk = (it: HubItemRow, depth: number) => {
    out.push({ item: it, depth })
    for (const c of (children.get(it.id) ?? []).sort(cmp)) walk(c, depth + 1)
  }
  for (const r of roots.sort(cmp)) walk(r, 0)
  for (const o of orphans.sort(cmp)) walk(o, 0)
  return out
}

/** 살아 있는 주문(ready/claimed/reported) 중 updated_at 최신 1건, 없으면 최근 approved 1건. */
function pickOrder(list: OrderRow[]): OrderRow | null {
  const newest = (xs: OrderRow[]) => xs.reduce<OrderRow | null>((best, o) => (!best || Date.parse(o.updated_at) > Date.parse(best.updated_at) ? o : best), null)
  return newest(list.filter(o => LIVE.includes(o.status))) ?? newest(list.filter(o => o.status === 'approved'))
}

/** 층이 없을 때(위임 주문 0)도 감시 중인 에이전트는 보여야 한다 — seatmap.ts 의 층 감시자 규칙과 같다(프로젝트 일치 또는 전역, TTL 안, agent 순). */
function watchersFor(watchers: WatcherRow[], projectId: string, nowMs: number): Watcher[] {
  return watchers
    .filter(w => isWatcherAlive(w.last_seen_at, nowMs) && (w.project_id === null || w.project_id === projectId))
    .map(w => ({ agent: w.agent, host: w.host, slots: w.slots, busy: w.busy, untilLabel: w.until_label, lastSeenAt: w.last_seen_at, projectId: w.project_id }))
    .sort((a, b) => a.agent.localeCompare(b.agent))
}

export function assembleAgentHub(rows: AgentHubRows, nowMs: number, viewer: HubViewer): AgentHub {
  const memberIds = myMemberIdsOf(rows.members, viewer)
  const mine = new Set(memberIds)
  const memberName = new Map(rows.members.map(m => [m.id, m.name]))
  const projectId = rows.project?.id ?? rows.items[0]?.project_id ?? ''

  // 주문 → 항목, 보고 → 주문(최신 completion 1건)
  const ordersByItem = new Map<string, OrderRow[]>()
  for (const o of rows.orders) {
    if (!o.wbs_item_id) continue
    const l = ordersByItem.get(o.wbs_item_id); if (l) l.push(o); else ordersByItem.set(o.wbs_item_id, [o])
  }
  const latestReport = new Map<string, HubReportRow>()
  for (const r of rows.reports) {
    const cur = latestReport.get(r.work_order_id)
    if (!cur || Date.parse(r.created_at) > Date.parse(cur.created_at)) latestReport.set(r.work_order_id, r)
  }

  const hasChildren = new Set(rows.items.map(i => i.parent_id).filter((x): x is string => x !== null))
  const hubRows: HubRow[] = []
  const counters = { delegated: 0, ready: 0, working: 0, waiting: 0 }
  for (const { item, depth } of flatten(rows.items)) {
    const isLeaf = !hasChildren.has(item.id)
    const delegated = (item.tags ?? []).includes(AGENT_TAG)
    const assigneeMine = item.assignee_member_id !== null && mine.has(item.assignee_member_id)
    const picked = pickOrder(ordersByItem.get(item.id) ?? [])
    let order: HubRow['order'] = null
    if (picked) {
      const input = {
        status: picked.status, lastHeartbeatAt: picked.last_heartbeat_at, heartbeatPhase: picked.heartbeat_phase,
        updatedAt: picked.updated_at, lastReview: latestReport.get(picked.id)?.review_action ?? null, actualPct: item.actual_pct,
      }
      const state = deriveSeatState(input, nowMs)
      const sig = picked.status === 'ready' ? 0 : lastSignalMs(input)
      order = {
        id: picked.id, status: picked.status, state,
        agent: picked.heartbeat_agent ?? picked.claimed_by,
        lastSignalAt: sig > 0 ? new Date(sig).toISOString() : null,
      }
      if (state === 'READY') counters.ready++
      else if (state === 'WAIT') counters.waiting++
      else if (WORKING.includes(state)) counters.working++
    }
    if (isLeaf && delegated) counters.delegated++
    hubRows.push({
      itemId: item.id, code: item.code, name: item.name, depth, parentId: item.parent_id,
      isLeaf, milestone: item.milestone,
      assigneeName: item.assignee_member_id ? (memberName.get(item.assignee_member_id) ?? null) : null, assigneeMine,
      delegated, devWorkflow: item.dev_workflow, order, prompt: item.agent_prompt,
      canToggle: isLeaf && !item.milestone && (viewer.isAdmin || assigneeMine),
    })
  }

  const itemById = new Map(rows.items.map(i => [i.id, i]))
  const queue: HubQueueEntry[] = rows.orders
    .filter(o => o.status === 'reported')
    .map(o => {
      const it = o.wbs_item_id ? itemById.get(o.wbs_item_id) : undefined
      const rep = latestReport.get(o.id)
      return {
        orderId: o.id, itemId: o.wbs_item_id, code: it?.code ?? '', name: it?.name ?? '',
        agent: rep?.agent ?? o.heartbeat_agent ?? o.claimed_by ?? '', percent: rep?.percent ?? 0, summary: rep?.summary ?? '',
        links: rep?.links ?? [], reportedAt: rep?.created_at ?? o.updated_at,
      }
    })
    .sort((a, b) => Date.parse(a.reportedAt) - Date.parse(b.reportedAt))

  // 좌석 층 — 좌석표 규칙(agent 태그 주문만) 그대로. 같은 행을 재사용해 추가 조회가 없다.
  const seatItems: ItemRow[] = rows.items.map(i => ({
    id: i.id, project_id: i.project_id, code: i.code, name: i.name, parent_id: i.parent_id, actual_pct: i.actual_pct,
    assignee_member_id: i.assignee_member_id, tags: i.tags,
  }))
  const reviews: ReviewRow[] = rows.reports.map(r => ({ work_order_id: r.work_order_id, review_action: r.review_action, review_note: r.review_note, created_at: r.created_at }))
  const seatmap = assembleSeatmap({
    orders: rows.orders, items: seatItems, parents: seatItems, reviews, watchers: rows.watchers,
    projects: rows.project ? [rows.project] : [],
  }, nowMs)
  const floor = seatmap.floors.find(f => f.id === projectId) ?? null

  return {
    projectId, projectName: rows.project?.name ?? '',
    registered: rows.agentProject !== null, enabled: rows.agentProject?.enabled === true,
    counters, watchers: floor?.watchers ?? watchersFor(rows.watchers, projectId, nowMs),
    rows: hubRows, queue, floor, fetchedAt: new Date(nowMs).toISOString(),
    viewer: { isAdmin: viewer.isAdmin, memberIds },
  }
}
