// 에이전트 보기의 말풍선 대사 — IO 없음(2026-09-18 사용자 요청).
// 팀원 보고가 한동안 없으면 팀장이 잔소리를 하고, 팀원이 보고하면 그 요약을 말풍선으로 띄운다.
// 대사는 nowMs 로 돌리므로(8초마다 다음 줄) 서버·클라이언트가 같은 줄을 고른다. 작업 PC 마다 시작 줄이 다르다.
import { fnv1a32 } from './seatState'
import type { RosterDesk, RosterHost } from './agentRoster'
import type { Seat } from './seatmap'
// 대사는 officeChatter.lines.json 한 곳에 상황별(팀원 있을 때 · 없을 때 · 공통 …)로 모은다.
// 그 안의 주제 묶음(키)은 자유롭게 늘려도 되고, 여기서 묶음을 모두 합쳐 쓴다.
import LINES from './officeChatter.lines.json'

type Groups = readonly (readonly string[])[]

/** 묶음 객체({ "$설명", "개발자 밈": [...], … })에서 주제 묶음만 꺼낸다. $ 로 시작하는 키는 설명이다. */
function groupsOf(groups: Record<string, string | string[]>): Groups {
  return Object.entries(groups).flatMap(([k, v]) => (k.startsWith('$') || !Array.isArray(v) || v.length === 0 ? [] : [v]))
}

/** 이 시간 동안 어떤 팀원도 보고하지 않으면 팀장이 잔소리를 시작한다. */
export const QUIET_MS = 60_000 // 사용자 요청(09-18) 10분 → 1분
/** 팀원 보고 말풍선이 떠 있는 시간 — 지나면 단계 말풍선으로 돌아간다. */
export const REPORT_FRESH_MS = 10 * 60_000
/** 막 보고가 들어왔을 때 팀장이 칭찬하는 시간. */
export const PRAISE_MS = 45_000 // 잔소리 기준(1분)보다 짧아야 칭찬 뒤 잔소리가 이어진다
/** 대사가 바뀌는 간격. */
export const ROTATE_MS = 8_000

/** 팀장 잔소리. {name} 은 가장 오래 조용한 팀원의 자리 이름(팀원 2 …)으로 바뀐다. */
const NAG_GROUPS = groupsOf(LINES['팀원 있을 때']['잔소리'])
export const NAG_LINES: readonly string[] = NAG_GROUPS.flat()

/** 막 보고가 들어왔을 때 팀장의 반응. {name} 은 보고한 팀원. */
const PRAISE_GROUPS = groupsOf(LINES['팀원 있을 때']['칭찬'])
export const PRAISE_LINES: readonly string[] = PRAISE_GROUPS.flat()

/** 일하는 팀원이 하나도 없을 때(빈자리뿐) 팀장의 한탄. */
const EMPTY_GROUPS = groupsOf(LINES['팀원 없을 때']['한탄'])
export const EMPTY_LINES: readonly string[] = EMPTY_GROUPS.flat()

/** 팀장의 혼잣말 — 빈자리일 때 한탄과 섞이고, 잔소리 중에도 네 번에 한 번 끼어든다. */
const MUSING_GROUPS = groupsOf(LINES['공통 (팀원 있을 때·없을 때 모두)'])
export const MUSING_LINES: readonly string[] = MUSING_GROUPS.flat()

/** 계절 혼잣말 — 지금 달(한국 시간)에 맞는 묶음만 섞는다. 봄 3~5월 · 여름 6~8월 · 가을 9~11월 · 겨울 12~2월. */
export const SEASON_LINES: Readonly<Record<'spring' | 'summer' | 'autumn' | 'winter', readonly string[]>> = {
  spring: LINES['계절 혼잣말']['봄'], summer: LINES['계절 혼잣말']['여름'], autumn: LINES['계절 혼잣말']['가을'], winter: LINES['계절 혼잣말']['겨울'],
}

