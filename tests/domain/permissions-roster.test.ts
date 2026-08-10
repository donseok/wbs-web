import { describe, expect, it } from 'vitest'
import { canEditActual, actorTeamCodesFor } from '@/lib/domain/permissions'
import type { Actor } from '@/lib/domain/authz'
import type { ComputedItem } from '@/lib/domain/types'

const P = 'p1'
const leaf = (ownerTeam: string) =>
  ({ children: [], owners: [{ team: ownerTeam, kind: 'primary' }] } as unknown as ComputedItem)
const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', teamCode: null, teamId: null, isSuperuser: false,
  projectRoles: new Map([[P, 'member']]), rosterTeams: new Map(), ...over,
})

describe('실적 편집 — 내 팀 = 계정 전역 팀 ∪ 프로젝트 명단 팀(합집합, 스펙 §3)', () => {
  it('계정 전역 팀 일치(기존 경로) — D-CUBE 회귀 0', () => {
    expect(canEditActual(leaf('ERP'), actor({ teamCode: 'ERP', teamId: 't-erp' }), P)).toBe(true)
  })
  it('명단 팀 일치(신규 경로) — 계정 팀이 달라도 허용', () => {
    const a = actor({ teamCode: 'PMO', teamId: 't-pmo',
      rosterTeams: new Map([[P, { teamId: 't-dev', teamCode: '개발' }]]) })
    expect(canEditActual(leaf('개발'), a, P)).toBe(true)
  })
  it('둘 다 불일치면 거부', () => {
    const a = actor({ teamCode: 'PMO', teamId: 't-pmo',
      rosterTeams: new Map([[P, { teamId: 't-dev', teamCode: '개발' }]]) })
    expect(canEditActual(leaf('QA'), a, P)).toBe(false)
  })
  it('다른 프로젝트의 명단 팀은 판정에 쓰지 않는다', () => {
    const a = actor({ rosterTeams: new Map([['p2', { teamId: 't-dev', teamCode: '개발' }]]) })
    expect(canEditActual(leaf('개발'), a, P)).toBe(false)
  })
  it('actorTeamCodesFor 는 중복을 제거한다(계정 팀 == 명단 팀)', () => {
    const a = actor({ teamCode: 'ERP', teamId: 't-erp',
      rosterTeams: new Map([[P, { teamId: 't-erp', teamCode: 'ERP' }]]) })
    expect(actorTeamCodesFor(a, P)).toEqual(['ERP'])
  })
})
