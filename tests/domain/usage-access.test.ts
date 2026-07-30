import { describe, expect, it } from 'vitest'
import { canViewUsage } from '@/lib/authz/usageAccess'
import { DICT } from '@/lib/i18n/dict'

describe('canViewUsage — 지금은 전원 공개(요구사항)', () => {
  it.each([
    ['pmo_admin', { role: 'pmo_admin', teamCode: 'PMO', teamId: 't1' }],
    ['team_editor', { role: 'team_editor', teamCode: 'ERP', teamId: 't2' }],
  ])('%s 는 볼 수 있다', (_n, m) => {
    expect(canViewUsage(m as never)).toBe(true)
  })

  it('멤버십이 없어도(조회 실패 포함) 볼 수 있다 — 이 단계의 명시적 결정', () => {
    expect(canViewUsage(null)).toBe(true)
  })
})

describe('nav.usage 사전 키', () => {
  it('ko/en 양쪽에 있다', () => {
    expect(DICT.ko['nav.usage']).toBe('사용 현황')
    expect(DICT.en['nav.usage']).toBe('Usage')
  })
})
