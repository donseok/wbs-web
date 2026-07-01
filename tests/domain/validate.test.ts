import { describe, it, expect } from 'vitest'
import { isValidEmail } from '@/lib/domain/validate'

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
