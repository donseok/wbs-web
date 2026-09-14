// 좌석표 조립 — IO 없음. 층=프로젝트, 구역=주문 항목의 부모 항목, 책상=주문(스펙 §5-1).
import {
  animFor, deriveSeatState, fnv1a32, inferPhase, isRejected, isWatcherAlive, lastSignalMs, pickCharacter,
  type AnimName, type CharacterName, type OrderStatus, type Phase, type SeatState,
} from './seatState'

export interface OrderRow {
  id: string; project_id: string; wbs_item_id: string | null; status: OrderStatus
  claimed_by: string | null; claimed_by_user_id: string | null; claimed_at: string | null
  created_at: string; updated_at: string
  last_heartbeat_at: string | null; heartbeat_phase: string | null; heartbeat_agent: string | null; heartbeat_note: string | null
}
export interface ItemRow { id: string; project_id: string; code: string; name: string; parent_id: string | null; actual_pct: number | null; assignee_member_id: string | null; tags: string[] | null }
/** 에이전트 위임 태그 — src/app/actions/wbsSpec.ts AGENT_TAG·dflow-poll 자동 착수 계약과 같은 값. 좌석표는 이 태그가 붙은 항목의 주문만 대상으로 한다. */
export const AGENT_TAG = 'agent'
export interface ReviewRow { work_order_id: string; review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string }
export interface WatcherRow {
  id: string; user_id: string; project_id: string | null; agent: string; host: string | null
  slots: number | null; busy: number | null; until_label: string | null; last_seen_at: string
}
export interface ProjectRow { id: string; name: string }
export interface SeatmapRows {
  orders: OrderRow[]; items: ItemRow[]; parents: ItemRow[]; reviews: ReviewRow[]; watchers: WatcherRow[]; projects: ProjectRow[]
}

export interface Seat {
  orderId: string; id8: string; projectId: string; itemId: string | null; code: string; name: string
  state: SeatState; phase: Phase; anim: AnimName; character: CharacterName
  agent: string | null; progress: number
  lastSignalAt: string | null; heartbeatAt: string | null; heartbeatPhase: string | null
  note: string | null; rejected: boolean; reviewNote: string | null
}
export interface Zone { key: string; code: string; name: string; seats: Seat[]; summary: { work: number; wait: number; ready: number } }
export interface Watcher { agent: string; host: string | null; slots: number | null; busy: number | null; untilLabel: string | null; lastSeenAt: string; projectId: string | null }
export interface Floor { id: string; name: string; zones: Zone[]; seatCount: number; doneCount: number; watchers: Watcher[] }
export interface Attention { orderId: string; id8: string; floorName: string; code: string; name: string; state: SeatState; why: string }
export interface Seatmap {
  floors: Floor[]
  counters: { active: number; standby: number; idle: number; offline: number }
  attention: Attention[]
  fetchedAt: string
  /** mine = 담당자가 나이거나 내 계정의 에이전트가 잡은 주문만. all = 권한 범위 전체. */
  scope: SeatmapScope
}

export type SeatmapScope = 'mine' | 'all'
export const SEATMAP_SCOPES: readonly SeatmapScope[] = ['mine', 'all']
/** 내 작업 판정 재료 — memberIds 는 접근 가능 프로젝트 로스터에서 나(user_id 링크 또는 이메일)와 맞는 행. */
export interface MineFilter { userId: string; memberIds: ReadonlySet<string> }

const WORK_STATES: readonly SeatState[] = ['ACTIVE', 'STALE', 'REJECTED', 'BLOCKED']
const ATTENTION_ORDER: readonly SeatState[] = ['BLOCKED', 'STALE', 'OFFLINE', 'REJECTED']

