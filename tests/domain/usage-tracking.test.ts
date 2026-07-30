import { describe, expect, it } from 'vitest'
import { trackingEnabled } from '@/lib/domain/usageTracking'

describe('trackingEnabled — 로컬 dev 가 프로덕션 DB 를 공유하므로 기본은 프로덕션만', () => {
  it('기본값: 프로덕션에서만 수집한다', () => {
    expect(trackingEnabled({ VERCEL_ENV: 'production' })).toBe(true)
  })

  it.each([
    ['preview', { VERCEL_ENV: 'preview' }],
    ['development', { VERCEL_ENV: 'development' }],
    ['미설정(로컬)', {}],
  ])('%s 에서는 수집하지 않는다', (_name, env) => {
    expect(trackingEnabled(env)).toBe(false)
  })

  it('USAGE_TRACKING=on 이면 로컬에서도 수집한다(명시적 opt-in)', () => {
    expect(trackingEnabled({ USAGE_TRACKING: 'on' })).toBe(true)
  })

  it('USAGE_TRACKING=off 는 프로덕션도 끈다(긴급 차단이 최우선)', () => {
    expect(trackingEnabled({ USAGE_TRACKING: 'off', VERCEL_ENV: 'production' })).toBe(false)
  })

  it('알 수 없는 값은 무시하고 기본 규칙으로 떨어진다', () => {
    expect(trackingEnabled({ USAGE_TRACKING: 'maybe', VERCEL_ENV: 'production' })).toBe(true)
    expect(trackingEnabled({ USAGE_TRACKING: 'maybe' })).toBe(false)
  })
})
