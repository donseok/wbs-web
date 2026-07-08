import { describe, it, expect } from 'vitest'
import { isValidEmail, isValidDate, isValidDateRange } from '@/lib/domain/validate'

describe('isValidEmail', () => {
  it('정상 이메일은 true', () => {
    expect(isValidEmail('name@company.com')).toBe(true)
    expect(isValidEmail('a.b-c@sub.example.co.kr')).toBe(true)
    expect(isValidEmail('  trim@me.com  ')).toBe(true) // 앞뒤 공백 허용(trim)
  })
  it('@ 없거나 도메인 형태가 아니면 false', () => {
    expect(isValidEmail('invalid-email-format')).toBe(false) // 리포트 재현 케이스
    expect(isValidEmail('no-at.com')).toBe(false)
    expect(isValidEmail('no@dot')).toBe(false)
    expect(isValidEmail('a b@c.com')).toBe(false) // 내부 공백
    expect(isValidEmail('@no-local.com')).toBe(false)
  })
  it('빈 문자열/공백은 false', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('   ')).toBe(false)
  })
})

describe('isValidDate', () => {
  it('실재하는 날짜는 true', () => {
    expect(isValidDate('2026-07-08')).toBe(true)
  })
  it('달력에 없는 날짜는 false', () => {
    expect(isValidDate('2026-02-30')).toBe(false) // isValidDateRange 는 못 잡는 케이스
  })
  it('YYYY-MM-DD 형식이 아니면 false', () => {
    expect(isValidDate('2026-7-8')).toBe(false)
    expect(isValidDate('not-a-date')).toBe(false)
    expect(isValidDate('')).toBe(false)
  })
})

describe('isValidDateRange', () => {
  it('정상 범위(시작 < 종료)는 true', () => {
    expect(isValidDateRange('2026-01-01', '2026-12-31')).toBe(true)
    expect(isValidDateRange('2025-12-31', '2026-01-01')).toBe(true) // 연도 경계
  })
  it('역전(종료 < 시작)은 false', () => {
    expect(isValidDateRange('2026-12-31', '2026-01-01')).toBe(false) // 리포트 재현 케이스
    expect(isValidDateRange('2026-07-02', '2026-07-01')).toBe(false)
  })
  it('시작 = 종료(하루짜리 프로젝트)는 true', () => {
    expect(isValidDateRange('2026-07-02', '2026-07-02')).toBe(true)
  })
  it('한쪽이라도 미입력(null/빈문자열)이면 true', () => {
    expect(isValidDateRange(null, '2026-01-01')).toBe(true)
    expect(isValidDateRange('2026-01-01', null)).toBe(true)
    expect(isValidDateRange(null, null)).toBe(true)
    expect(isValidDateRange('', '2026-01-01')).toBe(true)
    expect(isValidDateRange('2026-01-01', '')).toBe(true)
  })
  it('YYYY-MM-DD 형식이 아니면 false', () => {
    expect(isValidDateRange('2026/01/01', '2026-12-31')).toBe(false)
    expect(isValidDateRange('2026-01-01', '20261231')).toBe(false)
    expect(isValidDateRange('2026-1-1', '2026-12-31')).toBe(false)
    expect(isValidDateRange('not-a-date', 'also-nope')).toBe(false)
  })
})
