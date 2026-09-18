// 에이전트 명부 조립 — IO 없음. 좌석표(주문 기준)를 에이전트 기준으로 다시 묶는다(2026-09-18 에이전트 탭 시안 v2).
// 행 = 작업 PC(<신원>/<host>), 그 아래 책상 = 자리(팀장·단독 감시·팀원 N). 근거는 docs/mockups/2026-09-18-agent-screen/notes-claude.md.
//
// 신원 문자열은 규칙이 셋이다 — heartbeat_agent 는 <신원>/<host>/w<N>, 감시자는 <신원>/<host>/lead|poll,
// claimed_by 는 claude-<host> · pat-<runner8>(슬래시 거부). 앞의 둘만 작업 PC 로 묶을 수 있고, 나머지는
// 자기 이름 그대로 한 행이 된다(묶을 근거가 없는데 묶으면 화면이 거짓말한다).
import type { Seat, Seatmap, Watcher } from './seatmap'
import type { SeatState } from './seatState'

/** 에이전트가 자리를 차지한 상태 — 보고를 올리고 떠난 WAIT·빈 주문 READY·승인 DONE 은 자리가 아니다. */
const OCCUPIED: readonly SeatState[] = ['ACTIVE', 'REJECTED', 'BLOCKED', 'STALE', 'OFFLINE']

export type DeskKind = 'lead' | 'member' | 'empty' | 'external'
export interface RosterDesk {
  key: string
  /** 원래 자리 토큰(lead · poll · w2 …) 또는 규칙 밖 신원 전체. */
  slot: string
  label: string
  kind: DeskKind
  seat: Seat | null
  watcher: Watcher | null
  /** 신원 원문 — 화면이 작게 보여 준다. 빈자리는 null. */
  raw: string | null
}
export interface RosterHost {
  key: string
  label: string
  /** <신원>/<host> 규칙을 따르는 행인지. false 면 claimed_by 한 줄짜리(작업 PC 를 알 수 없다). */
  conforming: boolean
  watcher: Watcher | null
  slots: number | null
  desks: RosterDesk[]
}
export interface RosterTiles { working: number; blocked: number; stale: number; offline: number; empty: number }
export interface Roster { hosts: RosterHost[]; tiles: RosterTiles; agentCount: number }

export function parseAgentId(raw: string): { owner: string; host: string; slot: string } | null {
  const p = raw.split('/')
  if (p.length !== 3 || p.some(x => x.trim() === '')) return null
  return { owner: p[0], host: p[1], slot: p[2] }
}

export function slotLabel(slot: string): string {
  const m = /^w(\d+)$/.exec(slot)
  if (m) return `팀원 ${Number(m[1])}`
  if (slot === 'lead') return '팀장'
  if (slot === 'poll') return '단독 감시'
  return slot
}

function slotRank(d: RosterDesk): number {
  if (d.kind === 'lead') return -1
  const m = /^w(\d+)$/.exec(d.slot)
  return m ? Number(m[1]) : 10_000
}

export function assembleRoster(map: Pick<Seatmap, 'floors'>): Roster {
  const hosts = new Map<string, RosterHost>()
  const ensure = (key: string, label: string, conforming: boolean): RosterHost => {
    let h = hosts.get(key)
    if (!h) { h = { key, label, conforming, watcher: null, slots: null, desks: [] }; hosts.set(key, h) }
    return h
  }

  // 감시자 — 층마다 같은 감시자(project_id null)가 겹쳐 실리므로 agent 로 한 번만 센다.
  const watchers = new Map<string, Watcher>()
  for (const f of map.floors) for (const w of f.watchers) {
    const cur = watchers.get(w.agent)
    if (!cur || Date.parse(w.lastSeenAt) > Date.parse(cur.lastSeenAt)) watchers.set(w.agent, w)
  }
  for (const w of watchers.values()) {
    const id = parseAgentId(w.agent)
    const h = id ? ensure(`${id.owner}/${id.host}`, `${id.owner} / ${id.host}`, true) : ensure(w.agent, w.agent, false)
    // 한 PC 에 감시자가 둘이면(팀장 + 단독 감시) 최근 신호 쪽의 좌석 수를 행 정보로 쓴다.
    if (!h.watcher || Date.parse(w.lastSeenAt) > Date.parse(h.watcher.lastSeenAt)) { h.watcher = w; h.slots = w.slots }
    const slot = id?.slot ?? 'lead'
    h.desks.push({ key: `watch:${w.agent}`, slot, label: id ? slotLabel(slot) : '감시', kind: 'lead', seat: null, watcher: w, raw: w.agent })
  }

  const seats: Seat[] = []
  for (const f of map.floors) for (const z of f.zones) for (const s of z.seats) {
    if (s.agent && OCCUPIED.includes(s.state)) seats.push(s)
  }
  for (const s of seats) {
    const agent = s.agent!
    const id = parseAgentId(agent)
    if (id) {
      const h = ensure(`${id.owner}/${id.host}`, `${id.owner} / ${id.host}`, true)
      h.desks.push({ key: `seat:${s.orderId}`, slot: id.slot, label: slotLabel(id.slot), kind: 'member', seat: s, watcher: null, raw: agent })
    } else {
      const h = ensure(agent, agent, false)
      const label = agent.startsWith('pat-') ? '외부 에이전트' : '에이전트'
      h.desks.push({ key: `seat:${s.orderId}`, slot: agent, label, kind: 'external', seat: s, watcher: null, raw: agent })
    }
  }

  // 빈자리 — 감시자가 밝힌 좌석 수(slots)만큼 팀원 자리를 채우고, 아무도 앉지 않은 번호를 빈 책상으로 둔다.
  let empty = 0
  for (const h of hosts.values()) {
    if (h.slots === null || h.slots <= 0) continue
    const taken = new Set(h.desks.filter(d => d.kind === 'member').map(d => d.slot))
    for (let i = 1; i <= h.slots; i++) {
      const slot = `w${i}`
      if (taken.has(slot)) continue
      h.desks.push({ key: `empty:${h.key}:${slot}`, slot, label: slotLabel(slot), kind: 'empty', seat: null, watcher: null, raw: null })
      empty++
    }
    h.desks.sort((a, b) => slotRank(a) - slotRank(b) || a.key.localeCompare(b.key))
  }
  for (const h of hosts.values()) if (h.slots === null) h.desks.sort((a, b) => slotRank(a) - slotRank(b) || a.key.localeCompare(b.key))

  const tiles: RosterTiles = { working: 0, blocked: 0, stale: 0, offline: 0, empty }
  for (const s of seats) {
    if (s.state === 'BLOCKED') tiles.blocked++
    else if (s.state === 'STALE') tiles.stale++
    else if (s.state === 'OFFLINE') tiles.offline++
    else tiles.working++ // ACTIVE · REJECTED(재작업 중)
  }

  // 규칙을 따르는 작업 PC 먼저(감시 중인 곳 먼저), 규칙 밖 한 줄짜리는 뒤로.
  const list = [...hosts.values()].sort((a, b) =>
    Number(b.conforming) - Number(a.conforming) || Number(b.watcher !== null) - Number(a.watcher !== null) || a.label.localeCompare(b.label))
  return { hosts: list, tiles, agentCount: seats.length }
}
