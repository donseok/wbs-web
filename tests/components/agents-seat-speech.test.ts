// tests/components/agents-seat-speech.test.ts
// 잡담 켬/끔(2026-09-18) — 끄면 팀원 한마디가 사라지고, 보고 말풍선(업무)은 남는다.
import { describe, it, expect } from 'vitest'
import type { Seat } from '@/lib/domain/seatmap'
import { seatSpeech } from '@/components/agents/SeatSpeech'
import { ROTATE_MS } from '@/lib/domain/officeChatter'

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
  it('끔이어도 막 올린 보고는 업무라 그대로 뜬다', () => {
    const s = seat({ lastReport: { kind: 'completion', summary: '로그인 화면 완료', at: new Date(NOW - 30_000).toISOString() } } as Partial<Seat>)
    const say = seatSpeech(s, NOW, false)
    expect(say?.kind).toBe('done')
    expect(say?.text).toBe('로그인 화면 완료')
  })
})
