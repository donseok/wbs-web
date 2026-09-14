import { describe, expect, it } from 'vitest'
import {
  OFFLINE_MS, STALE_MS, WATCHER_TTL_MS, animFor, deriveSeatState, fnv1a32, inferPhase, isRejected,
  isWatcherAlive, lastSignalMs, pickCharacter, type SeatInput,
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
})

describe('inferPhase — heartbeat_phase 우선, 없으면 actual_pct', () => {
  it('heartbeat_phase 가 알려진 값이면 그대로', () => {
    expect(inferPhase(base({ heartbeatPhase: 'verify' }))).toBe('verify')
  })
  it('없거나 모르는 값이면 pct 로: <25 design, <60 build, <85 verify, 그 외 refactor', () => {
    expect(inferPhase(base({ heartbeatPhase: null, actualPct: 0 }))).toBe('design')
    expect(inferPhase(base({ heartbeatPhase: 'weird', actualPct: 25 }))).toBe('build')
    expect(inferPhase(base({ heartbeatPhase: null, actualPct: 60 }))).toBe('verify')
    expect(inferPhase(base({ heartbeatPhase: null, actualPct: 85 }))).toBe('refactor')
    expect(inferPhase(base({ heartbeatPhase: null, actualPct: null }))).toBe('design')
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
  it('STALE→stale, REJECTED→rejected, BLOCKED→idle_look, 빈자리 3종→empty', () => {
    expect(animFor('STALE', 'build')).toBe('stale')
    expect(animFor('REJECTED', 'build')).toBe('rejected')
    expect(animFor('BLOCKED', 'blocked')).toBe('idle_look')
    expect(animFor('READY', 'design')).toBe('empty')
    expect(animFor('DONE', 'reported')).toBe('empty')
    expect(animFor('OFFLINE', 'build')).toBe('empty')
  })
})

describe('pickCharacter — 같은 키는 늘 같은 캐릭터', () => {
  it('FNV-1a 32 는 알려진 값을 낸다', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
  })
  it('결정론이고 4종 안에 든다', () => {
    const a = pickCharacter('hong/mbp/w2')
    expect(pickCharacter('hong/mbp/w2')).toBe(a)
    expect(['monitor_bot', 'cat_dev', 'human_dev', 'dome_bot']).toContain(a)
  })
})

describe('isWatcherAlive — TTL 70분', () => {
  it('70분 정확히는 살아 있고, 그 뒤는 죽는다', () => {
    expect(isWatcherAlive(ago(WATCHER_TTL_MS), NOW)).toBe(true)
    expect(isWatcherAlive(ago(WATCHER_TTL_MS + 1), NOW)).toBe(false)
  })
})
