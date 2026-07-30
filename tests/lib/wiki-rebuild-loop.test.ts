import { describe, it, expect } from 'vitest'

// 러너의 정지 정책만 따로 검사한다. 러너 파일 자체를 import 하면 프로덕션에 대고
// 즉시 실행되므로 정책을 별도 모듈로 떼어냈다.
//
// 왜 테스트가 필요한가: 원래 러너는 `attempted === 0` 이면 즉시 break 했다. 그런데
// finish RPC 는 스텝이 전진하지 못하면 run_after 를 +15초로 미루므로, 정상 백오프
// 한 번이 곧 종료였다. 2026-07-30 재구축 복구에서 러너가 회의록 42건 중 6건만 처리하고
// 끝난 원인이 이것이다.
import {
  IDLE_LIMIT,
  ROUND_CAP,
  nextRebuildLoopState,
} from '../../scripts/lib/rebuild-loop.mjs'

interface LoopState {
  round: number
  idle: number
  stop?: boolean
  reason?: string | null
  waitMs?: number
}

const start: LoopState = { round: 0, idle: 0 }

describe('nextRebuildLoopState', () => {
  it('전진한 라운드는 계속하고 idle 을 0으로 되돌린다', () => {
    const s = nextRebuildLoopState({ round: 3, idle: 2 }, { attempted: 2 })
    expect(s.stop).toBe(false)
    expect(s.idle).toBe(0)
    expect(s.round).toBe(4)
    expect(s.waitMs).toBe(0)
  })

  it('idle 라운드 한 번으로는 멈추지 않고 백오프를 기다린다', () => {
    const s = nextRebuildLoopState(start, { attempted: 0 })
    expect(s.stop).toBe(false)
    expect(s.idle).toBe(1)
    expect(s.waitMs).toBeGreaterThan(15_000)
  })

  it(`idle 이 ${IDLE_LIMIT}회 연속이면 남은 작업이 없다고 보고 멈춘다`, () => {
    let s: LoopState = start
    for (let i = 0; i < IDLE_LIMIT; i += 1) {
      expect(s.stop ?? false).toBe(false)
      s = nextRebuildLoopState(s, { attempted: 0 })
    }
    expect(s.stop).toBe(true)
    expect(s.reason).toBe('drained')
  })

  it('전진이 끼면 idle 카운터가 리셋돼 조기 종료하지 않는다', () => {
    let s = nextRebuildLoopState(start, { attempted: 0 })
    s = nextRebuildLoopState(s, { attempted: 0 })
    s = nextRebuildLoopState(s, { attempted: 3 })
    expect(s.stop).toBe(false)
    expect(s.idle).toBe(0)
  })

  it('라운드 상한에 닿으면 멈추되 이유를 drained 와 구분한다', () => {
    const s = nextRebuildLoopState({ round: ROUND_CAP - 1, idle: 0 }, { attempted: 2 })
    expect(s.stop).toBe(true)
    expect(s.reason).toBe('round-cap')
  })

  it('상한은 회의록 42건을 한 번에 덮을 만큼 넉넉하다', () => {
    expect(ROUND_CAP).toBeGreaterThanOrEqual(30)
  })
})
