// 에이전트 명부 조립 — IO 없음. 좌석표(주문 기준)를 에이전트 기준으로 다시 묶는다(2026-09-18 에이전트 탭 시안 v2).
// 행 = 작업 PC(<신원>/<host>), 그 아래 책상 = 자리(팀장·단독 감시·팀원 N). 근거는 docs/mockups/2026-09-18-agent-screen/notes-claude.md.
//
// 신원 문자열은 규칙이 셋이다 — heartbeat_agent 는 <신원>/<host>/w<N>, 감시자는 <신원>/<host>/lead|poll,
// claimed_by 는 claude-<host> · pat-<runner8>(슬래시 거부). 앞의 둘만 작업 PC 로 묶을 수 있고, 나머지는
// 자기 이름 그대로 한 행이 된다(묶을 근거가 없는데 묶으면 화면이 거짓말한다).
import type { LeadLease, Seat, Seatmap, Watcher } from './seatmap'
import type { SeatState } from './seatState'

/** 에이전트가 자리를 차지한 상태 — 보고를 올리고 떠난 WAIT·빈 주문 READY·승인 DONE 은 자리가 아니다. */
const OCCUPIED: readonly SeatState[] = ['ACTIVE', 'REJECTED', 'BLOCKED', 'STALE', 'OFFLINE']

/** 팀장 lease(0101) — Floor.leads 는 프로젝트(층)별인데 여기서는 identity(agent) 로 다시 묶으므로,
 *  어느 프로젝트의 lease 인지(「팀장 해제」 호출에 필요)를 같이 들고 다닌다. */
export interface RosterLease extends LeadLease { projectId: string }

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
  /** 이 책상(팀장·단독 감시)이 쥔 팀장 lease — 한 PC 가 여러 프로젝트의 팀장일 수 있어 목록이다.
   *  팀장·단독 감시가 아닌 책상은 항상 []. 스펙 §7: 오피스 화면의 팀장 좌석에 lease 를 보인다. */
  leads: RosterLease[]
}
export interface RosterHost {
  key: string
  label: string
  /** <신원>/<host> 규칙을 따르는 행인지. false 면 claimed_by 한 줄짜리(작업 PC 를 알 수 없다). */
  conforming: boolean
  /** 내 계정의 팀장이나 에이전트가 이 행에 있다 — 에이전트 보기는 내 팀을 맨 앞에 둔다(2026-09-19). */
  mine: boolean
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
    if (!h) { h = { key, label, conforming, mine: false, watcher: null, slots: null, desks: [] }; hosts.set(key, h) }
    return h
  }

  // 팀장 lease(0101) — 감시자와 같은 identity(agent 문자열)로 묶는다. Floor.leads 는 이미 그 층(프로젝트)의
  // 것만 실려 있으므로, 여러 층에 걸쳐 같은 identity 가 여러 프로젝트의 팀장이면 목록으로 모인다.
  const leadsByAgent = new Map<string, RosterLease[]>()
  for (const f of map.floors) for (const l of f.leads) {
    if (!l.agent) continue
    const arr = leadsByAgent.get(l.agent) ?? []
    arr.push({ ...l, projectId: f.id })
    leadsByAgent.set(l.agent, arr)
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
    h.desks.push({ key: `watch:${w.agent}`, slot, label: id ? slotLabel(slot) : '감시', kind: 'lead', seat: null, watcher: w, raw: w.agent, leads: leadsByAgent.get(w.agent) ?? [] })
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
      h.desks.push({ key: `seat:${s.orderId}`, slot: id.slot, label: slotLabel(id.slot), kind: 'member', seat: s, watcher: null, raw: agent, leads: [] })
    } else {
      const h = ensure(agent, agent, false)
      const label = agent.startsWith('pat-') ? '외부 에이전트' : '에이전트'
      h.desks.push({ key: `seat:${s.orderId}`, slot: agent, label, kind: 'external', seat: s, watcher: null, raw: agent, leads: [] })
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
      h.desks.push({ key: `empty:${h.key}:${slot}`, slot, label: slotLabel(slot), kind: 'empty', seat: null, watcher: null, raw: null, leads: [] })
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

  for (const h of hosts.values()) h.mine = h.desks.some(d => d.watcher?.mine === true || d.seat?.agentMine === true)

  // 내 팀 먼저, 그다음 규칙을 따르는 작업 PC(감시 중인 곳 먼저), 규칙 밖 한 줄짜리는 뒤로.
  const list = [...hosts.values()].sort((a, b) =>
    Number(b.mine) - Number(a.mine) || Number(b.conforming) - Number(a.conforming) || Number(b.watcher !== null) - Number(a.watcher !== null) || a.label.localeCompare(b.label))
  return { hosts: list, tiles, agentCount: seats.length }
}