export function ageLabel(fromIso: string | null, nowMs: number): string {
  if (!fromIso) return '—'
  const sec = Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 1000))
  if (sec < 60) return `${sec}초 전`
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`
  return `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분 전`
}

/** 주문별 마지막 completion 보고(가장 늦은 created_at). */
function latestReviewByOrder(reviews: ReviewRow[]): Map<string, ReviewRow> {
  const out = new Map<string, ReviewRow>()
  for (const r of reviews) {
    const cur = out.get(r.work_order_id)
    if (!cur || Date.parse(r.created_at) > Date.parse(cur.created_at)) out.set(r.work_order_id, r)
  }
  return out
}

function toSeat(o: OrderRow, item: ItemRow | undefined, review: ReviewRow | undefined, nowMs: number): Seat {
  const input = {
    status: o.status, lastHeartbeatAt: o.last_heartbeat_at, heartbeatPhase: o.heartbeat_phase,
    updatedAt: o.updated_at, lastReview: review?.review_action ?? null, actualPct: item?.actual_pct ?? null,
  }
  const state = deriveSeatState(input, nowMs)
  const phase = inferPhase(input)
  // WAIT 의 idle 3종은 10초 슬롯으로 순환한다 — 서버·클라이언트가 같은 슬롯을 계산하도록 nowMs 기준.
  const idleSlot = Math.floor(nowMs / 10_000)
  const agent = o.heartbeat_agent ?? o.claimed_by
  const sigMs = lastSignalMs(input)
  const signal = sigMs > 0 ? new Date(sigMs).toISOString() : null
  return {
    orderId: o.id, id8: o.id.slice(0, 8), projectId: o.project_id, itemId: o.wbs_item_id,
    code: item?.code ?? o.id.slice(0, 8), name: item?.name ?? '(항목 삭제됨)',
    state, phase, anim: animFor(state, phase, idleSlot + fnv1a32(o.id) % 3), character: pickCharacter(agent ?? o.id),
    agent, progress: Math.max(0, Math.min(100, Math.round(item?.actual_pct ?? 0))),
    lastSignalAt: o.status === 'claimed' ? signal : null,
    heartbeatAt: o.last_heartbeat_at, heartbeatPhase: o.heartbeat_phase,
    note: o.heartbeat_phase === 'blocked' ? o.heartbeat_note : null,
    rejected: isRejected(input), reviewNote: review?.review_action === 'reject' ? review.review_note : null,
  }
}

function attentionWhy(s: Seat, nowMs: number): string {
  if (s.state === 'BLOCKED') return s.note ?? '결정 필요'
  if (s.state === 'STALE') return `무응답 ${ageLabel(s.lastSignalAt, nowMs)}`
  if (s.state === 'OFFLINE') return `끊김 ${ageLabel(s.lastSignalAt, nowMs)}`
  return s.reviewNote ? `반려 · ${s.reviewNote}` : '반려 · 재작업'
}

export function assembleSeatmap(rows: SeatmapRows, nowMs: number, opts: { mine?: MineFilter } = {}): Seatmap {
  const mine = opts.mine
  const itemById0 = new Map(rows.items.map(i => [i.id, i]))
  // 대상은 에이전트 위임(agent 태그) 항목의 주문뿐 — dev_workflow 리프마다 주문이 생기므로 사람이 하는 작업의 주문도 테이블엔 있다.
  // 항목이 지워진 주문은 태그를 알 수 없어 제외한다. 조립 앞에서 걸러 층·카운터·확인 필요가 모두 같은 범위를 본다.
  const agentOrders = rows.orders.filter(o => {
    const it = o.wbs_item_id != null ? itemById0.get(o.wbs_item_id) : undefined
    return !!it && (it.tags ?? []).includes(AGENT_TAG)
  })
  // 내 작업: 항목 담당자가 내 로스터 행이거나, 내 계정이 잡은 주문.
  const orders = mine
    ? agentOrders.filter(o => o.claimed_by_user_id === mine.userId || mine.memberIds.has(itemById0.get(o.wbs_item_id!)?.assignee_member_id ?? ''))
    : agentOrders
  rows = { ...rows, orders }
  const itemById = new Map(rows.items.map(i => [i.id, i]))
  const parentById = new Map(rows.parents.map(p => [p.id, p]))
  const reviewByOrder = latestReviewByOrder(rows.reviews)
  const projectName = new Map(rows.projects.map(p => [p.id, p.name]))

  // 층 → 구역 → 책상. 구역 키는 부모 항목 id, 부모가 없으면 고정 키 둘.
  const floorMap = new Map<string, Map<string, Zone>>()
  const done = new Map<string, number>()
  for (const o of rows.orders) {
    const item = o.wbs_item_id ? itemById.get(o.wbs_item_id) : undefined
    const seat = toSeat(o, item, reviewByOrder.get(o.id), nowMs)
    if (seat.state === 'DONE') { done.set(o.project_id, (done.get(o.project_id) ?? 0) + 1); continue }
    const zones = floorMap.get(o.project_id) ?? new Map<string, Zone>()
    floorMap.set(o.project_id, zones)
    let key: string, code: string, name: string
    if (!item) continue // 위 필터로 도달 불가 — 방어
    if (item.parent_id && parentById.get(item.parent_id)) {
      const p = parentById.get(item.parent_id)!; key = p.id; code = p.code; name = p.name
    } else { key = '__no_parent'; code = '—'; name = '구역 없음' }
    const zone = zones.get(key) ?? { key, code, name, seats: [], summary: { work: 0, wait: 0, ready: 0 } }
    zones.set(key, zone)
    zone.seats.push(seat)
    if (WORK_STATES.includes(seat.state)) zone.summary.work++
    else if (seat.state === 'WAIT') zone.summary.wait++
    else zone.summary.ready++ // READY · OFFLINE(빈 의자)
  }

  const aliveWatchers: Watcher[] = rows.watchers
    .filter(w => isWatcherAlive(w.last_seen_at, nowMs))
    .map(w => ({ agent: w.agent, host: w.host, slots: w.slots, busy: w.busy, untilLabel: w.until_label, lastSeenAt: w.last_seen_at, projectId: w.project_id }))
    .sort((a, b) => a.agent.localeCompare(b.agent))

  const floorIds = new Set<string>([...floorMap.keys(), ...done.keys()])
  const floors: Floor[] = [...floorIds].map(id => {
    const zones = [...(floorMap.get(id)?.values() ?? [])]
      .map(z => ({ ...z, seats: [...z.seats].sort((a, b) => a.code.localeCompare(b.code)) }))
      .sort((a, b) => a.code.localeCompare(b.code))
    return {
      id, name: projectName.get(id) ?? id, zones,
      seatCount: zones.reduce((n, z) => n + z.seats.length, 0),
      doneCount: done.get(id) ?? 0,
      watchers: aliveWatchers.filter(w => w.projectId === null || w.projectId === id),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const counters = { active: 0, standby: aliveWatchers.length, idle: 0, offline: 0 }
  const attention: Attention[] = []
  for (const f of floors) for (const z of f.zones) for (const s of z.seats) {
    if (WORK_STATES.includes(s.state)) counters.active++
    else if (s.state === 'WAIT') counters.idle++
    else counters.offline++
    if (ATTENTION_ORDER.includes(s.state)) {
      attention.push({ orderId: s.orderId, id8: s.id8, floorName: f.name, code: s.code, name: s.name, state: s.state, why: attentionWhy(s, nowMs) })
    }
  }
  attention.sort((a, b) => ATTENTION_ORDER.indexOf(a.state) - ATTENTION_ORDER.indexOf(b.state))

  return { floors, counters, attention, fetchedAt: new Date(nowMs).toISOString(), scope: mine ? 'mine' : 'all' }
}
