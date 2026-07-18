import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEnsureGate } from '@/lib/ai/ensure'

const LABEL = '[test] ensure 실패(무시):'
const makeGate = (cooldownMs = 60_000) => createEnsureGate({ cooldownMs, logLabel: LABEL })

describe('createEnsureGate — 쿨다운 + in-flight dedupe + never-throw', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('이미 신선하면 generate 호출 없이 ready', async () => {
    const generate = vi.fn(async () => {})
    const gate = makeGate()
    expect(await gate('k', { fresh: async () => true, generate })).toBe('ready')
    expect(generate).not.toHaveBeenCalled()
  })

  it('stale → 생성 후 신선해지면 generated', async () => {
    let stored = false
    const generate = vi.fn(async () => { stored = true })
    const gate = makeGate()
    expect(await gate('k', { fresh: async () => stored, generate })).toBe('generated')
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('생성해도 신선해지지 않으면(행 미기록 = LLM 실패 신호) unavailable', async () => {
    const gate = makeGate()
    expect(await gate('k', { fresh: async () => false, generate: vi.fn(async () => {}) })).toBe('unavailable')
  })

  it('쿨다운 이내 재시도는 generate 재호출 없이 unavailable, 경과 후엔 재시도', async () => {
    vi.useFakeTimers()
    const generate = vi.fn(async () => {})
    const fresh = vi.fn(async () => false)
    const gate = makeGate(60_000)

    expect(await gate('k', { fresh, generate })).toBe('unavailable')
    expect(generate).toHaveBeenCalledTimes(1)
    // 쿨다운 이내 — 시도 차단(무료 쿼터 보호 하한)
    expect(await gate('k', { fresh, generate })).toBe('unavailable')
    expect(generate).toHaveBeenCalledTimes(1)
    // 쿨다운 경과 — 재시도 허용
    vi.advanceTimersByTime(60_000)
    expect(await gate('k', { fresh, generate })).toBe('unavailable')
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('쿨다운은 키 단위 — 다른 키는 차단하지 않는다', async () => {
    const generate = vi.fn(async () => {})
    const fresh = vi.fn(async () => false)
    const gate = makeGate(60_000)
    await gate('a', { fresh, generate })
    await gate('b', { fresh, generate })
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('동시 호출은 하나의 generate 를 공유한다 (in-flight dedupe)', async () => {
    let stored = false
    let release!: () => void
    const generate = vi.fn(() => new Promise<void>(res => { release = res }))
    const fresh = vi.fn(async () => stored)
    const gate = makeGate()

    const p1 = gate('k', { fresh, generate })
    const p2 = gate('k', { fresh, generate })
    // 두 호출 모두 fresh 체크를 지나 게이트 본문에 진입할 시간을 준다
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    stored = true
    release()
    expect(await p1).toBe('generated')
    expect(await p2).toBe('generated') // 대기측도 완료 후 재판정으로 같은 결과
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('generate 가 reject 해도 throw 하지 않고 unavailable + 로그, in-flight 정리로 다음 시도 가능', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const generate = vi.fn(async () => { throw new Error('llm down') })
    const gate = makeGate(0) // 쿨다운 0 — 실패 직후 재시도 허용을 확인
    expect(await gate('k', { fresh: async () => false, generate })).toBe('unavailable')
    expect(errSpy).toHaveBeenCalledWith(LABEL, 'llm down')
    expect(await gate('k', { fresh: async () => false, generate })).toBe('unavailable')
    expect(generate).toHaveBeenCalledTimes(2) // in-flight 가 정리돼 재시도됨
  })

  it('fresh 가 throw 해도 unavailable + 로그 (never-throw 계약)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const gate = makeGate()
    const generate = vi.fn(async () => {})
    await expect(
      gate('k', { fresh: async () => { throw new Error('db boom') }, generate }),
    ).resolves.toBe('unavailable')
    expect(errSpy).toHaveBeenCalledWith(LABEL, 'db boom')
    expect(generate).not.toHaveBeenCalled()
  })
})
