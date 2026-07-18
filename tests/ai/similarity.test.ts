import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveMinSimilarity, passesSimilarity, DEFAULT_MIN_SIMILARITY, MIN_SIMILARITY } from '@/lib/ai/similarity'

describe('resolveMinSimilarity — DKBOT_MIN_SIMILARITY 해석 규칙', () => {
  it('미설정(undefined)이면 기본값 0.35', () => {
    expect(resolveMinSimilarity(undefined)).toBe(DEFAULT_MIN_SIMILARITY)
    expect(DEFAULT_MIN_SIMILARITY).toBe(0.35)
  })

  it('0~1 범위의 유한값은 그대로 적용 (경계 0·1 포함)', () => {
    expect(resolveMinSimilarity('0.55')).toBe(0.55)
    expect(resolveMinSimilarity('0')).toBe(0)
    expect(resolveMinSimilarity('1')).toBe(1)
  })

  it('범위 밖·비수치는 기본값으로 폴백', () => {
    expect(resolveMinSimilarity('1.5')).toBe(DEFAULT_MIN_SIMILARITY)
    expect(resolveMinSimilarity('-0.1')).toBe(DEFAULT_MIN_SIMILARITY)
    expect(resolveMinSimilarity('abc')).toBe(DEFAULT_MIN_SIMILARITY)
    expect(resolveMinSimilarity('NaN')).toBe(DEFAULT_MIN_SIMILARITY)
    expect(resolveMinSimilarity('Infinity')).toBe(DEFAULT_MIN_SIMILARITY)
  })

  it('빈 문자열은 Number("")===0 이라 0(컷오프 해제)이 된다 — 추출 전 원본과 동일한 기존 동작 고정', () => {
    expect(resolveMinSimilarity('')).toBe(0)
  })
})

describe('passesSimilarity — 컷오프 술어', () => {
  // 테스트 환경은 DKBOT_MIN_SIMILARITY 미설정 → 기본 0.35 기준
  it('임계값 이상은 통과(경계 포함), 미만은 컷', () => {
    expect(MIN_SIMILARITY).toBe(DEFAULT_MIN_SIMILARITY)
    expect(passesSimilarity(0.35)).toBe(true)
    expect(passesSimilarity(0.71)).toBe(true)
    expect(passesSimilarity(0.349)).toBe(false)
    expect(passesSimilarity(0.21)).toBe(false)
  })
})

describe('MIN_SIMILARITY — 모듈 로드 시 env 1회 해석 (소비처 기존 관례)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('DKBOT_MIN_SIMILARITY 설정 시 그 값으로 로드된다', async () => {
    vi.stubEnv('DKBOT_MIN_SIMILARITY', '0.6')
    vi.resetModules()
    const mod = await import('@/lib/ai/similarity')
    expect(mod.MIN_SIMILARITY).toBe(0.6)
    expect(mod.passesSimilarity(0.59)).toBe(false)
    expect(mod.passesSimilarity(0.6)).toBe(true)
  })
})
