import { describe, expect, it } from 'vitest'
import { canReleaseLeadLease, type Actor } from '@/lib/domain/authz'

const P = '11111111-1111-4111-8111-111111111111'
const actor = (userId: string, role: 'admin' | 'member' | null, isSuperuser = false): Actor => ({
  userId, teamCode: null, teamId: null, isSuperuser,
  projectRoles: new Map(role ? [[P, role]] : []), rosterTeams: new Map(),
})

describe('canReleaseLeadLease', () => {
  it('lease 주인 본인(멤버)은 풀 수 있다', () => expect(canReleaseLeadLease(actor('u-1', 'member'), P, 'u-1')).toBe(true))
  it('그 프로젝트 관리자는 남의 것도 풀 수 있다', () => expect(canReleaseLeadLease(actor('u-2', 'admin'), P, 'u-1')).toBe(true))
  it('슈퍼유저는 풀 수 있다', () => expect(canReleaseLeadLease(actor('u-2', null, true), P, 'u-1')).toBe(true))
  it('다른 멤버는 풀 수 없다', () => expect(canReleaseLeadLease(actor('u-2', 'member'), P, 'u-1')).toBe(false))
  it('비멤버는 자기 것이라도 풀 수 없다', () => expect(canReleaseLeadLease(actor('u-1', null), P, 'u-1')).toBe(false))
  it('actor 가 없으면 false', () => expect(canReleaseLeadLease(null, P, 'u-1')).toBe(false))
})
