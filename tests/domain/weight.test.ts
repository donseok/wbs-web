import { describe, it, expect } from 'vitest'
import { WEIGHT_TOTAL, effectiveWeights, isValidWeight, totalWeight } from '@/lib/domain/weight'

const w = (...ws: (number | null)[]) => ws.map(weight => ({ weight }))

describe('effectiveWeights — 형제 그룹의 유효 가중치', () => {
  it('전부 null이면 균등(각 1)', () => {
    expect(effectiveWeights(w(null, null, null))).toEqual([1, 1, 1])
  })

  it('전부 명시되면 그대로 통과', () => {
    expect(effectiveWeights(w(50, 30, 20))).toEqual([50, 30, 20])
  })

  it('섞이면 null은 명시값의 평균을 받는다 — 스케일 불변', () => {
    // 명시값 평균 = (40+20)/2 = 30
    expect(effectiveWeights(w(40, null, 20))).toEqual([40, 30, 20])
    // ×100 해도 같은 비율 → 롤업 결과 불변
    expect(effectiveWeights(w(4000, null, 2000))).toEqual([4000, 3000, 2000])
  })

  it('구(舊) null→1 정책과 달리, 스케일을 바꿔도 비율이 유지된다', () => {
    const small = effectiveWeights(w(0.5, 0.5, null))
    const big = effectiveWeights(w(50, 50, null))
    const ratio = (xs: number[]) => xs.map(x => x / xs.reduce((a, b) => a + b, 0))
    expect(ratio(small)).toEqual(ratio(big))
  })

  it('빈 배열은 빈 배열', () => {
    expect(effectiveWeights([])).toEqual([])
  })

  it('명시값이 전부 0이어도 평균 0을 쓴다 (NaN 금지)', () => {
    expect(effectiveWeights(w(0, null))).toEqual([0, 0])
  })
})

describe('isValidWeight — 0~100 범위', () => {
  it('0과 100은 경계 포함', () => {
    expect(isValidWeight(0)).toBe(true)
    expect(isValidWeight(100)).toBe(true)
  })
  it('소수 허용', () => {
    expect(isValidWeight(4.55)).toBe(true)
  })
  it('음수·100 초과·NaN·Infinity 거부', () => {
    expect(isValidWeight(-0.1)).toBe(false)
    expect(isValidWeight(100.01)).toBe(false)
    expect(isValidWeight(NaN)).toBe(false)
    expect(isValidWeight(Infinity)).toBe(false)
  })
  it('null은 "형제 균등" 이므로 유효', () => {
    expect(isValidWeight(null)).toBe(true)
  })
})

describe('totalWeight — 전역 합', () => {
  it('null은 건너뛰고 합산', () => {
    expect(totalWeight(w(50, null, 30))).toBe(80)
  })
  it('100 스케일에서 전체 합은 WEIGHT_TOTAL', () => {
    expect(totalWeight(w(45.45, 22.73, 31.82))).toBeCloseTo(WEIGHT_TOTAL, 2)
  })
})
