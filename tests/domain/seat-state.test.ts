import { describe, expect, it } from 'vitest'
import {
  OFFLINE_MS, STALE_MS, WATCHER_TTL_MS, HEARTBEAT_PHASES, LEAD_PHASES, animFor, deriveSeatState, fnv1a32, inferPhase, isApprovalWait, isDesignWait, isRejected,
  isReviewWait, isWatcherAlive, lastSignalMs, pickCharacter, type SeatInput,
} from '@/lib/domain/seatState'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
// updatedAt 은 항상 heartbeat 보다 오래된 값으로 둔다 — 마지막 신호 = max(둘) 이라 그래야 heartbeat 로 경계를 시험할 수 있다.
const base = (over: Partial<SeatInput> = {}): SeatInput => ({
  status: 'claimed', lastHeartbeatAt: ago(1000), heartbeatPhase: 'build', updatedAt: ago(2 * 3600_000),
  lastReview: null, actualPct: 25, ...over,
})

describe('deriveSeatState — 스펙 §2 우선순위', () => {
  it('status 가 판정을 앞선다: ready/reported/approved', () => {
    expect(deriveSeatState(base({ status: 'ready' }), NOW)).toBe('READY')
    expect(deriveSeatState(base({ status: 'reported' }), NOW)).toBe('WAIT')
    expect(deriveSeatState(base({ status: 'approved' }), NOW)).toBe('DONE')
  })
  it('BLOCKED 는 시간 판정보다 앞선다 — 2시간 침묵해도 손 든 채 남는다', () => {
    expect(deriveSeatState(base({ heartbeatPhase: 'blocked', lastHeartbeatAt: ago(2 * 3600_000), updatedAt: ago(2 * 3600_000) }), NOW)).toBe('BLOCKED')
  })
  it('임계값 경계: 5분 정확히는 ACTIVE, 5분+1ms 는 STALE, 30분 정확히는 STALE, 30분+1ms 는 OFFLINE', () => {
    expect(deriveSeatState(base({ lastHeartbeatAt: ago(STALE_MS) }), NOW)).toBe('ACTIVE')
    expect(deriveSeatState(base({ lastHeartbeatAt: ago(STALE_MS + 1) }), NOW)).toBe('STALE')
    expect(deriveSeatState(base({ lastHeartbeatAt: ago(OFFLINE_MS) }), NOW)).toBe('STALE')
    expect(deriveSeatState(base({ lastHeartbeatAt: ago(OFFLINE_MS + 1) }), NOW)).toBe('OFFLINE')
  })
  it('heartbeat 가 없으면 updated_at 이 마지막 신호다(훅 없는 옛 세션)', () => {
    expect(lastSignalMs(base({ lastHeartbeatAt: null, updatedAt: ago(10_000) }))).toBe(NOW - 10_000)
    expect(deriveSeatState(base({ lastHeartbeatAt: null, updatedAt: ago(OFFLINE_MS + 1) }), NOW)).toBe('OFFLINE')
  })
  it('마지막 신호는 둘 중 늦은 쪽이다', () => {
    expect(lastSignalMs(base({ lastHeartbeatAt: ago(50_000), updatedAt: ago(5_000) }))).toBe(NOW - 5_000)
  })
  it('REJECTED 는 살아 있을 때만 — 침묵하면 STALE/OFFLINE 이 이기고 rejected 플래그는 따로 남는다', () => {
    const r = base({ lastReview: 'reject' })
    expect(deriveSeatState(r, NOW)).toBe('REJECTED')
    expect(deriveSeatState({ ...r, lastHeartbeatAt: ago(STALE_MS + 1) }, NOW)).toBe('STALE')
    expect(isRejected(r)).toBe(true)
    expect(isRejected(base({ lastReview: 'approve' }))).toBe(false)
  })
  it('cancelled 는 DONE 도 READY 도 아니다 — 화면에서 빼기 위해 DONE 으로 접지 않는다', () => {
    expect(deriveSeatState(base({ status: 'cancelled' }), NOW)).toBe('DONE')
  })
  it('lastHeartbeatAt·updatedAt 둘 다 파싱 실패면 신호를 모르는 것 — fail-closed 로 OFFLINE', () => {
    const i = base({ lastHeartbeatAt: 'garbage', updatedAt: 'garbage' })
    expect(lastSignalMs(i)).toBe(0)
    expect(deriveSeatState(i, NOW)).toBe('OFFLINE')
  })
})

