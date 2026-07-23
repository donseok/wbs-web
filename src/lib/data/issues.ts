import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { Issue, IssueSeverity, IssueStatus } from '@/lib/domain/issues'

/**
 * 프로젝트 이슈 목록 — DB 는 등록순(최신 먼저)으로만 가져오고, 표시 정렬은 도메인
 * sortIssues 가 담당한다. 실패 시 [] + 로그 (읽기 계층 관례 — silent-empty 금지, 로그 필수).
 * 담당자 이름은 여기서 조인하지 않는다: 페이지가 getProjectMembers 를 병렬 로드하므로
 * 뷰에서 Map 병합이 왕복 0회 추가다 (FK 임베드는 관계 미탐지 시 부모 쿼리 전체가 죽는다).
 */
export const getIssues = cache(async (projectId: string): Promise<Issue[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('issues')
    .select('id, issue_no, project_id, title, body, status, severity, assignee_member_id, due_date, resolution_note, resolved_at, created_by, created_by_name, created_at, updated_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) console.error('[getIssues] 조회 실패:', error.message)

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    issueNo: Number(r.issue_no),
    projectId: r.project_id as string,
    title: r.title as string,
    body: (r.body as string) ?? '',
    status: r.status as IssueStatus,
    severity: r.severity as IssueSeverity,
    assigneeMemberId: (r.assignee_member_id as string | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null,
    resolutionNote: (r.resolution_note as string) ?? '',
    resolvedAt: (r.resolved_at as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }))
})
