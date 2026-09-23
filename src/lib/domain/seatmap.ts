// 좌석표 조립 — IO 없음. 층=프로젝트, 구역=주문 항목의 부모 항목, 책상=주문(스펙 §5-1).
import {
  animFor, deriveSeatState, fnv1a32, inferPhase, isRejected, isWatcherAlive, lastSignalMs, pickCharacter,
  type AnimName, type CharacterName, type OrderStatus, type Phase, type SeatState,
} from './seatState'
import { deriveWaitReason, type PredecessorLike, type WaitReason } from './waitReason'

export interface OrderRow {
  id: string; project_id: string; wbs_item_id: string | null; status: OrderStatus
  claimed_by: string | null; claimed_by_user_id: string | null; claimed_at: string | null
  created_at: string; updated_at: string
  last_heartbeat_at: string | null; heartbeat_phase: string | null; heartbeat_agent: string | null; heartbeat_note: string | null
  /** 사람이 「이어서 시작」을 누른 시각(0099). 워커가 다시 heartbeat 를 보내면 서버가 비운다. */
  resume_requested_at?: string | null
  /** 이어받을 PC 슬러그 — claimed_by 에서 서버가 파생한다. 화면은 누가 가져갈 자리인지 보여줄 때만 쓴다. */
  resume_requested_host?: string | null
  /** 마지막 heartbeat 가 말한 실행 모델(0100). last_heartbeat_at 이 null 이면(재위임으로 비워진 행) 무효. */
  heartbeat_model?: string | null
}
export interface ItemRow {
  id: string; project_id: string; code: string; name: string; parent_id: string | null; actual_pct: number | null; assignee_member_id: string | null; tags: string[] | null
  /** 선행 external_ref 배열(0077) — 주문 항목 행에만 싣는다. 부모 행은 구역 라벨만 쓰므로 없어도 된다. */
  depends?: string[] | null
  /** 항목에 지정된 모델(0077, import 스펙의 model) — 에이전트가 실제로 도는 모델은 아직 보고되지 않는다. */
  model?: string | null
}
/** 에이전트 위임 태그 — src/app/actions/wbsSpec.ts AGENT_TAG·dflow-poll 자동 착수 계약과 같은 값. 좌석표는 이 태그가 붙은 항목의 주문만 대상으로 한다. */
export const AGENT_TAG = 'agent'
export interface ReviewRow {
  work_order_id: string; review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string
  /** 워커 결정 수(0102 생성 컬럼). null = 제출 안 됨. 옛 픽스처는 비워 둘 수 있다. */
  decision_count?: number | null
}
/** 에이전트 보기의 보고 말풍선 재료 — 점유·보고 중 주문의 최근 보고 행(progress · completion). */
export interface ReportRow { work_order_id: string; kind: 'progress' | 'completion'; summary: string; created_at: string }
export interface WatcherRow {
  id: string; user_id: string; project_id: string | null; agent: string; host: string | null
  slots: number | null; busy: number | null; until_label: string | null; last_seen_at: string
}
export interface ProjectRow { id: string; name: string }
/** 팀장 lease 행(agent_lead_leases, 0101) — 신원+프로젝트당 하나. */
export interface LeaseRow {
  user_id: string; project_id: string; host: string | null; agent: string | null
  renewed_at: string | null; expires_at: string
}
/** 층 프로젝트의 로스터 행 — 담당자 이름과 PAT 계정(user_id) 매칭 재료. */
export interface MemberRow { id: string; project_id: string; user_id: string | null; name: string }
/** ready 주문 항목의 선행 항목(프로젝트 안 external_ref 매칭) + 승인 주문 유무. */
export interface PredecessorRow extends PredecessorLike { id: string; project_id: string }
export interface SeatmapRows {
  orders: OrderRow[]; items: ItemRow[]; parents: ItemRow[]; reviews: ReviewRow[]; watchers: WatcherRow[]; projects: ProjectRow[]
  members: MemberRow[]; predecessors: PredecessorRow[]
  /** 최근 보고(없으면 말풍선 없음). 옛 호출부·시험이 비워 둘 수 있게 선택 필드다. */
  reports?: ReportRow[]
  /** 팀장 lease(0101). 옛 호출부·시험이 비워 둘 수 있게 선택 필드다. */
  leases?: LeaseRow[]
}

