// 좌석표 상태 판정 — IO 없음. 정본: docs/superpowers/specs/2026-09-14-agent-office-v1-design.md §2
export type OrderStatus = 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'
export type SeatState = 'READY' | 'WAIT' | 'DONE' | 'BLOCKED' | 'OFFLINE' | 'STALE' | 'REJECTED' | 'ACTIVE'
export type Phase = 'prepare' | 'design' | 'build' | 'verify' | 'refactor' | 'blocked' | 'rejected' | 'reported' | 'merge_conflict' | 'wait_pred' | 'wait_review'
export type AnimName =
  | 'typing' | 'design' | 'verify' | 'refactor' | 'stale'
  | 'idle_coffee' | 'idle_stretch' | 'idle_look' | 'blocked' | 'rejected' | 'empty'
  /** 자리를 비우지 않은 두 상태의 가명 — 전용 시트가 아직 없어 Sprite 가 기존 시트로 그린다(2026-09-19 안 A).
   *  done = 끝내고 쉬는 사람(DONE), waiting = 아직 오지 않은 사람(READY 중 선행 대기). */
  | 'done' | 'waiting'
/** public/sprites/<이 이름>/<AnimName>.png — 2026-09-16 새로 그린 캐릭터 시트 다섯 벌과 같은 이름이다(가명 done·waiting 제외). */
export type CharacterName = 'cat' | 'human_m' | 'human_f' | 'dog' | 'bot'

/** prepare = /dflow-dev Phase 01(claim·브랜치·기준선) 중 — state.json 을 phase=prepare 로 쓰면 훅이 보낸다(2026-09-24).
 *  scaffold 가 만드는 ready 는 싣지 않는다: 주문 전 자리표라 받으면 남의 ready 주문으로 신호가 샌다.
 *  wait_pred = 설계 선행으로 설계를 끝냈고 선행을 기다리며 멈춘다(계약 2.9, 스펙 2026-09-26 §6.4) — 멈춘 뒤로 heartbeat 가
 *  끊기므로 좌석은 침묵 시간과 무관하게 WAIT(선행 대기)로 본다.
 *  wait_review = `--scope design`(설계만) 으로 돌다 설계를 마치고 사람의 검토를 기다리며 멈춘다(계약 2.10, 스펙
 *  2026-09-26-dflow-dev-skill-router-design.md §14.5) — wait_pred 와 같이 WAIT·침묵 무관이지만 사유가 다르다:
 *  선행이 아니라 사람 검토를 기다린다. wait_pred 로 적으면 팀장의 설계 완료 대기 자동 재개(design-ahead)가
 *  사람 검토 없이 구현을 시작해 버린다(§14.2). */
export const HEARTBEAT_PHASES: readonly Phase[] = ['prepare', 'design', 'build', 'verify', 'refactor', 'blocked', 'rejected', 'reported', 'wait_pred', 'wait_review']
/** 팀장이 대리로 쏘는 표시 phase — reported·approved 주문에만 받는다(heartbeat 라우트). 워커 phase 와 섞지 않는다.
 *  정본: docs/superpowers/specs/2026-09-23-parallel-merge-conflict-design.md §7.2~7.3 */
export const LEAD_PHASES: readonly Phase[] = ['merge_conflict']
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

/** 설계 완료·선행 대기 — 점유 중이고 마지막 heartbeat 가 wait_pred. 좌석은 WAIT 지만 승인 대기가 아니다. */
export function isDesignWait(i: Pick<SeatInput, 'status' | 'heartbeatPhase'>): boolean {
  return i.status === 'claimed' && i.heartbeatPhase === 'wait_pred'
}

/** 설계 완료·검토 대기(스펙 §14.5) — 점유 중이고 마지막 heartbeat 가 wait_review. isDesignWait 과 같은 축(WAIT 이지만
 *  승인 대기가 아니다)이지만 사유가 다르다(선행이 아니라 사람 검토). */
export function isReviewWait(i: Pick<SeatInput, 'status' | 'heartbeatPhase'>): boolean {
  return i.status === 'claimed' && i.heartbeatPhase === 'wait_review'
}

/** 승인 대기 — WAIT 중 사람이 결재할 것(reported)만. 설계 완료·선행 대기(isDesignWait)·검토 대기(isReviewWait)는 WAIT 이지만 여기 들지 않는다. */
export function isApprovalWait(i: Pick<SeatInput, 'status'>): boolean {
  return i.status === 'reported'
}

export function deriveSeatState(i: SeatInput, nowMs: number): SeatState {
  if (i.status === 'ready') return 'READY'
  if (i.status === 'reported') return 'WAIT'
  if (i.status !== 'claimed') return 'DONE' // approved · cancelled — 화면은 cancelled 를 조회에서 뺀다
  if (i.heartbeatPhase === 'blocked') return 'BLOCKED'
  // 설계 선행 뒤 선행 대기·검토 대기로 멈춘 주문 — 자동 회수가 없어 heartbeat 가 끊긴 채 남는다. 끊김으로 보이지 않게 침묵 판정보다 먼저.
  if (isDesignWait(i) || isReviewWait(i)) return 'WAIT'
  const silence = nowMs - lastSignalMs(i)
  if (silence > OFFLINE_MS) return 'OFFLINE'
  if (silence > STALE_MS) return 'STALE'
  if (isRejected(i)) return 'REJECTED'
  return 'ACTIVE'
}

export function inferPhase(i: SeatInput): Phase {
  if (i.heartbeatPhase && ([...HEARTBEAT_PHASES, ...LEAD_PHASES] as readonly string[]).includes(i.heartbeatPhase)) {
    return i.heartbeatPhase as Phase
  }
  // 점유 중인데 단계 보고가 없으면 Phase 01(claim·브랜치·기준선) 중이다. pct 로 추정하지 않는다 — claim 이
  // ip 크레딧(기본 30%)을 쓰므로 착수 직후가 '구현'으로 보였다(2026-09-24 dmes-standard 실측).
  // 반려 재작업은 예외 — 종전대로 pct 로 추정한다(재작업은 준비 단계를 다시 거치지 않는다).
  if (i.status === 'claimed' && i.lastReview !== 'reject') return 'prepare'
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
    case 'DONE': return 'done' // 빈 의자와 구분한다 — 끝낸 사람이 자리에 남아 쉰다
    // READY 는 사유를 알아야 갈린다(선행 대기면 waiting) — 사유는 조립 뒤에 정해지므로 seatmap 이 다시 고른다.
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
