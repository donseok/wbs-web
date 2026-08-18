import { describe, expect, it } from 'vitest'
import { canViewUsage } from '@/lib/authz/usageAccess'
import type { Actor } from '@/lib/domain/authz'
import { KO } from '@/lib/i18n/dict/ko'
import { EN } from '@/lib/i18n/dict/en'

const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map(), rosterTeams: new Map(), ...over,
})

describe('canViewUsage — 슈퍼유저 전용(2026-07-30 사용자 결정)', () => {
  it('슈퍼유저는 볼 수 있다', () => {
    expect(canViewUsage(actor({ isSuperuser: true }))).toBe(true)
  })
  it('프로젝트 관리자·멤버는 볼 수 없다 — 전 직원 행동 데이터라 관리자에게도 열지 않는다', () => {
    expect(canViewUsage(actor({ projectRoles: new Map([['p1', 'admin' as const]]) }))).toBe(false)
    expect(canViewUsage(actor({ projectRoles: new Map([['p1', 'member' as const]]) }))).toBe(false)
  })
  it('비로그인·조회 실패(null)는 볼 수 없다 — fail-closed', () => {
    expect(canViewUsage(null)).toBe(false)
  })
})

describe('nav.usage 사전 키', () => {
  it('ko/en 양쪽에 있다', () => {
    expect(KO['nav.usage']).toBe('사용 현황')
    expect(EN['nav.usage']).toBe('Usage')
  })
})