/** 지금 달에 맞는 계절 묶음(한국 시간 기준). */
export function seasonOf(nowMs: number): keyof typeof SEASON_LINES {
  const month = new Date(nowMs + 9 * 3600_000).getUTCMonth() + 1
  return month >= 3 && month <= 5 ? 'spring' : month <= 8 && month >= 6 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter'
}

/** 단독 감시(/poll) — 팀장이 곧 팀원이라 자기를 부르지 않고 혼잣말을 한다. */
export const SOLO_NAG_LINES: readonly string[] = LINES['단독 감시']['잔소리']
export const SOLO_PRAISE_LINES: readonly string[] = LINES['단독 감시']['칭찬']
export const SOLO_EMPTY_LINES: readonly string[] = LINES['단독 감시']['한탄']

/** 팀원 보고 말풍선의 머리말 — 요약 앞에 붙는 한마디. */
export const REPORT_OPENERS: Readonly<Record<'progress' | 'completion', readonly string[]>> = {
  progress: LINES['팀원 보고 머리말']['진행 보고'], completion: LINES['팀원 보고 머리말']['완료 보고'],
}

/** 작업 중인 팀원의 한마디 — 공통 묶음과 지금 단계 묶음. */
const WORK = LINES['팀원 작업 중']
const MEMBER_GROUPS = groupsOf(WORK['공통'])
export const MEMBER_LINES: readonly string[] = MEMBER_GROUPS.flat()
export const MEMBER_PHASE_LINES: Readonly<Record<'design' | 'build' | 'verify' | 'refactor', readonly string[]>> = {
  design: WORK['단계별']['설계'], build: WORK['단계별']['빌드'], verify: WORK['단계별']['검증'], refactor: WORK['단계별']['리팩터'],
}

/** 승인 대기 팀원의 한마디 — 보고를 올려 두고 결재를 기다린다(2026-09-18 사용자 요청). */
const WAIT_GROUPS = groupsOf(LINES['팀원 승인 대기'])
export const WAIT_LINES: readonly string[] = WAIT_GROUPS.flat()

const WORKING = new Set(['ACTIVE', 'STALE', 'OFFLINE', 'REJECTED'])

const slotOf = (nowMs: number) => Math.floor(nowMs / ROTATE_MS)

