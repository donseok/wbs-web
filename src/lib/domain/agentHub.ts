// 에이전트 허브 조립 — 순수 함수. 트리 순서·행 상태·카운터·승인 큐·감시자를 한 번에 만든다. DB·세션을 모른다.
// 좌석 층은 여기서 만들지 않는다 — /agents/office 가 좌석표 로더로 그린다(2026-09-14 오피스 분리 스펙 §4-2).
// 스펙: docs/superpowers/specs/2026-09-14-agent-hub-design.md §4-2
import { deriveSeatState, isWatcherAlive, lastSignalMs, type OrderStatus, type SeatState } from './seatState'
import { AGENT_TAG, isSubtreeManagerOf, type OrderRow, type Watcher, type WatcherRow } from './seatmap'
import { deriveWaitReason, type WaitReason } from './waitReason'
import { stageLockedForHuman } from './agentWork'

export interface HubItemRow {
  id: string; project_id: string; parent_id: string | null; code: string; name: string; sort_order: number
  milestone: boolean; dev_workflow: boolean; tags: string[] | null
  assignee_member_id: string | null; agent_prompt: string | null; actual_pct: number | null; stage: string | null
  /** 선행 매칭 키(0077) — 프로젝트 안 external_ref. depends 는 선행 external_ref 배열. */
  external_ref: string | null; depends: string[] | null
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
  /** 선행 항목 중 approved 주문이 있는 항목 id — orders 는 7일 창이라 오래전 승인을 따로 본다(착수 대기 사유 스펙 §3). */
  approvedItemIds: string[]
}
export type HubOrderState = SeatState
export interface HubRow {
  itemId: string; code: string; name: string; depth: number; parentId: string | null
  isLeaf: boolean; milestone: boolean
  assigneeName: string | null; assigneeMine: boolean
  /** 서브트리 관리자(트랙 B, 2026-09-15) — 이 리프의 strict 조상(부모…루트, 자신 제외) 중
   *  담당자가 나면 true. 허브 UI 의 mine 필터·조정 버튼 노출을 서버 가드
   *  (requireSubtreeManagerOrAdmin, agent/subtreeManager.ts)와 같은 축으로 맞춘다. */
  canManage: boolean
  delegated: boolean; devWorkflow: boolean
  /** WBS 단계(as/ip/im/xx, 미지정 null). 허브의 단계 직접 조정(§11)이 보이는 값이자 select 의 현재값. */
  stage: string | null
  /** 사람의 단계 지정 잠금(스펙 2026-09-15 §3.5) = 위임됨 ∨ 주문 claimed·reported. 서버가 계산하고 화면은 이 값만 읽는다(8상태에서 재파생 금지). */
  stageLocked: boolean
  order: { id: string; status: OrderStatus; state: HubOrderState; agent: string | null; lastSignalAt: string | null } | null
  prompt: string | null
  /** 리프 && 마일스톤 아님 && (관리자 || 담당자 본인) — 화면의 체크 활성 판정. 서버 가드(requireDelegationRight)와 같은 규칙. */
  canToggle: boolean
  /** 착수를 기다리는 이유 — 리프·위임·(주문 없음 또는 READY) 일 때만 채우고 그 밖에는 null.
   *  좌석표(Seat.waitReason)와 같은 deriveWaitReason 을 쓴다. 두 화면이 다른 말을 하면 안 된다.
   *  kind==='dependency' 가 종전 unmetDepends 를 대신한다(같은 게이트·같은 선행 판정). */
  waitReason: WaitReason | null
}
export interface HubQueueEntry {
  orderId: string; itemId: string | null; code: string; name: string; agent: string; percent: number; summary: string
  links: { label?: string; url: string }[]; reportedAt: string
  /** 이 보고 항목의 담당자가 보는 사람 자신인가 — 카드의 반려 버튼 노출 판정(승인은 관리자만, 반려는 담당자도, §11). */
  assigneeMine: boolean
  /** 서브트리 관리자(트랙 B) — 큐 항목은 항상 리프의 reported 주문이므로 그 리프의 strict 조상
   *  중 담당자가 나면 true. HubRow.canManage 와 같은 규칙. */
  canManage: boolean
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

/**
 * 서브트리 관리자 판정(트랙 B, 2026-09-15) — itemId 의 strict 조상(부모…루트, 자신 제외) 중
 * 어느 노드의 assignee_member_id 가 mine 과 교집합이면 true. src/lib/agent/assignee.ts 의
 * isSubtreeManager 와 같은 규칙이지만, 허브는 프로젝트 전체 항목(rows.items)을 이미 메모리에
 * 들고 있으므로 새 DB 조회 없이 그 자리에서 조상을 탄다. visited Set 으로 parent_id 순환을 막는다.
 */
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
  // canManage(조상 워크)·큐(항목 표시)가 같이 쓴다 — 루프보다 먼저 만들어 둔다.
  const itemById = new Map(rows.items.map(i => [i.id, i]))
  // 선행은 같은 프로젝트 항목의 external_ref 로 맞춘다 — 허브는 프로젝트 전체 항목을 이미 들고 있다.
  const byRef = new Map(rows.items.filter(i => i.external_ref !== null).map(i => [i.external_ref as string, i]))
  const approved = new Set(rows.approvedItemIds)
  // 착수 대기 사유 재료 — 담당자 로스터 행(user_id 포함)과 이 프로젝트를 보는 살아 있는 감시자.
  // hub.watchers(Watcher[])를 재사용하지 않는다 — 그 형에는 user_id 가 없어 담당자 자격 판정이 전부 거짓이 된다.
  const memberById = new Map(rows.members.map(m => [m.id, m]))
  const hubWatchers = rows.watchers.filter(w => isWatcherAlive(w.last_seen_at, nowMs) && (w.project_id === null || w.project_id === projectId))
  const hubRows: HubRow[] = []
  const counters = { delegated: 0, ready: 0, working: 0, waiting: 0 }
  for (const { item, depth } of flatten(rows.items)) {
    const isLeaf = !hasChildren.has(item.id)
    const delegated = (item.tags ?? []).includes(AGENT_TAG)
    const assigneeMine = item.assignee_member_id !== null && mine.has(item.assignee_member_id)
    const canManage = isSubtreeManagerOf(item.id, itemById, mine)
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
    const waitingStart = order === null || order.state === 'READY'
    const assigneeMember = item.assignee_member_id ? memberById.get(item.assignee_member_id) : undefined
    const waitReason = isLeaf && delegated && waitingStart
      ? deriveWaitReason({
          depends: item.depends,
          predecessorByRef: ref => { const p = byRef.get(ref); return p ? { external_ref: ref, code: p.code, name: p.name, stage: p.stage, order_approved: approved.has(p.id), actual_pct: p.actual_pct } : undefined },
          // 담당자 id 는 있는데 로스터 행이 없으면 계정 미연결과 같은 취급(seatmap.ts 와 같은 규칙).
          assignee: item.assignee_member_id ? { name: assigneeMember?.name ?? '(로스터에 없음)', user_id: assigneeMember?.user_id ?? null } : null,
          watchers: hubWatchers,
        })
      : null
    hubRows.push({
      itemId: item.id, code: item.code, name: item.name, depth, parentId: item.parent_id,
      isLeaf, milestone: item.milestone,
      assigneeName: item.assignee_member_id ? (memberName.get(item.assignee_member_id) ?? null) : null, assigneeMine, canManage,
      delegated, devWorkflow: item.dev_workflow, stage: item.stage,
      stageLocked: stageLockedForHuman({ delegated, orderStatus: picked?.status ?? null }),
      order, prompt: item.agent_prompt,
      canToggle: isLeaf && !item.milestone && (viewer.isAdmin || assigneeMine),
      waitReason,
    })
  }

