import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { ProjectMember, ProjectMemberRole, TeamCode } from '@/lib/domain/types'

// 같은 요청 내 중복 호출 dedupe
export const getProjectMembers = cache(async (projectId: string): Promise<ProjectMember[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('project_members')
    .select('id, project_id, name, email, role, title, user_id, created_at, teams(code)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  // 실패를 삼키면 '멤버 0명'이 정상 상태와 구별되지 않는다(스키마 드리프트가 조용히 빈 화면이 된다).
  if (error) console.error('[getProjectMembers] 조회 실패:', error.message)

  return (data ?? []).map((r: Record<string, unknown>) => {
    const team = r.teams as { code: TeamCode } | { code: TeamCode }[] | null
    const teamCode = (Array.isArray(team) ? team[0]?.code : team?.code) ?? null
    return {
      id: r.id as string,
      projectId: r.project_id as string,
      name: r.name as string,
      email: (r.email as string) ?? null,
      teamCode: teamCode as TeamCode | null,
      role: (r.role as ProjectMemberRole) ?? 'contributor',
      title: (r.title as string) ?? null,
      hasAccount: r.user_id != null,
      createdAt: r.created_at as string,
    }
  })
})
