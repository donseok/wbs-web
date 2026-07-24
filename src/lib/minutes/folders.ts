import type { createServerClient } from '@/lib/supabase/server'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { TeamCode } from '@/lib/domain/types'

type DbClient = Awaited<ReturnType<typeof createServerClient>> | ReturnType<typeof createAdminClient>

/** 담당 팀과 동명인 **시드** 루트 폴더 id — 신규 회의록 자동 편철용(0043 하이어라키: 루트=팀코드 5축).
 *  created_by null(시드) 고정 — 동명 사용자 폴더(스쿼팅)가 전사 편철 대상이 되면 안 됨.
 *  조회 실패·폴더 부재는 null(미분류 폴백)로 로그만 남긴다 — 편철이 등록 자체를 막으면 안 됨. */
export async function resolveTeamRootFolderId(
  sb: DbClient, teamCode: TeamCode,
): Promise<string | null> {
  const { data, error } = await sb.from('minute_folders')
    .select('id').is('parent_id', null).is('created_by', null).eq('name', teamCode).maybeSingle()
  if (error) {
    console.error('[minutes] 팀 루트 폴더 조회 실패(미분류 폴백):', error.message)
    return null
  }
  return (data as { id: string } | null)?.id ?? null
}
