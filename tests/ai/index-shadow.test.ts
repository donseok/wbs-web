import { describe, expect, it, vi } from 'vitest'
import { compareShadowSearch, runShadowSearch } from '@/lib/ai/index/shadow'

describe('compareShadowSearch', () => {
  it('returns full overlap for identical rankings and for two empty results', () => {
    expect(compareShadowSearch({
      legacyResults: ['a', 'b', 'c'],
      nextResults: ['a', 'b', 'c'],
    })).toEqual({ overlap10: 1, legacyOnly: [], nextOnly: [] })

    expect(compareShadowSearch({ legacyResults: [], nextResults: [] }))
      .toEqual({ overlap10: 1, legacyOnly: [], nextOnly: [] })
  })

  it('computes a partial overlap with the exclusive keys on each side', () => {
    const comparison = compareShadowSearch({
      legacyResults: ['a', 'b', 'c'],
      nextResults: ['b', 'c', 'd'],
    })
    expect(comparison.overlap10).toBeCloseTo(2 / 3)
    expect(comparison.legacyOnly).toEqual(['a'])
    expect(comparison.nextOnly).toEqual(['d'])
  })

  it('reports zero overlap for disjoint results', () => {
    expect(compareShadowSearch({
      legacyResults: ['a'],
      nextResults: ['z'],
    })).toEqual({ overlap10: 0, legacyOnly: ['a'], nextOnly: ['z'] })
  })

  it('compares only the top 10 unique keys of each side', () => {
    const legacy = Array.from({ length: 30 }, (_, index) => `k${index}`)
    const next = [...Array.from({ length: 10 }, (_, index) => `k${index}`), 'ignored-beyond-top10']
    const comparison = compareShadowSearch({ legacyResults: legacy, nextResults: next })
    expect(comparison.overlap10).toBe(1)
    expect(comparison.legacyOnly).toEqual([])
    expect(comparison.nextOnly).toEqual([])

    const deduped = compareShadowSearch({
      legacyResults: ['a', 'a', 'b', ' '],
      nextResults: ['a', 'b'],
    })
    expect(deduped.overlap10).toBe(1)
  })
})

describe('runShadowSearch', () => {
  it('logs the comparison without touching the answer path result', async () => {
    const log = vi.fn()
    const comparison = await runShadowSearch({
      label: 'wbs-search',
      runLegacy: async () => ['a', 'b'],
      runNext: async () => ['b', 'c'],
      log,
      now: (() => {
        let tick = 0
        return () => (tick += 5)
      })(),
    })
    expect(comparison).toMatchObject({ overlap10: 0.5 })
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      label: 'wbs-search',
      overlap10: 0.5,
      legacyCount: 2,
      nextCount: 2,
    }))
  })

  it('swallows any side failure and returns null instead of throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runShadowSearch({
      label: 'wbs-search',
      runLegacy: async () => {
        throw new Error('legacy 검색 실패')
      },
      runNext: async () => ['a'],
    })).resolves.toBeNull()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
