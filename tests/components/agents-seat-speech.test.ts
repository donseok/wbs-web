// tests/components/agents-seat-speech.test.ts
// 잡담 켬/끔(2026-09-18) — 끄면 팀원 한마디가 사라지고, 보고 말풍선(업무)은 남는다.
import { describe, it, expect } from 'vitest'
import type { Seat } from '@/lib/domain/seatmap'
import { seatSpeech } from '@/components/agents/SeatSpeech'
import { HEAVY_TIER_LINES, ROTATE_MS } from '@/lib/domain/officeChatter'

const NOW = Date.parse('2026-09-18T09:00:00Z')
const seat = (over: Partial<Seat> = {}): Seat => ({ orderId: 'o-1', state: 'ACTIVE', phase: 'build', lastReport: null, ...over } as Seat)

/** 한마디가 뜨는 칸 하나를 찾는다 — 세 칸에 한 칸이라 앞의 여섯 칸 안에 반드시 있다. */
function talkingAt(s: Seat): number {
  for (let k = 0; k < 6; k++) {
    const t = NOW + k * ROTATE_MS
    if (seatSpeech(s, t)?.kind === 'chat') return t
  }
  throw new Error('한마디 칸을 찾지 못했다')
}

describe('seatSpeech — 잡담 켬/끔', () => {
  it('켬(기본)이면 작업 중 팀원이 한마디 한다', () => {
    const s = seat()
    expect(seatSpeech(s, talkingAt(s))?.kind).toBe('chat')
  })
  it('끔이면 같은 순간에도 한마디가 없다 — 단계 말풍선 자리로 돌아간다', () => {
    const s = seat()
    expect(seatSpeech(s, talkingAt(s), false)).toBeNull()
  })
  it('승인 대기 팀원은 켬이면 승인을 조르고, 끔이면 말하지 않는다', () => {
    const s = seat({ state: 'WAIT', phase: 'reported' })
    const t = talkingAt(s)
    expect(seatSpeech(s, t)?.kind).toBe('chat')
    expect(seatSpeech(s, t, false)).toBeNull()
  })
  it('끔이어도 막 올린 보고는 업무라 그대로 뜬다', () => {
    const s = seat({ lastReport: { kind: 'completion', summary: '로그인 화면 완료', at: new Date(NOW - 30_000).toISOString() } } as Partial<Seat>)
    const say = seatSpeech(s, NOW, false)
    expect(say?.kind).toBe('done')
    expect(say?.text).toBe('로그인 화면 완료')
  })
})

// 무거운 작업 표시(docs/superpowers/specs/2026-09-26-heavy-work-office-bubble-design.md §3)
describe('seatSpeech — 무거운 작업', () => {
  const run = (over: Partial<NonNullable<Seat['heavy']>> = {}): Seat['heavy'] =>
    ({ state: 'run', label: '전체 테스트', cmd: 'npm run test', sinceMs: NOW - 3 * 60_000, pos: null, more: 0, docker: false, ...over })
  const progress = { kind: 'progress', summary: 'B1 시작', at: new Date(NOW - 30_000).toISOString() } as const

  it('막 올린 진행 보고보다 앞선다 — 머리말 "무거운 작업 중 · N분째", 본문 작업 이름, 열기 막대', () => {
    const say = seatSpeech(seat({ heavy: run(), lastReport: progress }), NOW)
    expect(say?.kind).toBe('heavy')
    expect(say?.opener).toBe('🔥 무거운 작업 중 · 3분째')
    expect(say?.text).toBe('전체 테스트')
    expect(say?.meter).toBeCloseTo(0.3)
    expect(HEAVY_TIER_LINES.hot).toContain(say?.sub)
    expect(say?.detail).toBe('npm run test')
  })
  it('본문(React key)은 분이 바뀌어도 그대로다 — 매분 튀어나오는 애니메이션을 다시 돌리지 않는다', () => {
    const s = seat({ heavy: run() })
    expect(seatSpeech(s, NOW + 60_000)?.text).toBe(seatSpeech(s, NOW)?.text)
    expect(seatSpeech(s, NOW + 60_000)?.opener).toBe('🔥 무거운 작업 중 · 4분째')
  })
  it('경과에 따라 한마디가 달아오른다, 1분 전은 "방금 시작", 10분이면 막대가 가득', () => {
    expect(seatSpeech(seat({ heavy: run({ sinceMs: NOW - 20_000 }) }), NOW)?.opener).toBe('🔥 무거운 작업 중 · 방금 시작')
    expect(HEAVY_TIER_LINES.warm).toContain(seatSpeech(seat({ heavy: run({ sinceMs: NOW - 20_000 }) }), NOW)?.sub)
    expect(HEAVY_TIER_LINES.hotter).toContain(seatSpeech(seat({ heavy: run({ sinceMs: NOW - 7 * 60_000 }) }), NOW)?.sub)
    const long = seatSpeech(seat({ heavy: run({ sinceMs: NOW - 25 * 60_000 }) }), NOW)
    expect(HEAVY_TIER_LINES.scream).toContain(long?.sub)
    expect(long?.meter).toBe(1)
  })
  it('잡담을 꺼도 무거운 작업 말풍선은 남고 한마디(sub)만 빠진다', () => {
    const say = seatSpeech(seat({ heavy: run() }), NOW, false)
    expect(say?.kind).toBe('heavy')
    expect(say?.sub).toBeUndefined()
  })
  it('같은 워크트리의 나머지 건수와 도커', () => {
    expect(seatSpeech(seat({ heavy: run({ more: 1, docker: true, label: 'MSSQL 마이그레이션 시험' }) }), NOW)?.text)
      .toBe('MSSQL 마이그레이션 시험 🐳 외 1건')
  })
  it('대기는 파란 말풍선 — 순번과 앞 사람 수', () => {
    const say = seatSpeech(seat({ heavy: run({ state: 'wait', pos: 3 }) }), NOW)
    expect(say?.kind).toBe('heavyWait')
    expect(say?.opener).toBe('⏳ 무거운 작업 순번 대기 · 3번째')
    expect(say?.text).toBe('전체 테스트 · 앞에 2명')
    expect(say?.meter).toBeUndefined()
    expect(seatSpeech(seat({ heavy: run({ state: 'wait', pos: 1 }) }), NOW)?.text).toBe('전체 테스트 · 다음 차례')
  })
  it('무응답·끊김 좌석이어도 claimed 면 보인다 — 긴 게이트 동안 PostToolUse heartbeat 가 없는 바로 그때다', () => {
    expect(seatSpeech(seat({ state: 'OFFLINE', heavy: run() }), NOW)?.kind).toBe('heavy')
  })
})
