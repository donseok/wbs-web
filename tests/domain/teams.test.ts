import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEAMS, DEFAULT_TEAM_CODES, activeCodes, normalizeNewTeamCode, teamOrderMap,
  type Team,
} from '@/lib/domain/teams'

describe('domain/teams', () => {
  it('DEFAULT_TEAM_CODES는 현행 5팀 순서', () => {
    expect(DEFAULT_TEAM_CODES).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM'])
    expect(DEFAULT_TEAMS.find(t => t.code === 'MDM')?.progressVisible).toBe(false)
  })

  it('activeCodes는 active만 sortOrder→code 순 정렬', () => {
    const teams: Team[] = [
      { id: '3', code: 'C', sortOrder: 2, active: false, progressVisible: true },
      { id: '2', code: 'B', sortOrder: 1, active: true, progressVisible: true },
      { id: '1', code: 'A', sortOrder: 1, active: true, progressVisible: true },
    ]
    expect(activeCodes(teams)).toEqual(['A', 'B'])
  })

  it('teamOrderMap은 코드→인덱스', () => {
    expect(teamOrderMap(['X', 'Y']).get('Y')).toBe(1)
    expect(teamOrderMap(['X']).get('없음')).toBeUndefined()
  })

  it('normalizeNewTeamCode: 공백 트림·빈값/초과/예약어 거부', () => {
    expect(normalizeNewTeamCode(' 신팀 ')).toEqual({ ok: true, code: '신팀' })
    expect(normalizeNewTeamCode('  ').ok).toBe(false)
    expect(normalizeNewTeamCode('a'.repeat(21)).ok).toBe(false)
    expect(normalizeNewTeamCode('산출물').ok).toBe(false) // 엑셀 헤더 예약어
    expect(normalizeNewTeamCode('Activity').ok).toBe(false)
  })
})