  const queue: HubQueueEntry[] = rows.orders
    .filter(o => o.status === 'reported')
    .map(o => {
      const it = o.wbs_item_id ? itemById.get(o.wbs_item_id) : undefined
      const rep = latestReport.get(o.id)
      return {
        orderId: o.id, itemId: o.wbs_item_id, code: it?.code ?? '', name: it?.name ?? '',
        agent: rep?.agent ?? o.heartbeat_agent ?? o.claimed_by ?? '', percent: rep?.percent ?? 0, summary: rep?.summary ?? '',
        links: rep?.links ?? [], reportedAt: rep?.created_at ?? o.updated_at,
        assigneeMine: it?.assignee_member_id != null && mine.has(it.assignee_member_id),
        canManage: it ? isSubtreeManagerOf(it.id, itemById, mine) : false,
      }
    })
    .sort((a, b) => Date.parse(a.reportedAt) - Date.parse(b.reportedAt))

  return {
    projectId, projectName: rows.project?.name ?? '',
    registered: rows.agentProject !== null, enabled: rows.agentProject?.enabled === true,
    // 좌석 층은 /agents/office 가 그린다(2026-09-14 오피스 분리 스펙 §4-2). 감시자만 이 프로젝트 것으로.
    counters, watchers: watchersFor(rows.watchers, projectId, nowMs),
    rows: hubRows, queue, fetchedAt: new Date(nowMs).toISOString(),
    viewer: { isAdmin: viewer.isAdmin, memberIds },
  }
}
