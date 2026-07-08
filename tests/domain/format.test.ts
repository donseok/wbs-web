import { describe, it, expect } from 'vitest'
import { roundWeight } from '@/lib/domain/format'

describe('roundWeight — 가중치 표시 반올림 (0~100 스케일)', () => {
  it('엑셀 수식 유래 무한소수를 2자리로 줄인다', () => {
    // 0~1 스케일의 0.045454… 는 100 스케일에서 4.545454…
    expect(roundWeight(4.545454545454546)).toBe(4.55)
    expect(roundWeight(0.7575757575757576)).toBe(0.76)
    expect(roundWeight(2.2727272727272728)).toBe(2.27)
  })

  it('짧은 값·정수는 그대로 유지한다', () => {
    expect(roundWeight(10)).toBe(10)
    expect(roundWeight(4.5)).toBe(4.5)
    expect(roundWeight(100)).toBe(100)
    expect(roundWeight(0)).toBe(0)
  })
})
