import { describe, it, expect } from 'vitest'
import { weightToPct, formatWeightPct, round1, formatPct1, formatPp1 } from '@/lib/domain/format'

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

describe('round1 — 공정율 정밀도 단일 기준(소수 1자리)', () => {
  it('소수 1자리 반올림', () => {
    expect(round1(33.333)).toBe(33.3)
    expect(round1(66.666)).toBe(66.7)
    expect(round1(50)).toBe(50)
  })
  it('경계값은 정확히 보존(done/시작 전 판정 안전)', () => {
    expect(round1(99.99999999999999)).toBe(100)
    expect(round1(0.04)).toBe(0)
  })
  it('편차 뺄셈의 FP 노이즈를 정규화(progressSignal -2/-10 경계 보호)', () => {
    expect(round1(6.3 - 8.3)).toBe(-2) // 원시값은 -2.000000000000001
  })
})

describe('formatPct1 — 대시보드 % 표기(소수 1자리 고정)', () => {
  it('항상 소수 1자리 문자열', () => {
    expect(formatPct1(66.7)).toBe('66.7')
    expect(formatPct1(67)).toBe('67.0')
    expect(formatPct1(100)).toBe('100.0')
  })
})

describe('formatPp1 — 편차 %p 표기(부호 포함 소수 1자리)', () => {
  it('부호 포함 소수 1자리', () => {
    expect(formatPp1(1.55)).toBe('+1.6')
    expect(formatPp1(-2.34)).toBe('-2.3')
    expect(formatPp1(0)).toBe('+0.0')
  })
  it('-0.0 표기가 나오지 않는다', () => {
    expect(formatPp1(-0.04)).toBe('+0.0')
    expect(formatPp1(-1e-15)).toBe('+0.0')
  })
})
