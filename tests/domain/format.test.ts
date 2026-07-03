import { describe, it, expect } from 'vitest'
import { roundWeight } from '@/lib/domain/format'

describe('roundWeight — 가중치 표시 반올림', () => {
  it('엑셀 수식 유래 무한소수를 4자리로 줄인다', () => {
    expect(roundWeight(0.045454545454545456)).toBe(0.0455)
    expect(roundWeight(0.007575757575757576)).toBe(0.0076)
    expect(roundWeight(0.022727272727272728)).toBe(0.0227)
  })

  it('짧은 값·정수는 그대로 유지한다', () => {
    expect(roundWeight(0.1)).toBe(0.1)
    expect(roundWeight(3)).toBe(3)
    expect(roundWeight(0)).toBe(0)
  })
})