describe('inferPhase — heartbeat_phase 우선, 없으면 actual_pct', () => {
  it('heartbeat_phase 가 알려진 값이면 그대로', () => {
    expect(inferPhase(base({ heartbeatPhase: 'verify' }))).toBe('verify')
  })
  it('점유(claimed) 밖의 주문은 없거나 모르는 값이면 pct 로: <25 design, <60 build, <85 verify, 그 외 refactor', () => {
    expect(inferPhase(base({ status: 'reported', heartbeatPhase: null, actualPct: 0 }))).toBe('design')
    expect(inferPhase(base({ status: 'reported', heartbeatPhase: 'weird', actualPct: 25 }))).toBe('build')
    expect(inferPhase(base({ status: 'approved', heartbeatPhase: null, actualPct: 60 }))).toBe('verify')
    expect(inferPhase(base({ status: 'reported', heartbeatPhase: null, actualPct: 85 }))).toBe('refactor')
    expect(inferPhase(base({ status: 'ready', heartbeatPhase: null, actualPct: null }))).toBe('design')
  })
  // 2026-09-24 dmes-standard 실측: claim 이 ip 크레딧(30%)을 쓰므로 pct 로 추정하면 착수 직후가 '구현'으로 보였다.
  // 점유 중인데 단계 보고가 아직 없으면 Phase 01(claim·브랜치·기준선) 중이다 — 준비로 본다.
  it('점유(claimed) 중인데 heartbeat_phase 가 없거나 모르는 값이면 pct 와 무관하게 prepare(준비)', () => {
    expect(inferPhase(base({ heartbeatPhase: null, actualPct: 30 }))).toBe('prepare')
    expect(inferPhase(base({ heartbeatPhase: null, actualPct: 0 }))).toBe('prepare')
    expect(inferPhase(base({ heartbeatPhase: null, actualPct: 85 }))).toBe('prepare')
    expect(inferPhase(base({ heartbeatPhase: 'weird', actualPct: 30 }))).toBe('prepare')
    expect(inferPhase(base({ heartbeatPhase: null, lastHeartbeatAt: null, actualPct: null }))).toBe('prepare')
  })
  it('훅이 보낸 prepare 는 알려진 값이라 그대로다', () => {
    expect(inferPhase(base({ heartbeatPhase: 'prepare', actualPct: 30 }))).toBe('prepare')
  })
  it('반려 재작업(마지막 판정 reject)은 준비로 접지 않고 종전대로 pct 로 추정한다', () => {
    expect(inferPhase(base({ heartbeatPhase: null, lastReview: 'reject', actualPct: 50 }))).toBe('build')
  })
})

describe('prepare — Phase 01 준비 단계(2026-09-24)', () => {
  it('워커 phase 목록(HEARTBEAT_PHASES)에 있어 서버가 받는다', () => {
    expect(HEARTBEAT_PHASES).toContain('prepare')
  })
  it('ACTIVE 의 prepare 는 전용 시트가 없어 typing 으로 그린다', () => {
    expect(animFor('ACTIVE', 'prepare')).toBe('typing')
  })
})

describe('wait_pred — 설계 완료·선행 대기(스펙 2026-09-26 §6.4)', () => {
  it('워커 phase 목록에 있어 서버가 받는다', () => {
    expect(HEARTBEAT_PHASES).toContain('wait_pred')
  })
  it('claimed ∧ wait_pred 는 침묵 시간과 무관하게 WAIT — STALE·OFFLINE 로 보이지 않는다', () => {
    const w = (ms: number) => base({ heartbeatPhase: 'wait_pred', lastHeartbeatAt: ago(ms), updatedAt: ago(ms) })
    expect(deriveSeatState(w(1000), NOW)).toBe('WAIT')
    expect(deriveSeatState(w(STALE_MS + 1), NOW)).toBe('WAIT')
    expect(deriveSeatState(w(OFFLINE_MS * 10), NOW)).toBe('WAIT')
    expect(inferPhase(w(1000))).toBe('wait_pred')
  })
  it('승인 대기 WAIT 와 구분한다 — isApprovalWait 은 reported 만, isDesignWait 은 claimed ∧ wait_pred 만', () => {
    expect(isApprovalWait(base({ status: 'reported' }))).toBe(true)
    expect(isApprovalWait(base({ heartbeatPhase: 'wait_pred' }))).toBe(false)
    expect(isDesignWait(base({ heartbeatPhase: 'wait_pred' }))).toBe(true)
    expect(isDesignWait(base({ status: 'reported', heartbeatPhase: 'wait_pred' }))).toBe(false)
    expect(isDesignWait(base({}))).toBe(false)
  })
  it('wait_pred 가 아닌 점유 좌석은 종전대로 침묵으로 판정한다', () => {
    expect(deriveSeatState(base({ lastHeartbeatAt: ago(OFFLINE_MS + 1), updatedAt: ago(OFFLINE_MS + 1) }), NOW)).toBe('OFFLINE')
  })
})

