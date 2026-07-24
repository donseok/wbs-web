import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { Issue, IssueSeverity, IssueStatus } from '@/lib/domain/issues'

/**
 * 프로젝트 이슈 목록 — DB 는 등록순(최신 먼저)으로만 가져오고, 표시 정렬은 도메인
 * sortIssues 가 담당한다. 실패 시 [] + 로그 (읽기 계층 관례 — silent-empty 금지, 로그 필수).
 * 담당자 이름은 여기서 조인하지 않는다: 페이지가 getProjectMembers 를 병렬 로드하므로
 * 뷰에서 Map 병합이 왕복 0회 추가다 (FK 임베드는 관계 미탐지 시 부모 쿼리 전체가 죽는다 —
 * 담당자 id 도 임베드 대신 프로젝트 단위 별도 조회로 가져와 같은 함정을 피한다).
 */
export const getIssues = cache(async (projectId: string): Promise<Issue[]> => {
  const sb = await createServerClient()
  const [issuesRes, assigneesRes] = await Promise.all([
    sb.from('issues')
      .select('id, issue_no, project_id, title, body, status, severity, due_date, resolution_note, resolved_at, created_by, created_by_name, created_at, updated_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
    // 지정 순서(created_at)로 정렬해 두 번 실행해도 배열 순서가 같게 한다 — 뷰 정렬과 무관한 안정성.
    sb.from('issue_assignees')
      .select('issue_id, member_id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .order('member_id', { ascending: true }),
  ])

  if (issuesRes.error) console.error('[getIssues] 조회 실패:', issuesRes.error.message)
  // 담당자 조회 실패를 삼키고 전부 '담당 없음'으로 그리면 조용한 오표시가 된다 — 로그 필수(읽기 계층 관례).
  if (assigneesRes.error) console.error('[getIssues] 담당자 조회 실패:', assigneesRes.error.message)

  const assigneesByIssue = new Map<string, string[]>()
  for (const r of (assigneesRes.data ?? []) as { issue_id: string; member_id: string }[]) {
    const list = assigneesByIssue.get(r.issue_id)
    if (list) list.push(r.member_id)
    else assigneesByIssue.set(r.issue_id, [r.member_id])
  }

  return (issuesRes.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    issueNo: Number(r.issue_no),
    projectId: r.project_id as string,
    title: r.title as string,
    body: (r.body as string) ?? '',
    status: r.status as IssueStatus,
    severity: r.severity as IssueSeverity,
    assigneeMemberIds: assigneesByIssue.get(r.id as string) ?? [],
    dueDate: (r.due_date as string | null) ?? null,
    resolutionNote: (r.resolution_note as string) ?? '',
    resolvedAt: (r.resolved_at as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }))
})
