// 에이전트 보기의 말풍선 대사 — IO 없음(2026-09-18 사용자 요청).
// 팀원 보고가 한동안 없으면 팀장이 잔소리를 하고, 팀원이 보고하면 그 요약을 말풍선으로 띄운다.
// 대사는 nowMs 로 돌리므로(8초마다 다음 줄) 서버·클라이언트가 같은 줄을 고른다. 작업 PC 마다 시작 줄이 다르다.
import { fnv1a32 } from './seatState'
import type { RosterDesk, RosterHost } from './agentRoster'
// 대사는 officeChatter.lines.json 한 곳에 상황별(팀원 있을 때 · 없을 때 · 공통 …)로 모은다.
// 그 안의 주제 묶음(키)은 자유롭게 늘려도 되고, 여기서 묶음을 모두 합쳐 쓴다.
import LINES from './officeChatter.lines.json'

/** 묶음 객체({ "$설명", "개발자 밈": [...], … })를 한 줄 목록으로 편다. $ 로 시작하는 키는 설명이다. */
function flat(groups: Record<string, string | string[]>): string[] {
  return Object.entries(groups).flatMap(([k, v]) => (k.startsWith('$') || !Array.isArray(v) ? [] : v))
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
export const NAG_LINES: readonly string[] = flat(LINES['팀원 있을 때']['잔소리'])

/** 막 보고가 들어왔을 때 팀장의 반응. {name} 은 보고한 팀원. */
export const PRAISE_LINES: readonly string[] = flat(LINES['팀원 있을 때']['칭찬'])

/** 일하는 팀원이 하나도 없을 때(빈자리뿐) 팀장의 한탄. */
export const EMPTY_LINES: readonly string[] = flat(LINES['팀원 없을 때']['한탄'])

/** 팀장의 혼잣말 — 빈자리일 때 한탄과 섞이고, 잔소리 중에도 네 번에 한 번 끼어든다. */
export const MUSING_LINES: readonly string[] = flat(LINES['공통 (팀원 있을 때·없을 때 모두)'])

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

const WORKING = new Set(['ACTIVE', 'STALE', 'OFFLINE', 'REJECTED'])

/** 잔소리 네 번에 한 번은 혼잣말(한탄·메뉴)로 샌다. */
function musingTurn(seed: string, nowMs: number): boolean {
  return (Math.floor(nowMs / ROTATE_MS) + fnv1a32(seed)) % 4 === 3
}

function pick(lines: readonly string[], seed: string, nowMs: number): string {
  const i = (Math.floor(nowMs / ROTATE_MS) + fnv1a32(seed)) % lines.length
  return lines[i]
}

function reportMs(d: RosterDesk): number {
  const at = d.seat?.lastReport?.at
  return at ? Date.parse(at) : 0
}

/** 팀원 말풍선 — 최근 보고가 있으면 머리말 + 요약. 없으면 null(단계 말풍선을 쓴다). */
export function memberReportBubble(d: RosterDesk, nowMs: number): { opener: string; text: string; kind: 'progress' | 'completion' } | null {
  const r = d.seat?.lastReport
  if (!r || nowMs - Date.parse(r.at) > REPORT_FRESH_MS) return null
  const pool = REPORT_OPENERS[r.kind]
  // 머리말은 보고 하나에 하나로 고정한다 — 8초마다 바뀌면 산만하다.
  return { opener: pool[fnv1a32(`${d.key}|${r.at}`) % pool.length], text: r.summary, kind: r.kind }
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
    return { tone: 'empty', text: pick([...(solo ? SOLO_EMPTY_LINES : EMPTY_LINES), ...MUSING_LINES, ...SEASON_LINES[seasonOf(nowMs)]], host.key, nowMs) }
  }
  const latest = working.reduce((a, d) => (reportMs(d) > reportMs(a) ? d : a))
  if (reportMs(latest) > 0 && nowMs - reportMs(latest) <= PRAISE_MS) {
    return { tone: 'praise', text: pick(solo ? SOLO_PRAISE_LINES : PRAISE_LINES, host.key, nowMs).replaceAll('{name}', latest.label) }
  }
  const lagging = working.some(d => d.seat!.state === 'STALE' || d.seat!.state === 'OFFLINE')
  const quiet = working.every(d => nowMs - reportMs(d) > QUIET_MS)
  if (!lagging && !quiet) return null
  if (musingTurn(host.key, nowMs)) return { tone: 'empty', text: pick([...MUSING_LINES, ...SEASON_LINES[seasonOf(nowMs)]], `${host.key}|m`, nowMs) }
  if (solo) return { tone: 'nag', text: pick(SOLO_NAG_LINES, host.key, nowMs) }
  // 지목 대상 — 끊긴 팀원이 먼저, 그다음 가장 오래 보고가 없는 팀원.
  const rank = (d: RosterDesk) => (d.seat!.state === 'OFFLINE' ? 2 : d.seat!.state === 'STALE' ? 1 : 0)
  const target = [...working].sort((a, b) => rank(b) - rank(a) || reportMs(a) - reportMs(b))[0]
  return { tone: 'nag', text: pick(NAG_LINES, host.key, nowMs).replaceAll('{name}', target.label) }
}