export interface Seat {
  orderId: string; id8: string; projectId: string; itemId: string | null; code: string; name: string
  state: SeatState; phase: Phase; anim: AnimName; character: CharacterName
  agent: string | null; progress: number
  lastSignalAt: string | null; heartbeatAt: string | null; heartbeatPhase: string | null
  note: string | null; rejected: boolean; reviewNote: string | null
  /** 재개 요청이 걸린 시각. null 이면 아직 아무도 누르지 않았다(0099). */
  resumeRequestedAt: string | null
  /** 그 요청을 이어받아야 하는 PC. 그 워크트리가 있는 PC 만 실제로 복구할 수 있다. */
  resumeRequestedHost: string | null
  /** READY(빈자리)만 값 — 왜 아직 안 집어갔는지(스펙 2026-09-14 착수 대기 사유 §1). 나머지 상태는 null. */
  waitReason: WaitReason | null
  /** 관리자이거나 이 항목의 서브트리 관리자 — 승인·중단 어포던스. 서버 가드
   *  requireSubtreeManagerOrAdmin(agent/subtreeManager.ts)과 같은 축이다. 재료가 없으면 false(fail-closed). */
  canManage: boolean
  /** 이 항목의 담당자가 나 — 반려·승인 취소·재작업은 담당자 본인도 할 수 있다(허브 §11 과 같은 규칙). */
  assigneeMine: boolean
  /** 명찰 모델 — 실행 모델(heartbeat)이 있으면 그것, 없으면 항목에 지정된 모델. 둘 다 없으면 null. */
  model?: string | null
  /** model 의 출처 — run = 지금 도는 Phase 서브에이전트, plan = WBS 항목 지정값. */
  modelSource?: 'run' | 'plan' | null
  /** 이 주문의 마지막 보고(점유·보고 중일 때만). 에이전트 보기가 팀원 말풍선으로 띄운다. */
  lastReport?: { kind: 'progress' | 'completion'; summary: string; at: string } | null
  /** 이 주문을 잡은 계정(claimed_by_user_id)이 보는 사람 — 내 에이전트 테두리·명찰(2026-09-19).
   *  보는 사람 재료가 없거나 레거시 주문(claimed_by_user_id null)이면 false(fail-closed). */
  agentMine: boolean
  /** 다른 계정의 에이전트면 그 계정의 로스터 이름. 내 것·레거시·로스터에 없는 계정은 null(화면은 "다른 계정"). */
  agentOwnerName: string | null
  /** 승인 대기(reported) 주문의 최신 completion 에 딸린 결정 수(과제 C). 그 밖의 상태·구 CLI 보고는 null.
   *  말풍선과 달리 승인될 때까지 칩으로 계속 보인다. 옛 시험 픽스처가 비워 둘 수 있게 선택 필드다. */
  decisionCount?: number | null
}
export interface Zone { key: string; code: string; name: string; seats: Seat[]; summary: { work: number; wait: number; ready: number; done: number } }
export interface Watcher {
  agent: string; host: string | null; slots: number | null; busy: number | null; untilLabel: string | null; lastSeenAt: string; projectId: string | null
  /** 감시자 계정(user_id)이 보는 사람 — 좌석의 agentMine 과 같은 판정. 허브처럼 재료를 싣지 않는 곳은 비워 둔다(없음 = false). */
  mine?: boolean
  /** 다른 계정의 감시자면 그 계정의 로스터 이름(없으면 null). */
  ownerName?: string | null
}
/** 팀장 lease(0101) — 신원+프로젝트당 팀장 하나. 오피스 층 머리에 보이고 「팀장 해제」의 대상이다. */
export interface LeadLease {
  userId: string; host: string | null; agent: string | null; renewedAt: string | null; expiresAt: string
  mine: boolean; ownerName: string | null
  /** 본인 lease 이거나 이 층 관리자. 서버 액션이 같은 판정(canReleaseLeadLease)을 다시 한다. */
  canRelease: boolean
}
export interface Floor { id: string; name: string; zones: Zone[]; seatCount: number; doneCount: number; watchers: Watcher[]; leads: LeadLease[] }
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
/** 결재 어포던스 재료(2026-09-17 스튜디오 v7). 넘기지 않으면 모든 좌석이 canManage=false 로 잠긴다(fail-closed). */
export interface SeatmapViewer {
  /** 보는 사람 계정 — 내 에이전트(주문 claimed_by_user_id · 감시자 user_id) 판정. 없으면 전부 남의 것(fail-closed). */
  userId?: string
  /** 내 로스터 행 id — 담당자 본인·서브트리 관리자 판정. */
  memberIds: ReadonlySet<string>
  /** 내가 관리자인 프로젝트 id. 층마다 다를 수 있어 집합으로 받는다(전체 스튜디오는 여러 층이다). */
  adminProjectIds: ReadonlySet<string>
}

