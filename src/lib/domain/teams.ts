// 팀 기준정보 순수 도메인 — I/O 없음. 런타임 소스는 lib/teams/master.ts(서버 캐시).
import type { TeamCode } from './types'

export interface Team {
  id: string
  /** 표시명이자 식별 코드(teams.code). teams.name은 code와 동기. */
  code: TeamCode
  sortOrder: number
  active: boolean
  /** 대시보드 '팀별 진척현황' 노출 여부(기존 MDM 제외 규칙의 데이터화). */
  progressVisible: boolean
}

/** 콜드스타트 폴백 + 테스트 기본값(2026-07 기준 5팀). 런타임 기준은 항상 DB teams. */
export const DEFAULT_TEAMS: readonly Team[] = [
  { id: 'default-pmo', code: 'PMO', sortOrder: 0, active: true, progressVisible: true },
  { id: 'default-erp', code: 'ERP', sortOrder: 1, active: true, progressVisible: true },
  { id: 'default-mes', code: 'MES', sortOrder: 2, active: true, progressVisible: true },
  { id: 'default-gagong', code: '가공', sortOrder: 3, active: true, progressVisible: true },
  { id: 'default-mdm', code: 'MDM', sortOrder: 4, active: true, progressVisible: false },
]

export const DEFAULT_TEAM_CODES: readonly TeamCode[] = DEFAULT_TEAMS.map(t => t.code)

/** 활성 팀 코드 — sortOrder, 동률이면 code 순. 탭·필터·셀렉트 공용 순서. */
export function activeCodes(teams: readonly Team[]): TeamCode[] {
  return [...teams]
    .filter(t => t.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'ko'))
    .map(t => t.code)
}

/** 코드→표시 순서 인덱스(담당 정렬용). */
export function teamOrderMap(codes: readonly TeamCode[]): Map<string, number> {
  return new Map(codes.map((c, i) => [c, i]))
}

/** 엑셀 헤더에서 팀 열 탐색에 쓰이는 이름들 — 팀명으로 쓰면 열 맵이 오염된다. */
export const RESERVED_TEAM_NAMES: readonly string[] = [
  'Biz', 'Phase', 'Task', 'Activity', '담당', '산출물', '계획',
  '시작', '종료', '가중치', '실적%', '계획%', '계획대비%', '상태',
]

const TEAM_CODE_MAX = 20

/** 관리 화면 팀 추가 입력 검증 — 중복 검사는 액션(DB 대조)에서. */
export function normalizeNewTeamCode(
  input: string,
): { ok: true; code: string } | { ok: false; error: string } {
  const code = input.trim()
  if (!code) return { ok: false, error: '팀 이름을 입력하세요.' }
  if (code.length > TEAM_CODE_MAX) return { ok: false, error: `팀 이름은 ${TEAM_CODE_MAX}자 이하여야 합니다.` }
  if ((RESERVED_TEAM_NAMES as readonly string[]).includes(code)) {
    return { ok: false, error: `'${code}'는 엑셀 양식 예약어라 팀 이름으로 쓸 수 없습니다.` }
  }
  return { ok: true, code }
}