describe('wait_review — 설계 완료·검토 대기(스펙 2026-09-26-dflow-dev-skill-router-design.md §14.5)', () => {
  it('워커 phase 목록에 있어 서버가 받는다', () => {
    expect(HEARTBEAT_PHASES).toContain('wait_review')
  })
  it('claimed ∧ wait_review 는 침묵 시간과 무관하게 WAIT — STALE·OFFLINE 로 보이지 않는다', () => {
    const w = (ms: number) => base({ heartbeatPhase: 'wait_review', lastHeartbeatAt: ago(ms), updatedAt: ago(ms) })
    expect(deriveSeatState(w(1000), NOW)).toBe('WAIT')
    expect(deriveSeatState(w(STALE_MS + 1), NOW)).toBe('WAIT')
    expect(deriveSeatState(w(OFFLINE_MS * 10), NOW)).toBe('WAIT')
    expect(inferPhase(w(1000))).toBe('wait_review')
  })
  it('승인 대기 WAIT 와 구분한다 — isApprovalWait 은 reported 만, isReviewWait 은 claimed ∧ wait_review 만', () => {
    expect(isApprovalWait(base({ heartbeatPhase: 'wait_review' }))).toBe(false)
    expect(isReviewWait(base({ heartbeatPhase: 'wait_review' }))).toBe(true)
    expect(isReviewWait(base({ status: 'reported', heartbeatPhase: 'wait_review' }))).toBe(false)
    expect(isReviewWait(base({}))).toBe(false)
  })
  it('wait_pred 와 wait_review 는 서로 구분된다 — 둘 다 WAIT 지만 isDesignWait·isReviewWait 은 배타적이다', () => {
    expect(isDesignWait(base({ heartbeatPhase: 'wait_review' }))).toBe(false)
    expect(isReviewWait(base({ heartbeatPhase: 'wait_pred' }))).toBe(false)
  })
})

describe('animFor — 스펙 §2 표', () => {
  it('ACTIVE 는 phase 별, 모르는 phase 는 typing', () => {
    expect(animFor('ACTIVE', 'design')).toBe('design')
    expect(animFor('ACTIVE', 'build')).toBe('typing')
    expect(animFor('ACTIVE', 'verify')).toBe('verify')
    expect(animFor('ACTIVE', 'refactor')).toBe('refactor')
    expect(animFor('ACTIVE', 'reported')).toBe('typing')
  })
  it('WAIT 는 idle 3종을 slot 으로 순환한다', () => {
    expect(animFor('WAIT', 'reported', 0)).toBe('idle_coffee')
    expect(animFor('WAIT', 'reported', 1)).toBe('idle_stretch')
    expect(animFor('WAIT', 'reported', 2)).toBe('idle_look')
    expect(animFor('WAIT', 'reported', 3)).toBe('idle_coffee')
  })
  it('STALE→stale, REJECTED→rejected, BLOCKED→blocked, DONE→done, 빈자리 2종→empty', () => {
    expect(animFor('STALE', 'build')).toBe('stale')
    expect(animFor('REJECTED', 'build')).toBe('rejected')
    expect(animFor('BLOCKED', 'blocked')).toBe('blocked')
    expect(animFor('READY', 'design')).toBe('empty')
    expect(animFor('DONE', 'reported')).toBe('done') // 안 A(2026-09-19): 끝낸 사람은 자리에 남아 쉰다
    expect(animFor('OFFLINE', 'build')).toBe('empty')
  })
})

describe('pickCharacter — 같은 키는 늘 같은 캐릭터', () => {
  it('FNV-1a 32 는 알려진 값을 낸다', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
  })
  it('결정론이고 5종 안에 든다', () => {
    const a = pickCharacter('hong/mbp/w2')
    expect(pickCharacter('hong/mbp/w2')).toBe(a)
    expect(['cat', 'human_m', 'human_f', 'dog', 'bot']).toContain(a)
  })
})

describe('isWatcherAlive — TTL 70분', () => {
  it('70분 정확히는 살아 있고, 그 뒤는 죽는다', () => {
    expect(isWatcherAlive(ago(WATCHER_TTL_MS), NOW)).toBe(true)
    expect(isWatcherAlive(ago(WATCHER_TTL_MS + 1), NOW)).toBe(false)
  })
})

describe('merge_conflict — 팀장 대리 표시 phase(2026-09-23 머지 충돌 §7.3)', () => {
  it('LEAD_PHASES 에만 있고 워커 phase 목록(HEARTBEAT_PHASES)에는 없다', () => {
    expect(LEAD_PHASES).toEqual(['merge_conflict'])
    expect(HEARTBEAT_PHASES).not.toContain('merge_conflict')
  })
  it('inferPhase 는 reported·approved 주문의 merge_conflict 를 그대로 돌려준다', () => {
    expect(inferPhase(base({ status: 'reported', heartbeatPhase: 'merge_conflict' }))).toBe('merge_conflict')
    expect(inferPhase(base({ status: 'approved', heartbeatPhase: 'merge_conflict' }))).toBe('merge_conflict')
  })
  it('deriveSeatState 는 바뀌지 않는다 — 머지 충돌은 WAIT·DONE 좌석의 phase 로만 드러난다', () => {
    expect(deriveSeatState(base({ status: 'reported', heartbeatPhase: 'merge_conflict' }), NOW)).toBe('WAIT')
    expect(deriveSeatState(base({ status: 'approved', heartbeatPhase: 'merge_conflict' }), NOW)).toBe('DONE')
  })
})