/** 명찰에 쓰는 모델 표기 — 제조사 표식·색과 짧은 이름. 모르는 값은 원문을 그대로 둔다(추측해 바꾸지 않는다). */
export type ModelVendor = 'claude' | 'openai' | 'gemini' | 'grok' | 'llama' | 'mistral' | 'deepseek' | 'qwen' | 'other'
/** 등급 — 제조사마다 자기 라인업 안에서 4단계(1 최상위 · 2 상위 · 3 표준 · 4 경량). 판정 근거가 없으면 null. */
export type ModelTier = 1 | 2 | 3 | 4
export const TIER_NAME: Record<ModelTier, string> = { 1: '최상위', 2: '상위', 3: '표준', 4: '경량' }
export interface ModelBadge { vendor: ModelVendor; label: string; color: string; mark: string; tier: ModelTier | null }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

/** Claude 외 제조사 — 앞에서부터 처음 맞는 것. prefix 는 원문 앞머리를 보기 좋은 표기로 바꾼다. */
const VENDORS: ReadonlyArray<{ vendor: ModelVendor; re: RegExp; color: string; mark: string; prefix?: [RegExp, string] }> = [
  { vendor: 'openai', re: /gpt|codex|\bo\d\b/i, color: '#10A37F', mark: '◎', prefix: [/^gpt/i, 'GPT'] },
  { vendor: 'gemini', re: /gemini/i, color: '#4285F4', mark: '✦', prefix: [/^gemini/i, 'Gemini'] },
  { vendor: 'grok', re: /grok/i, color: '#9AA0A6', mark: '✕', prefix: [/^grok/i, 'Grok'] },
  { vendor: 'llama', re: /llama/i, color: '#0668E1', mark: '∞', prefix: [/^llama/i, 'Llama'] },
  { vendor: 'mistral', re: /mistral|ministral|magistral|codestral|devstral/i, color: '#FA520F', mark: '▲', prefix: [/^(mistral|ministral|magistral|codestral|devstral)/i, '$1'] },
  { vendor: 'deepseek', re: /deepseek/i, color: '#4D6BFE', mark: '◆', prefix: [/^deepseek/i, 'DeepSeek'] },
  { vendor: 'qwen', re: /qwen/i, color: '#615CED', mark: '◇', prefix: [/^qwen/i, 'Qwen'] },
]


/** 제조사별 등급 규칙 — 위에서부터 처음 맞는 줄. 라인업 이름이 바뀌면 이 표만 고친다. */
const TIER_RULES: Partial<Record<ModelVendor, ReadonlyArray<[RegExp, ModelTier]>>> = {
  claude: [[/fable/i, 1], [/opus/i, 2], [/sonnet/i, 3], [/haiku/i, 4]],
  openai: [[/nano/i, 4], [/mini/i, 3], [/-pro\b|\bpro\b/i, 1], [/gpt|codex|\bo\d/i, 2]],
  gemini: [[/ultra|deep-?think/i, 1], [/flash-?lite|nano/i, 4], [/flash/i, 3], [/pro/i, 2]],
  grok: [[/heavy/i, 1], [/mini/i, 4], [/fast/i, 3], [/grok/i, 2]],
  mistral: [[/ministral|tiny/i, 4], [/large/i, 1], [/medium|codestral|devstral/i, 2], [/small/i, 3]],
  deepseek: [[/r\d|reason/i, 1], [/lite/i, 3], [/v\d|chat|coder/i, 2]],
  qwen: [[/max/i, 1], [/turbo|flash/i, 3], [/plus|coder/i, 2]],
  llama: [[/behemoth/i, 1], [/maverick/i, 2], [/scout/i, 3]],
}

export function modelTier(vendor: ModelVendor, raw: string): ModelTier | null {
  if (vendor === 'llama') {
    const size = /(\d+(?:\.\d+)?)\s*b\b/i.exec(raw)
    if (size) { const b = Number(size[1]); return b >= 300 ? 1 : b >= 60 ? 2 : b >= 7 ? 3 : 4 }
  }
  for (const [re, t] of TIER_RULES[vendor] ?? []) if (re.test(raw)) return t
  return null
}

export function modelBadge(model: string | null | undefined): ModelBadge | null {
  const raw = model?.trim()
  if (!raw) return null
  // Claude — 가족명(Fable · Opus · Sonnet · Haiku)과 버전만 남긴다. 날짜 꼬리(-20250929)는 버린다.
  const fam = /(fable|opus|sonnet|haiku)(?:[-\s]?(\d+)(?:[-.](\d{1,2}))?(?!\d))?/i.exec(raw)
  if (fam || /claude/i.test(raw)) {
    const label = fam ? `${cap(fam[1])}${fam[2] ? ` ${fam[2]}${fam[3] ? `.${fam[3]}` : ''}` : ''}` : 'Claude'
    return { vendor: 'claude', label, color: '#D97757', mark: '✳', tier: modelTier('claude', raw) }
  }
  for (const v of VENDORS) {
    if (!v.re.test(raw)) continue
    const label = v.prefix ? raw.replace(v.prefix[0], m => (v.prefix![1] === '$1' ? cap(m) : v.prefix![1])) : raw
    return { vendor: v.vendor, label, color: v.color, mark: v.mark, tier: modelTier(v.vendor, raw) }
  }
  return { vendor: 'other', label: raw, color: '#8A8F99', mark: '●', tier: null }
}
