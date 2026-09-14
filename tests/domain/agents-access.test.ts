import { describe, expect, it } from 'vitest'
import { canViewAgents, seatmapProjectIds } from '@/lib/authz/agentsAccess'
import type { Actor } from '@/lib/domain/authz'
import { KO } from '@/lib/i18n/dict/ko'
import { EN } from '@/lib/i18n/dict/en'

const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map(), rosterTeams: new Map(), ...over,
})

describe('canViewAgents — 슈퍼유저 또는 역할이 있는 프로젝트 1개 이상(좌석표 v1 스펙 §5-1, 2026-09-14 멤버 개방)', () => {
  it('슈퍼유저·관리자·멤버는 본다', () => {
    expect(canViewAgents(actor({ isSuperuser: true }))).toBe(true)
    expect(canViewAgents(actor({ projectRoles: new Map([['p1', 'admin' as const]]) }))).toBe(true)
    expect(canViewAgents(actor({ projectRoles: new Map([['p1', 'member' as const]]) }))).toBe(true)
  })
  it('역할 없음(조회 전용)·null 은 못 본다 — fail-closed', () => {
    expect(canViewAgents(actor({}))).toBe(false)
    expect(canViewAgents(null)).toBe(false)
  })
})

describe('seatmapProjectIds — 층 목록', () => {
  it('슈퍼유저는 null(전체), 그 외는 역할이 있는 프로젝트만(member 포함), 역할 없으면 빈 배열', () => {
    expect(seatmapProjectIds(actor({ isSuperuser: true }))).toBeNull()
    expect(seatmapProjectIds(actor({ projectRoles: new Map([['p1', 'admin' as const], ['p2', 'member' as const]]) }))).toEqual(['p1', 'p2'])
    expect(seatmapProjectIds(actor({}))).toEqual([])
    expect(seatmapProjectIds(null)).toEqual([])
  })
})

describe('nav.agents 사전 키', () => {
  it('ko/en 양쪽에 있다', () => {
    expect(KO['nav.agents']).toBe('에이전트')
    expect(EN['nav.agents']).toBe('Agents')
  })
})
