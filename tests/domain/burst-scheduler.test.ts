import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBurstScheduler } from '@/lib/domain/burstScheduler'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** 지터를 끈 기본 설정 — 시간 계산만 보는 테스트용. */
const plain = (run: () => void, delayMs = 1000, maxWaitMs = 10_000) =>
  createBurstScheduler(run, { delayMs, maxWaitMs, jitterMs: 0 })

describe('createBurstScheduler — 디바운스', () => {
  it('신호 1건은 delayMs 뒤에 한 번 실행된다', () => {
    const run = vi.fn()
    plain(run).signal()

    vi.advanceTimersByTime(999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('연속 신호를 1회로 합친다', () => {
    const run = vi.fn()
    const s = plain(run)

    // 5건을 200ms 간격으로 — 한 사람이 단계를 연달아 바꾸는 상황.
    for (let i = 0; i < 5; i++) { s.signal(); vi.advanceTimersByTime(200) }
    expect(run).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('실행 뒤의 신호는 새 주기로 다시 예약된다', () => {
    const run = vi.fn()
    const s = plain(run)

    s.signal()
    vi.advanceTimersByTime(1000)
    expect(run).toHaveBeenCalledTimes(1)

    s.signal()
    vi.advanceTimersByTime(1000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cancel 하면 예약된 실행이 사라진다', () => {
    const run = vi.fn()
    const s = plain(run)

    s.signal()
    s.cancel()
    vi.advanceTimersByTime(60_000)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('createBurstScheduler — maxWait 상한', () => {
  it('신호가 끊이지 않아도 maxWaitMs 안에 한 번은 실행된다', () => {
    const run = vi.fn()
    // delay(1s)보다 짧은 간격으로 계속 신호가 오면 디바운스만으로는 영영 실행되지 않는다.
    const s = plain(run, 1000, 5000)

    for (let i = 0; i < 20; i++) { s.signal(); vi.advanceTimersByTime(500) } // 10초 동안 끊임없이
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('첫 신호로부터 maxWaitMs 시점에 실행된다', () => {
    const run = vi.fn()
    const s = plain(run, 1000, 5000)

    // 500ms 간격 신호 — 디바운스는 계속 밀리고 상한이 걸린다.
    for (let i = 0; i < 9; i++) { s.signal(); vi.advanceTimersByTime(500) } // t=0..4000
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500) // t=5000
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('delayMs 와 maxWaitMs 가 같으면 상한이 항상 이긴다 — 후행 throttle 이 된다', () => {
    const run = vi.fn()
    const s = plain(run, 10_000, 10_000)

    s.signal()                      // t=0 → 10_000 예약
    vi.advanceTimersByTime(9_000)
    s.signal()                      // t=9_000 — 뒤로 밀리지 않아야 한다
    vi.advanceTimersByTime(1_000)   // t=10_000
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('createBurstScheduler — 지터', () => {
  it('실행 시각에 [0, jitterMs] 의 무작위 지연을 더한다', () => {
    const run = vi.fn()
    const s = createBurstScheduler(run, {
      delayMs: 10_000, maxWaitMs: 10_000, jitterMs: 10_000, random: () => 0.5,
    })

    s.signal()
    vi.advanceTimersByTime(14_999) // 10_000 + 5_000 직전
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('random 이 0 이면 지터가 붙지 않는다', () => {
    const run = vi.fn()
    const s = createBurstScheduler(run, {
      delayMs: 1000, maxWaitMs: 1000, jitterMs: 10_000, random: () => 0,
    })

    s.signal()
    vi.advanceTimersByTime(1000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('지터는 버스트마다 한 번만 뽑는다 — 같은 버스트 안에서 흔들리지 않는다', () => {
    const run = vi.fn()
    const random = vi.fn(() => 0.5)
    const s = createBurstScheduler(run, {
      delayMs: 1000, maxWaitMs: 30_000, jitterMs: 1000, random,
    })

    s.signal(); vi.advanceTimersByTime(100)
    s.signal(); vi.advanceTimersByTime(100)
    s.signal()
    expect(random).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1500) // delay 1000 + jitter 500
    expect(run).toHaveBeenCalledTimes(1)

    s.signal() // 새 버스트 — 다시 뽑는다
    expect(random).toHaveBeenCalledTimes(2)
  })

  it('지터가 상한을 넘겨 실행을 무한정 미루지 않는다', () => {
    const run = vi.fn()
    const s = createBurstScheduler(run, {
      delayMs: 10_000, maxWaitMs: 10_000, jitterMs: 10_000, random: () => 1,
    })

    // 최악의 지터(=jitterMs)여도 maxWaitMs + jitterMs 안에는 실행돼야 한다.
    for (let i = 0; i < 40; i++) { s.signal(); vi.advanceTimersByTime(1000) } // 40초 동안 계속
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})
