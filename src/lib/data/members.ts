import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { sortByKoreanName } from '@/lib/domain/nameSort'
import type { ProjectMember, ProjectMemberRole, TeamCode } from '@/lib/domain/types'

// 같은 요청 내 중복 호출 dedupe
export const getProjectMembers = cache(async (projectId: string): Promise<ProjectMember[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('project_members')
    .select('id, project_id, name, email, role, title, role_label, user_id, created_at, teams(code)')
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
      roleLabel: (r.role_label as string) ?? null,
      hasAccount: r.user_id != null,
      createdAt: r.created_at as string,
    }
  })
})

/**
 * 로그인한 사람이 멤버로 등록된 프로젝트 id 목록 — 회의록 프로젝트 자동 선택의 근거.
 *
 * user_id 와 email 을 **둘 다** 본다(resolveMemberIds 와 같은 규칙). 0019 가 user_id 를
 * 붙였지만 백필에서 놓친 행이 남을 수 있고(2026-07-29 실측 39명 중 1명 미연결), 그 사람만
 * 자동 선택이 조용히 안 되는 상황을 만들지 않기 위해서다.
 *
 * 실패는 null — 빈 배열('어느 프로젝트에도 속하지 않음')과 구분한다. 호출부(pickDefaultProjectId)는
 * 둘을 같은 폴백으로 처리하지만, 그건 그쪽의 판단이고 여기서 실패를 '소속 없음'으로 위장하지는 않는다.
 */
export const getMyProjectIds = cache(async (): Promise<string[] | null> => {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  const user = u.user
  if (!user) return null
  const email = user.email?.trim().toLowerCase() || null
  const [byUser, byEmail] = await Promise.all([
    sb.from('project_members').select('project_id').eq('user_id', user.id),
    email
      ? sb.from('project_members').select('project_id').eq('email', email)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (byUser.error && byEmail.error) {
    console.error('[getMyProjectIds] 조회 실패:', byUser.error.message, byEmail.error.message)
    return null
  }
  const ids = new Set<string>()
  for (const [label, res] of [['user_id', byUser], ['email', byEmail]] as const) {
    // 한쪽만 실패하면 남은 쪽으로 진행한다 — 자동 선택은 부가 기능이라 전부 막을 이유가 없다.
    // 다만 조용히 좁아진 결과를 쓰는 것이므로 원인은 남긴다.
    if (res.error) { console.error(`[getMyProjectIds] ${label} 조회 실패:`, res.error.message); continue }
    for (const r of res.data ?? []) {
      const pid = (r as { project_id?: string }).project_id
      if (pid) ids.add(pid)
    }
  }
  return [...ids]
})
