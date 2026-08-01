import { describe, expect, it } from 'vitest'
import { canAddChild, canSplit } from '@/lib/domain/wbsAffordance'

describe('wbsAffordance (§4.4 depth 기반)', () => {
  it('자식 추가 = depth+1 < maxDepth (무제한이면 항상)', () => {
    expect(canAddChild(0, 3)).toBe(true)   // depth 0 → 자식 depth 1 < 3 ✓
    expect(canAddChild(1, 3)).toBe(true)
    expect(canAddChild(2, 3)).toBe(false)  // depth 2 자식은 3 → 3<3 거짓 (D-CUBE ACT 아래 불가 = 현행)
    expect(canAddChild(2, null)).toBe(true) // 무제한
  })
  it('sub-act 분리 = 리프이고 자기 자신이 sub-act 아님', () => {
    expect(canSplit(false, false)).toBe(true)
    expect(canSplit(true, false)).toBe(false)   // 이미 sub-act
    expect(canSplit(false, true)).toBe(false)   // 자식 있음
  })
})
