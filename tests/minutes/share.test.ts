import { describe, expect, it } from 'vitest'
import { isShareToken, nextShareState } from '@/lib/minutes/share'

const T1 = '3f2b8c1e-9a4d-4e7b-8c2f-1d5e6a7b8c9d'
const T2 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

describe('isShareToken', () => {
  it('UUID v4 형식만 통과', () => {
    expect(isShareToken(T1)).toBe(true)
    expect(isShareToken('abc')).toBe(false)
    expect(isShareToken('')).toBe(false)
    expect(isShareToken(`${T1}'; drop table minutes;--`)).toBe(false)
  })
})

describe('nextShareState', () => {
  it('enable: 토큰 없으면 새 토큰 발급', () => {
    expect(nextShareState({ token: null, enabled: false }, 'enable', T2))
      .toEqual({ token: T2, enabled: true })
  })
  it('enable: 기존 토큰 보존(disable 후 재개 시 동일 링크)', () => {
    expect(nextShareState({ token: T1, enabled: false }, 'enable', T2))
      .toEqual({ token: T1, enabled: true })
  })
  it('disable: 끄되 토큰 보존', () => {
    expect(nextShareState({ token: T1, enabled: true }, 'disable', T2))
      .toEqual({ token: T1, enabled: false })
  })
  it('regenerate: 토큰 교체 + enabled 유지', () => {
    expect(nextShareState({ token: T1, enabled: true }, 'regenerate', T2))
      .toEqual({ token: T2, enabled: true })
  })
})
