import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export type ResolveMinuteProjectInput = {
  meetingId: string | null
  projectId?: string | null
}

/**
 * 회의 연결과 Wiki 귀속 프로젝트를 하나의 규칙으로 해석한다.
 * 회의를 골랐다면 그 회의의 프로젝트가 단일 진실이며, 서로 다른 프로젝트를 함께 보내는
 * 요청은 조용히 보정하지 않고 거절한다.
 */
export async function resolveMinuteProject(
  db: SupabaseClient,
  input: ResolveMinuteProjectInput,
): Promise<{ projectId: string | null; error: string | null }> {
  if (input.meetingId) {
    const { data: meeting, error } = await db.from('meetings')
      .select('id, project_id')
      .eq('id', input.meetingId)
      .maybeSingle()
    if (error) return { projectId: null, error: error.message }
    if (!meeting) return { projectId: null, error: '연결할 회의를 찾을 수 없습니다.' }
    const meetingProjectId = meeting.project_id as string
    if (input.projectId && input.projectId !== meetingProjectId) {
      return { projectId: null, error: '선택한 회의와 프로젝트가 일치하지 않습니다.' }
    }
    return { projectId: meetingProjectId, error: null }
  }

  if (!input.projectId) return { projectId: null, error: null }
  const { data: project, error } = await db.from('projects')
    .select('id')
    .eq('id', input.projectId)
    .maybeSingle()
  if (error) return { projectId: null, error: error.message }
  if (!project) return { projectId: null, error: '프로젝트를 찾을 수 없습니다.' }
  return { projectId: project.id as string, error: null }
}
