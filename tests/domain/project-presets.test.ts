import { describe, expect, it } from 'vitest'
import { PRESETS } from '@/lib/domain/projectPresets'

describe('프로젝트 프리셋 (스펙 §8)', () => {
  it('pi 프리셋 = D-CUBE 현행 재현', () => {
    expect(PRESETS.pi.levelLabels).toEqual(['Phase', 'Task', 'Activity'])
    expect(PRESETS.pi.maxDepth).toBe(3)
    expect(PRESETS.pi.extraAxisLabel).toBe('Biz')
    expect(PRESETS.pi.milestoneKeywords.length).toBeGreaterThan(0)
  })
  it('키워드는 전부 소문자(§7.4 — isMilestoneLeaf 가 lowercase 비교)', () => {
    for (const p of Object.values(PRESETS))
      for (const k of p.milestoneKeywords) expect(k).toBe(k.toLowerCase())
  })
  it('빈 키워드 프리셋 금지(§7.4 — 마일스톤 카드 무증상 소실)', () => {
    for (const p of Object.values(PRESETS)) expect(p.milestoneKeywords.length).toBeGreaterThan(0)
  })
})
