import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { TEAM_CODES } from '@/lib/domain/accounts'
import type { TeamCode, TeamOption } from '@/lib/domain/types'

/**
 * 팀 4개. 정렬은 앱의 표준 순서(TEAM_CODES, PMO 우선)를 따른다 —
 * DB 의 .order('code') 는 로케일/콜레이션에 따라 결과가 달라지고 '가공'(비-ASCII)이 끝으로 밀린다.
 * 이 목록은 UI 필터 탭이 되므로 순서가 사용자에게 보인다. 실패 시 [].
 */
export const getTeams = cache(async (): Promise<TeamOption[]> => {
  const sb = await createServerClient()
  const { data } = await sb.from('teams').select('id, code')
  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    code: r.code as TeamCode,
  }))
  return rows.sort((a, b) => TEAM_CODES.indexOf(a.code) - TEAM_CODES.indexOf(b.code))
})
