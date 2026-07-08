import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { TeamCode } from '@/lib/domain/types'

export interface TeamOption {
  id: string
  code: TeamCode
}

/** 팀 4개(PMO/ERP/MES/가공). code 오름차순은 의미가 없으므로 삽입 순서(id) 대신 code 로 안정 정렬. 실패 시 []. */
export const getTeams = cache(async (): Promise<TeamOption[]> => {
  const sb = await createServerClient()
  const { data } = await sb.from('teams').select('id, code').order('code')
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    code: r.code as TeamCode,
  }))
})
