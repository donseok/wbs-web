// 좌석표 상태 판정 — IO 없음. 정본: docs/superpowers/specs/2026-09-14-agent-office-v1-design.md §2
export type OrderStatus = 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'
export type SeatState = 'READY' | 'WAIT' | 'DONE' | 'BLOCKED' | 'OFFLINE' | 'STALE' | 'REJECTED' | 'ACTIVE'
export type Phase = 'design' | 'build' | 'verify' | 'refactor' | 'blocked' | 'rejected' | 'reported'
export type AnimName =
  | 'typing' | 'design' | 'verify' | 'refactor' | 'stale'
  | 'idle_coffee' | 'idle_stretch' | 'idle_look' | 'blocked' | 'rejected' | 'empty'
/** public/sprites/<이 이름>/<AnimName>.png — 2026-09-16 새로 그린 캐릭터 시트 다섯 벌과 같은 이름이다. */
export type CharacterName = 'cat' | 'human_m' | 'human_f' | 'dog' | 'bot'

export const HEARTBEAT_PHASES: readonly Phase[] = ['design', 'build', 'verify', 'refactor', 'blocked', 'rejected', 'reported']
/** 임계값 초안(정리본 §3). 운영하며 조정한다. */
export const STALE_MS = 5 * 60_000
export const OFFLINE_MS = 30 * 60_000
/** 팀장 잠금의 죽음 판정(두 TICK 연속 누락)과 같은 값. */
export const WATCHER_TTL_MS = 70 * 60_000

const CHARACTERS: readonly CharacterName[] = ['cat', 'human_m', 'human_f', 'dog', 'bot']
const IDLE_ANIMS: readonly AnimName[] = ['idle_coffee', 'idle_stretch', 'idle_look']

export interface SeatInput {
  status: OrderStatus
  lastHeartbeatAt: string | null
  heartbeatPhase: string | null
  updatedAt: string
  /** 그 주문의 마지막 completion 보고 판정. 없으면 null. */
  lastReview: 'approve' | 'reject' | null
  actualPct: number | null
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : Number.NaN)

/** 마지막 신호 = max(last_heartbeat_at, updated_at). heartbeat 가 없던 옛 주문은 progress 가 touch 한 updated_at 으로 판정된다. */
export function lastSignalMs(i: SeatInput): number {
  const hb = ms(i.lastHeartbeatAt), up = ms(i.updatedAt)
  if (Number.isNaN(hb) && Number.isNaN(up)) return 0 // 신호를 모르면 죽은 것으로 본다(fail-closed)
  if (Number.isNaN(hb)) return up
  if (Number.isNaN(up)) return hb
  return Math.max(hb, up)
}

export function isRejected(i: SeatInput): boolean {
  return i.status === 'claimed' && i.lastReview === 'reject'
}

export function deriveSeatState(i: SeatInput, nowMs: number): SeatState {
  if (i.status === 'ready') return 'READY'
  if (i.status === 'reported') return 'WAIT'
  if (i.status !== 'claimed') return 'DONE' // approved · cancelled — 화면은 cancelled 를 조회에서 뺀다
  if (i.heartbeatPhase === 'blocked') return 'BLOCKED'
  const silence = nowMs - lastSignalMs(i)
  if (silence > OFFLINE_MS) return 'OFFLINE'
  if (silence > STALE_MS) return 'STALE'
  if (isRejected(i)) return 'REJECTED'
  return 'ACTIVE'
}

export function inferPhase(i: SeatInput): Phase {
  if (i.heartbeatPhase && (HEARTBEAT_PHASES as readonly string[]).includes(i.heartbeatPhase)) {
    return i.heartbeatPhase as Phase
  }
  const pct = i.actualPct ?? 0
  if (pct < 25) return 'design'
  if (pct < 60) return 'build'
  if (pct < 85) return 'verify'
  return 'refactor'
}

export function animFor(state: SeatState, phase: Phase, idleSlot = 0): AnimName {
  switch (state) {
    case 'ACTIVE':
      if (phase === 'design' || phase === 'verify' || phase === 'refactor') return phase
      return 'typing'
    case 'WAIT': return IDLE_ANIMS[((idleSlot % 3) + 3) % 3]
    case 'STALE': return 'stale'
    case 'REJECTED': return 'rejected'
    case 'BLOCKED': return 'blocked' // 새 시트에 물음표 말풍선 동작이 들어왔다(2026-09-16) — 옛 idle_look 대체를 걷었다
    default: return 'empty'
  }
}

/** FNV-1a 32비트 — 캐릭터 배정용. 같은 AGENT_ID 는 늘 같은 인물이어야 한다(팀장 스펙 §9-1). */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function pickCharacter(key: string): CharacterName {
  return CHARACTERS[fnv1a32(key) % CHARACTERS.length]
}

export function isWatcherAlive(lastSeenAt: string, nowMs: number): boolean {
  return nowMs - Date.parse(lastSeenAt) <= WATCHER_TTL_MS
}