/** 조상 사슬 탐색에 필요한 최소 모양 — 항목 행이든 얕은 조상 행이든 이 셋만 있으면 된다. */
export interface AncestorLike { id: string; parent_id: string | null; assignee_member_id: string | null }

/**
 * 서브트리 관리자 — 대상 항목의 strict 조상(부모·조부모…루트, 자신 제외) 중 담당자가 나인 노드가 있으면 true.
 * 서버 가드(agent/assignee.ts 의 isSubtreeManager)와 같은 규칙이며 좌석표·허브가 같이 쓴다.
 * 사슬이 끊기면(조상 행이 지도에 없으면) 거기서 멈춘다 — 모르면 권한을 주지 않는다(fail-closed).
 */
export function isSubtreeManagerOf(
  itemId: string, itemById: ReadonlyMap<string, AncestorLike>, mine: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>()
  let cur = itemById.get(itemId)?.parent_id ?? null
  while (cur !== null && !visited.has(cur)) {
    visited.add(cur)
    const row = itemById.get(cur)
    if (!row) break
    if (row.assignee_member_id && mine.has(row.assignee_member_id)) return true
    cur = row.parent_id
  }
  return false
}

const WORK_STATES: readonly SeatState[] = ['ACTIVE', 'STALE', 'REJECTED', 'BLOCKED']
const ATTENTION_ORDER: readonly SeatState[] = ['BLOCKED', 'STALE', 'OFFLINE', 'REJECTED']