/** 해시 뒤섞기(murmur3 fmix32) — 끝 글자만 다른 입력도 나머지가 고르게 흩어지게. */
function hash(s: string): number {
  let h = fnv1a32(s)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/** 잔소리 네 번에 한 번은 혼잣말(한탄·메뉴)로 샌다. */
function musingTurn(seed: string, nowMs: number): boolean {
  return (slotOf(nowMs) + fnv1a32(seed)) % 4 === 3
}

/**
 * 주제 묶음을 먼저 고르고 그 안에서 한 줄을 고른다 — 줄 수가 많은 묶음(메뉴 고민 …)이 판을 쓸지 않게.
 * 8초 칸마다 해시로 뽑으니 순서가 뒤섞이고, 이 목록을 직전에 쓴 칸(step 칸 앞)과 같은 묶음은 피한다
 * (2026-09-18 "먹는 얘기만 한다"). 두 칸에 한 번 쓰는 목록이면 step=2.
 */
function pick(groups: Groups, seed: string, nowMs: number, step = 1): string {
  const slot = slotOf(nowMs)
  const n = groups.length
  const groupAt = (s: number) => hash(`${seed}|g|${s}`) % n
  let g = groupAt(slot)
  if (n > 1 && g === groupAt(slot - step)) g = (g + 1) % n
  const lines = groups[g]
  return lines[hash(`${seed}|l|${slot}`) % lines.length]
}

function reportMs(d: RosterDesk): number {
  const at = d.seat?.lastReport?.at
  return at ? Date.parse(at) : 0
}

/**
 * 팀원 말풍선 — 최근 보고가 있으면 머리말 + 요약. 없으면 null(단계 말풍선을 쓴다).
 * 에이전트·평면도·상태 레인이 같은 좌석(주문)에 같은 말을 띄우도록 주문 id 로 고른다.
 */
export function memberReportBubble(d: Pick<RosterDesk, 'seat'>, nowMs: number): { opener: string; text: string; kind: 'progress' | 'completion' } | null {
  const r = d.seat?.lastReport
  if (!r || nowMs - Date.parse(r.at) > REPORT_FRESH_MS) return null
  const pool = REPORT_OPENERS[r.kind]
  // 머리말은 보고 하나에 하나로 고정한다 — 8초마다 바뀌면 산만하다.
  return { opener: pool[fnv1a32(`${d.seat!.orderId}|${r.at}`) % pool.length], text: r.summary, kind: r.kind }
}

/**
 * 팀장 말풍선 — 막 보고가 들어왔으면 칭찬, 일하는 팀원이 있는데 QUIET_MS 동안 아무도 보고하지 않았거나
 * 누가 무응답·끊김이면 잔소리, 일하는 팀원이 하나도 없으면(빈자리뿐) 한탄.
 * 단독 감시(/poll)는 자기가 곧 팀원이라 자기 이름을 부르지 않고 혼잣말 묶음을 쓴다.
 * 결정 대기 팀원만 있으면(공이 사람에게 있다) 말하지 않는다.
 */
export function leadChatter(host: RosterHost, nowMs: number, lead?: Pick<RosterDesk, 'slot'>): { tone: 'nag' | 'praise' | 'empty'; text: string } | null {
  const solo = lead?.slot === 'poll'
  const members = host.desks.filter(d => d.kind === 'member' && d.seat)
  const working = members.filter(d => WORKING.has(d.seat!.state))
  if (working.length === 0) {
    if (members.length > 0) return null
    // 빈자리 한탄과 혼잣말을 번갈아 — 묶음을 한데 섞으면 혼잣말 주제가 많아 "다들 어디 갔어" 가 묻힌다.
    const lament = slotOf(nowMs) % 2 === 0 ? (solo ? [SOLO_EMPTY_LINES] : EMPTY_GROUPS) : [...MUSING_GROUPS, SEASON_LINES[seasonOf(nowMs)]]
    return { tone: 'empty', text: pick(lament, host.key, nowMs, 2) }
  }
  const latest = working.reduce((a, d) => (reportMs(d) > reportMs(a) ? d : a))
  if (reportMs(latest) > 0 && nowMs - reportMs(latest) <= PRAISE_MS) {
    return { tone: 'praise', text: pick(solo ? [SOLO_PRAISE_LINES] : PRAISE_GROUPS, host.key, nowMs).replaceAll('{name}', latest.label) }
  }
  const lagging = working.some(d => d.seat!.state === 'STALE' || d.seat!.state === 'OFFLINE')
  const quiet = working.every(d => nowMs - reportMs(d) > QUIET_MS)
  if (!lagging && !quiet) return null
  if (musingTurn(host.key, nowMs)) return { tone: 'empty', text: pick([...MUSING_GROUPS, SEASON_LINES[seasonOf(nowMs)]], `${host.key}|m`, nowMs, 4) }
  if (solo) return { tone: 'nag', text: pick([SOLO_NAG_LINES], host.key, nowMs) }
  // 지목 대상 — 끊긴 팀원이 먼저, 그다음 가장 오래 보고가 없는 팀원.
  const rank = (d: RosterDesk) => (d.seat!.state === 'OFFLINE' ? 2 : d.seat!.state === 'STALE' ? 1 : 0)
  const target = [...working].sort((a, b) => rank(b) - rank(a) || reportMs(a) - reportMs(b))[0]
  return { tone: 'nag', text: pick(NAG_GROUPS, host.key, nowMs).replaceAll('{name}', target.label) }
}

/** 팀원 한마디를 띄우는 칸 — 세 칸에 한 칸(8초 말하고 16초 단계 말풍선). 팀원마다 박자가 어긋나 한꺼번에 떠들지 않는다. */
const MEMBER_TALK_EVERY = 3

/**
 * 팀원의 한마디(2026-09-18 사용자 요청) — 작업 중(ACTIVE)과 승인 대기(WAIT)일 때만. 말하지 않는 칸에는 null(단계 말풍선을 쓴다).
 * 승인 대기는 승인을 조르는 묶음, 작업 중은 세 번에 한 번 지금 단계(설계·빌드·검증·리팩터)에 맞는 대사, 나머지는 공통 묶음.
 */
export function memberChatter(d: Pick<RosterDesk, 'seat'>, nowMs: number): string | null {
  const seat = d.seat
  if (!seat || (seat.state !== 'ACTIVE' && seat.state !== 'WAIT')) return null
  // 설계 완료·선행 대기·검토 대기는 WAIT 지만 승인을 조를 것이 없다(스펙 2026-09-26 §6.4, §14.5).
  if (seat.designWait || seat.reviewWait) return null
  const key = seat.orderId // 어느 보기에서든 같은 좌석이 같은 때 같은 말을 한다
  const slot = slotOf(nowMs)
  if ((slot + fnv1a32(key)) % MEMBER_TALK_EVERY !== 0) return null
  if (seat.state === 'WAIT') return pick(WAIT_GROUPS, `${key}|a`, nowMs, MEMBER_TALK_EVERY)
  const phase = MEMBER_PHASE_LINES[seat.phase as keyof typeof MEMBER_PHASE_LINES]
  const groups = phase && hash(`${key}|p|${slot}`) % 3 === 0 ? [phase] : MEMBER_GROUPS
  return pick(groups, `${key}|w`, nowMs, MEMBER_TALK_EVERY)
}

/** 빈자리 부재 사유(2026-09-19 사용자 요청) — 아무도 앉지 않은 팀원 자리가 왜 비었는지 익살로 보인다. 잡담이다. */
const AWAY = LINES['빈자리 부재 사유']
const AWAY_GROUPS = groupsOf(AWAY['상시'])
export const AWAY_LINES: readonly string[] = AWAY_GROUPS.flat()
export const AWAY_LUNCH_LINES: readonly string[] = AWAY['점심시간 (12~13시)']
export const AWAY_OFF_HOURS_LINES: readonly string[] = AWAY['퇴근 뒤 (18시~7시)']
/** 한 자리가 같은 사유를 유지하는 시간 — 8초마다 담배에서 은행으로 오가면 어색하다. */
export const AWAY_HOLD_MS = 5 * 60_000

/**
 * 빈자리의 지금 부재 사유. 자리 키(empty:<host>:<slot>)로 고르므로 자리마다 다르고, 5분 동안 같다.
 * 점심시간(한국 시간 12시대)과 퇴근 뒤(18시~7시)에는 절반의 확률로 그 시간대 묶음을 쓴다.
 * 주제 묶음은 직전 5분과 겹치지 않게 한다(pick 과 같은 규칙).
 */
export function awayReason(deskKey: string, nowMs: number): string {
  const slot = Math.floor(nowMs / AWAY_HOLD_MS)
  const hour = new Date(nowMs + 9 * 3600_000).getUTCHours()
  const timed = hour === 12 ? AWAY_LUNCH_LINES : hour >= 18 || hour < 7 ? AWAY_OFF_HOURS_LINES : null
  if (timed && hash(`${deskKey}|t|${slot}`) % 2 === 0) return timed[hash(`${deskKey}|tl|${slot}`) % timed.length]
  const n = AWAY_GROUPS.length
  const groupAt = (s: number) => hash(`${deskKey}|g|${s}`) % n
  let g = groupAt(slot)
  if (n > 1 && g === groupAt(slot - 1)) g = (g + 1) % n
  const lines = AWAY_GROUPS[g]
  return lines[hash(`${deskKey}|l|${slot}`) % lines.length]
}

/**
 * 무거운 작업 말풍선(2026-09-26 사용자 요청 "무거운 작업중 : 어떤 작업") — 설계 2026-09-26-heavy-work-office-bubble-design.md §3.
 * 경과 시간 단계별 한마디(sub)는 잡담이라 chatter=false 면 빠지고, 머리말·작업 이름은 업무라 남는다.
 */
const HEAVY = LINES['무거운 작업 중']
export const HEAVY_TIER_LINES: Readonly<Record<'warm' | 'hot' | 'hotter' | 'scream', readonly string[]>> = {
  warm: HEAVY['예열 (1분 전)'], hot: HEAVY['달아오름 (1~5분)'], hotter: HEAVY['뜨끈 (5~10분)'], scream: HEAVY['비명 (10분 넘게)'],
}
const HEAVY_WAIT_GROUPS = groupsOf(LINES['무거운 작업 대기'])
export const HEAVY_WAIT_LINES: readonly string[] = HEAVY_WAIT_GROUPS.flat()
/** 열기 막대가 가득 차는 경과 — 전체 테스트 한 판이 대개 이 안에 끝난다. */
export const HEAVY_FULL_MS = 10 * 60_000

function heavyTier(elapsedMs: number): keyof typeof HEAVY_TIER_LINES {
  return elapsedMs < 60_000 ? 'warm' : elapsedMs < 5 * 60_000 ? 'hot' : elapsedMs < HEAVY_FULL_MS ? 'hotter' : 'scream'
}

export function heavyBubble(seat: Pick<Seat, 'orderId' | 'heavy'>, nowMs: number, chatter = true):
  { kind: 'heavy' | 'heavyWait'; opener: string; text: string; sub?: string; meter?: number; detail: string } | null {
  const h = seat.heavy
  if (!h) return null
  const name = `${h.label}${h.docker ? ' 🐳' : ''}`
  const more = h.more > 0 ? ` 외 ${h.more}건` : ''
  if (h.state === 'wait') {
    const ahead = h.pos === null ? '' : h.pos <= 1 ? ' · 다음 차례' : ` · 앞에 ${h.pos - 1}명`
    return {
      kind: 'heavyWait', opener: `⏳ 무거운 작업 순번 대기${h.pos === null ? '' : ` · ${h.pos}번째`}`,
      text: `${name}${more}${ahead}`, detail: h.cmd,
      ...(chatter ? { sub: pick(HEAVY_WAIT_GROUPS, `${seat.orderId}|hw`, nowMs) } : {}),
    }
  }
  const elapsed = h.sinceMs === null ? null : Math.max(0, nowMs - h.sinceMs)
  const mins = elapsed === null ? null : Math.floor(elapsed / 60_000)
  return {
    kind: 'heavy',
    opener: `🔥 무거운 작업 중${mins === null ? '' : mins < 1 ? ' · 방금 시작' : ` · ${mins}분째`}`,
    text: `${name}${more}`, detail: h.cmd,
    ...(elapsed === null ? {} : { meter: Math.min(1, elapsed / HEAVY_FULL_MS) }),
    ...(chatter ? { sub: pick([HEAVY_TIER_LINES[heavyTier(elapsed ?? 0)]], `${seat.orderId}|h`, nowMs) } : {}),
  }
}

/** 빈자리 말풍선 — 팀원 한마디처럼 세 칸에 한 칸만 띄운다. 자리마다 박자가 어긋나 한꺼번에 뜨지 않는다. */
export function awayBubble(deskKey: string, nowMs: number): string | null {
  if ((slotOf(nowMs) + fnv1a32(deskKey)) % MEMBER_TALK_EVERY !== 0) return null
  return awayReason(deskKey, nowMs)
}
