import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { ProjectMember, ProjectMemberRole, TeamCode } from '@/lib/domain/types'

// 같은 요청 내 중복 호출 dedupe
export const getProjectMembers = cache(async (projectId: string): Promise<ProjectMember[]> => {
  const sb = await createServerClient()
  const { data } = await sb
    .from('project_members')
    .select('id, project_id, name, email, role, title, user_id, created_at, teams(code)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

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
      userId: (r.user_id as string) ?? null,
      createdAt: r.created_at as string,
    }
  })
})
