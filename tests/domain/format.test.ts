import { describe, it, expect } from 'vitest'
import { weightToPct, formatWeightPct } from '@/lib/domain/format'

describe('weightToPct — 가중치 1기준 → 100% 기준 환산(표시용)', () => {
  it('엑셀 수식 유래 무한소수를 %로 환산해 2자리로 줄인다', () => {
    expect(weightToPct(0.045454545454545456)).toBe(4.55)
    expect(weightToPct(0.007575757575757576)).toBe(0.76)
    expect(weightToPct(0.022727272727272728)).toBe(2.27)
    expect(weightToPct(0.2848484848484848)).toBe(28.48)
  })

  it('짧은 값·경계값은 깔끔한 %가 된다', () => {
    expect(weightToPct(0.1)).toBe(10)
    expect(weightToPct(1)).toBe(100)
    expect(weightToPct(0)).toBe(0)
  })

  it('1 초과 상대 가중치도 그대로 환산한다(임포트 계약은 상한 없음)', () => {
    expect(weightToPct(2)).toBe(200)
  })
})

describe('formatWeightPct — % 접미 문자열', () => {
  it('환산값에 %를 붙인다', () => {
    expect(formatWeightPct(0.045454545454545456)).toBe('4.55%')
    expect(formatWeightPct(0.1)).toBe('10%')
    expect(formatWeightPct(0)).toBe('0%')
  })
})