export function ageLabel(fromIso: string | null, nowMs: number): string {
  if (!fromIso) return '—'
  const sec = Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 1000))
  if (sec < 60) return `${sec}초 전`
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`
  return `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분 전`
}

/** 주문별 가장 늦은 보고 행. */
function latestReportByOrder(reports: ReportRow[]): Map<string, ReportRow> {
  const out = new Map<string, ReportRow>()
  for (const r of reports) {
    const cur = out.get(r.work_order_id)
    if (!cur || Date.parse(r.created_at) > Date.parse(cur.created_at)) out.set(r.work_order_id, r)
  }
  return out
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

/** 좌석·감시자의 계정 구분 — 레거시(계정 없음)와 보는 사람 모름은 남의 것, 이름은 남의 것에만 붙인다. */
function ownerOf(accountId: string | null, viewerId: string | undefined, nameOf: (uid: string) => string | null): { mine: boolean; name: string | null } {
  if (!accountId) return { mine: false, name: null }
  const mine = viewerId !== undefined && accountId === viewerId
  return { mine, name: mine ? null : nameOf(accountId) }
}

function toSeat(o: OrderRow, item: ItemRow | undefined, review: ReviewRow | undefined, nowMs: number, rights: { canManage: boolean; assigneeMine: boolean }, report: ReportRow | undefined, owner: { mine: boolean; name: string | null }): Seat {
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
    // 표식은 점유 중인 주문에서만 뜻이 있다 — 중단·승인으로 떠난 주문의 옛 요청을 화면에 남기지 않는다.
    resumeRequestedAt: o.status === 'claimed' ? (o.resume_requested_at ?? null) : null,
    resumeRequestedHost: o.status === 'claimed' ? (o.resume_requested_host ?? null) : null,
    rejected: isRejected(input), reviewNote: review?.review_action === 'reject' ? review.review_note : null,
    waitReason: null,
    canManage: rights.canManage, assigneeMine: rights.assigneeMine,
    ...pickModel(o, item),
    // 점유·보고 중인 주문만 — 승인·중단으로 떠난 주문의 옛 보고를 말풍선으로 되살리지 않는다.
    lastReport: report && (o.status === 'claimed' || o.status === 'reported') && report.summary.trim()
      ? { kind: report.kind, summary: report.summary.trim(), at: report.created_at }
      : null,
    agentMine: owner.mine, agentOwnerName: owner.name,
    decisionCount: o.status === 'reported' ? (review?.decision_count ?? null) : null,
  }
}

/** 명찰 모델 — 점유 중이고 heartbeat 가 살아 있는 행의 실행 모델이 우선, 없으면 항목 지정 모델. */
function pickModel(o: OrderRow, item: ItemRow | undefined): { model: string | null; modelSource: 'run' | 'plan' | null } {
  const run = o.status === 'claimed' && o.last_heartbeat_at ? o.heartbeat_model?.trim() : ''
  if (run) return { model: run, modelSource: 'run' }
  const plan = item?.model?.trim()
  return plan ? { model: plan, modelSource: 'plan' } : { model: null, modelSource: null }
}

function attentionWhy(s: Seat, nowMs: number): string {
  if (s.state === 'BLOCKED') return s.note ?? '결정 필요'
  // 재개 요청이 걸렸으면 사람이 할 일은 끝났다는 것까지 밴드에서 읽혀야 한다(다시 누르지 않도록).
  const resume = s.resumeRequestedAt ? ' · 재개 요청됨' : ''
  if (s.state === 'STALE') return `무응답 ${ageLabel(s.lastSignalAt, nowMs)}${resume}`
  if (s.state === 'OFFLINE') return `끊김 ${ageLabel(s.lastSignalAt, nowMs)}${resume}`
  return s.reviewNote ? `반려 · ${s.reviewNote}` : '반려 · 재작업'
}

export function assembleSeatmap(rows: SeatmapRows, nowMs: number, opts: { mine?: MineFilter; viewer?: SeatmapViewer } = {}): Seatmap {
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
  const reportByOrder = latestReportByOrder(rows.reports ?? [])
  const projectName = new Map(rows.projects.map(p => [p.id, p.name]))

  // 결재 어포던스 재료 — 조상 사슬은 items + parents 합집합이다(데이터층이 parents 를 조상 전체로 싣는다).
  // 재료가 없으면 빈 집합 → canManage·assigneeMine 이 전부 false 로 잠긴다(fail-closed).
  const ancestorById = new Map<string, AncestorLike>()
  for (const it of [...rows.items, ...rows.parents]) ancestorById.set(it.id, it)
  const myMemberIds: ReadonlySet<string> = opts.viewer?.memberIds ?? mine?.memberIds ?? new Set<string>()
  const adminProjectIds: ReadonlySet<string> = opts.viewer?.adminProjectIds ?? new Set<string>()
  // 내 에이전트 판정은 보는 사람 계정만 본다 — 전체 범위(기본)에도 mine 필터가 없으니 viewer 가 우선이다.
  const viewerId = opts.viewer?.userId ?? mine?.userId
  // 소유자 이름 — 이미 싣는 층 로스터(project_members)에서 찾는다. 같은 층 이름이 먼저, 없으면 다른 층 이름.
  const nameByProjectUser = new Map<string, string>()
  const nameByUser = new Map<string, string>()
  for (const m of rows.members) {
    if (!m.user_id) continue
    nameByProjectUser.set(`${m.project_id}\u0000${m.user_id}`, m.name)
    if (!nameByUser.has(m.user_id)) nameByUser.set(m.user_id, m.name)
  }
  const ownerName = (projectId: string | null) => (uid: string): string | null =>
    (projectId !== null ? nameByProjectUser.get(`${projectId}\u0000${uid}`) : undefined) ?? nameByUser.get(uid) ?? null

  // 착수 대기 사유 재료 — 담당자 로스터 행, 프로젝트 안 선행 항목, 이 층을 보는 살아 있는 감시자.
  const memberById = new Map(rows.members.map(m => [m.id, m]))
  const predByKey = new Map(rows.predecessors.map(p => [`${p.project_id}\u0000${p.external_ref}`, p]))
  const aliveRows = rows.watchers.filter(w => isWatcherAlive(w.last_seen_at, nowMs))
  const watchersOf = (pid: string) => aliveRows.filter(w => w.project_id === null || w.project_id === pid)

  // 층 → 구역 → 책상. 구역 키는 부모 항목 id, 부모가 없으면 고정 키 둘.
  const floorMap = new Map<string, Map<string, Zone>>()
  const done = new Map<string, number>()
  for (const o of rows.orders) {
    const item = o.wbs_item_id ? itemById.get(o.wbs_item_id) : undefined
    const rights = {
      canManage: adminProjectIds.has(o.project_id)
        || (item !== undefined && isSubtreeManagerOf(item.id, ancestorById, myMemberIds)),
      assigneeMine: item?.assignee_member_id != null && myMemberIds.has(item.assignee_member_id),
    }
    const seat = toSeat(o, item, reviewByOrder.get(o.id), nowMs, rights, reportByOrder.get(o.id),
      ownerOf(o.claimed_by_user_id, viewerId, ownerName(o.project_id)))
    if (seat.state === 'READY' && item) {
      const m = item.assignee_member_id ? memberById.get(item.assignee_member_id) : undefined
      seat.waitReason = deriveWaitReason({
        depends: item.depends ?? null,
        predecessorByRef: ref => predByKey.get(`${o.project_id}\u0000${ref}`),
        // 담당자 id 는 있는데 로스터 행이 없으면 계정 미연결과 같은 취급(어느 PAT 도 담당자로 인정되지 않는다).
        assignee: item.assignee_member_id ? { name: m?.name ?? '(로스터에 없음)', user_id: m?.user_id ?? null } : null,
        watchers: watchersOf(o.project_id),
      })
      // 선행 대기는 빈자리가 아니다 — 올 사람이 정해져 있고 앞 작업만 기다린다. 실루엣으로 그린다(안 A).
      if (seat.waitReason?.kind === 'dependency') seat.anim = 'waiting'
    }
    // DONE(최근 7일 승인분)도 구역에 남긴다 — 승인 취소·재작업 요청을 좌석에서 하려면 좌석이 있어야 한다(스튜디오 v7).
    // 평면도는 이 좌석을 그리지 않고 상태 레인의 "빈자리·완료" 레인만 그린다.
    if (seat.state === 'DONE') done.set(o.project_id, (done.get(o.project_id) ?? 0) + 1)
    const zones = floorMap.get(o.project_id) ?? new Map<string, Zone>()
    floorMap.set(o.project_id, zones)
    let key: string, code: string, name: string
    if (!item) continue // 위 필터로 도달 불가 — 방어
    if (item.parent_id && parentById.get(item.parent_id)) {
      const p = parentById.get(item.parent_id)!; key = p.id; code = p.code; name = p.name
    } else { key = '__no_parent'; code = '—'; name = '구역 없음' }
    const zone = zones.get(key) ?? { key, code, name, seats: [], summary: { work: 0, wait: 0, ready: 0, done: 0 } }
    zones.set(key, zone)
    zone.seats.push(seat)
    if (WORK_STATES.includes(seat.state)) zone.summary.work++
    else if (seat.state === 'WAIT') zone.summary.wait++
    else if (seat.state === 'DONE') zone.summary.done++
    else zone.summary.ready++ // READY · OFFLINE(빈 의자)
  }

  // 내 작업이면 다른 계정의 팀장(감시자)도 뺀다 — 좌석은 내 것만 남는데 감시자만 남의 것이 보이면
  // 「내 팀장이 떠 있다」로 오독한다. 착수 대기 사유(watchersOf)는 「누가 이 층을 감시하나」라 거르지 않는다.
  const aliveWatchers: Watcher[] = rows.watchers
    .filter(w => isWatcherAlive(w.last_seen_at, nowMs) && (!mine || w.user_id === mine.userId))
    .map(w => {
      const owner = ownerOf(w.user_id, viewerId, ownerName(w.project_id))
      return { agent: w.agent, host: w.host, slots: w.slots, busy: w.busy, untilLabel: w.until_label, lastSeenAt: w.last_seen_at, projectId: w.project_id, mine: owner.mine, ownerName: owner.name }
    })
    .sort((a, b) => a.agent.localeCompare(b.agent))

  // lease 는 mine 필터로 거르지 않는다 — 「팀장 해제」는 남의 lease(다른 PC 에 남은 내 신원, 또는 관리자가 보는 남의 것)가 대상이다.
  const liveLeases = (rows.leases ?? []).filter(l => Date.parse(l.expires_at) > nowMs)
  const leadsOf = (pid: string): LeadLease[] => liveLeases
    .filter(l => l.project_id === pid)
    .map(l => {
      const owner = ownerOf(l.user_id, viewerId, ownerName(l.project_id))
      // canRelease 는 mine 필터로 대체되지 않는다 — opts.viewer 가 없으면 fail-closed(서버 액션 canReleaseLeadLease 와 같은 축).
      const canRelease = !!opts.viewer?.userId && (opts.viewer.userId === l.user_id || opts.viewer.adminProjectIds.has(pid))
      return { userId: l.user_id, host: l.host, agent: l.agent, renewedAt: l.renewed_at, expiresAt: l.expires_at, mine: owner.mine, ownerName: owner.name, canRelease }
    })
    .sort((a, b) => (a.agent ?? '').localeCompare(b.agent ?? ''))

  const floorIds = new Set<string>([...floorMap.keys(), ...done.keys()])
  const floors: Floor[] = [...floorIds].map(id => {
    const zones = [...(floorMap.get(id)?.values() ?? [])]
      .map(z => ({ ...z, seats: [...z.seats].sort((a, b) => a.code.localeCompare(b.code)) }))
      .sort((a, b) => a.code.localeCompare(b.code))
    return {
      id, name: projectName.get(id) ?? id, zones,
      seatCount: zones.reduce((n, z) => n + z.seats.filter(s => s.state !== 'DONE').length, 0),
      doneCount: done.get(id) ?? 0,
      watchers: aliveWatchers.filter(w => w.projectId === null || w.projectId === id),
      leads: leadsOf(id),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const counters = { active: 0, standby: aliveWatchers.length, idle: 0, offline: 0 }
  const attention: Attention[] = []
  for (const f of floors) for (const z of f.zones) for (const s of z.seats) {
    if (s.state === 'DONE') continue // 승인분은 doneCount 로 따로 센다 — 현황판 넷에 끼우지 않는다
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

/**
 * 좌석표가 들어야 할 실시간 채널의 프로젝트 — 프로젝트 스튜디오면 그 하나, 전체 스튜디오면 지금 층으로 그린
 * 프로젝트들. 층이 없는 프로젝트는 듣지 않는다: 첫 주문이 생기는 변화는 30초 폴링이 잡는다.
 * 정렬해 돌려주는 이유: 폴링마다 층 순서가 바뀌어도 구독을 다시 맺지 않게 한다.
 */
export function seatmapChannelProjectIds(map: Pick<Seatmap, 'floors'>, projectId?: string): string[] {
  if (projectId) return [projectId]
  return [...new Set(map.floors.map(f => f.id))].sort()
}

