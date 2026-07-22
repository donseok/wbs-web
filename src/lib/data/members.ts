import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { sortByKoreanName } from '@/lib/domain/nameSort'
import type { ProjectMember, ProjectMemberRole, TeamCode } from '@/lib/domain/types'

// 같은 요청 내 중복 호출 dedupe
export const getProjectMembers = cache(async (projectId: string): Promise<ProjectMember[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('project_members')
    .select('id, project_id, name, email, role, title, user_id, created_at, teams(code)')
    .eq('project_id', projectId)
    // 정렬은 아래 sortByKoreanName 이 담당한다. created_at 은 동명이인의 순서를 고정하기 위한 tiebreak.
    // (DB collation 에 이름 정렬을 맡기지 않는다 — 인스턴스 collation 에 따라 가나다순이 깨진다.)
    .order('created_at', { ascending: true })

  // 실패를 삼키면 '멤버 0명'이 정상 상태와 구별되지 않는다(스키마 드리프트가 조용히 빈 화면이 된다).
  if (error) console.error('[getProjectMembers] 조회 실패:', error.message)

  // 멤버 명단은 앱 어디서 보든 가나다순 — 멤버 보드·근태 셀렉트·회의 참석자 피커·주간보고가
  // 모두 이 배열을 그대로 렌더하므로 여기서 한 번 정렬하면 화면 전체가 같은 순서를 쓴다.
  const rows = sortByKoreanName(data ?? [], r => (r as Record<string, unknown>).name as string)

  return rows.map((r: Record<string, unknown>) => {
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
