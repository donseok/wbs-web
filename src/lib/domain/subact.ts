import type { OwnerKind, TeamCode } from './types'
import { DEFAULT_TEAM_CODES } from './teams'

/** @deprecated 기본 5팀 폴백 — 호출처는 활성 팀 목록을 주입할 것(useTeamCodes/activeTeamCodesSync). */
export const SUB_ACT_TEAMS: readonly TeamCode[] = DEFAULT_TEAM_CODES

/** SUB-ACT 저장 이름 규칙 — 임포트 분리(splitLeafOwners)와 동일한 "{ACT명} ({팀} 주관/지원)".
 *  하류(검색·챗봇·보고·엑셀 라운드트립)가 리프 이름만으로 작업을 식별할 수 있어야 하므로 부모명을 접두로 유지한다. */
export function subActName(actName: string, team: TeamCode, kind: OwnerKind): string {
  return `${actName} (${team} ${kind === 'primary' ? '주관' : '지원'})`
}

/** ACT 하위 SUB-ACT 들이 이미 점유한 담당 팀 집합. 한 팀은 한 ACT 당 SUB-ACT 하나만. */
export function subActTeamsInUse(children: { owners: { team: TeamCode }[] }[]): Set<TeamCode> {
  const used = new Set<TeamCode>()
  for (const c of children) for (const o of c.owners) used.add(o.team)
  return used
}

/** 새 SUB-ACT 로 아직 배정 가능한 팀 목록(표준 순서 유지). */
export function availableSubActTeams(
  children: { owners: { team: TeamCode }[] }[],
  teams: readonly TeamCode[] = SUB_ACT_TEAMS,
): TeamCode[] {
  const used = subActTeamsInUse(children)
  return teams.filter(t => !used.has(t))
}

/** 첫 SUB-ACT 추가 시 ACT 가 롤업 부모로 바뀌며 직접 입력된 실적%가 버려지는지 여부(경고 표시용). */
export function willDiscardActual(childrenCount: number, actualPct: number | null): boolean {
  return childrenCount === 0 && (actualPct ?? 0) > 0
}
