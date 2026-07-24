'use client'

// 활성 팀 목록 컨텍스트 — (app)/layout 서버에서 1회 주입. 미제공 시 DEFAULT_TEAMS(테스트 픽스처 호환).
import { createContext, useContext, useMemo } from 'react'
import { activeCodes, DEFAULT_TEAMS, type Team } from '@/lib/domain/teams'
import type { TeamCode } from '@/lib/domain/types'

const TeamsContext = createContext<readonly Team[]>(DEFAULT_TEAMS)

export function TeamsProvider({ teams, children }: { teams: readonly Team[]; children: React.ReactNode }) {
  return <TeamsContext.Provider value={teams}>{children}</TeamsContext.Provider>
}

/** 활성 팀(정렬됨) — progressVisible 등 팀 속성이 필요한 곳. */
export function useTeams(): readonly Team[] {
  const teams = useContext(TeamsContext)
  return useMemo(
    () => teams.filter(t => t.active).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'ko')),
    [teams],
  )
}

/** 활성 팀 코드(정렬됨) — 탭·필터·셀렉트 공용. */
export function useTeamCodes(): readonly TeamCode[] {
  const teams = useContext(TeamsContext)
  return useMemo(() => activeCodes(teams), [teams])
}
