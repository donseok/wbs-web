import { describe, it, expect } from 'vitest'
import {
  MINUTE_FS_DEFAULT, MINUTE_FS_MAX, MINUTE_FS_MIN,
  clampMinuteFontSize, stepMinuteFontSize,
} from '@/lib/minutes/fontSize'

describe('clampMinuteFontSize', () => {
  it('범위 안 정수는 그대로', () => {
    expect(clampMinuteFontSize(MINUTE_FS_MIN)).toBe(MINUTE_FS_MIN)
    expect(clampMinuteFontSize(20)).toBe(20)
    expect(clampMinuteFontSize(MINUTE_FS_MAX)).toBe(MINUTE_FS_MAX)
  })

  it('범위 밖은 경계로 수렴', () => {
    expect(clampMinuteFontSize(0)).toBe(MINUTE_FS_MIN)
    expect(clampMinuteFontSize(-40)).toBe(MINUTE_FS_MIN)
    expect(clampMinuteFontSize(999)).toBe(MINUTE_FS_MAX)
  })

  it('소수는 반올림 후 clamp', () => {
    expect(clampMinuteFontSize(13.7)).toBe(14)
    expect(clampMinuteFontSize(11.4)).toBe(MINUTE_FS_MIN)
    expect(clampMinuteFontSize(28.6)).toBe(MINUTE_FS_MAX)
  })

  it('숫자가 아니거나 유한하지 않으면 기본값 — 오염된 서버 prefs/localStorage 흡수', () => {
    for (const bad of [undefined, null, '14', '', {}, [], true, Number.NaN, Infinity, -Infinity]) {
      expect(clampMinuteFontSize(bad)).toBe(MINUTE_FS_DEFAULT)
    }
  })
})

describe('stepMinuteFontSize', () => {
  it('한 단계씩 이동', () => {
    expect(stepMinuteFontSize(14, 1)).toBe(15)
    expect(stepMinuteFontSize(14, -1)).toBe(13)
  })

  it('경계에서 멈춘다', () => {
    expect(stepMinuteFontSize(MINUTE_FS_MAX, 1)).toBe(MINUTE_FS_MAX)
    expect(stepMinuteFontSize(MINUTE_FS_MIN, -1)).toBe(MINUTE_FS_MIN)
  })

  it('오염된 현재값도 기본값 기준으로 계산', () => {
    expect(stepMinuteFontSize('junk', 1)).toBe(MINUTE_FS_DEFAULT + 1)
    expect(stepMinuteFontSize(999, -1)).toBe(MINUTE_FS_MAX - 1)
  })

  it('증감 왕복은 제자리 — 경계에 닿지 않는 구간', () => {
    let v: number = MINUTE_FS_DEFAULT
    for (let i = 0; i < 3; i++) v = stepMinuteFontSize(v, 1)
    for (let i = 0; i < 3; i++) v = stepMinuteFontSize(v, -1)
    expect(v).toBe(MINUTE_FS_DEFAULT)
  })
})
