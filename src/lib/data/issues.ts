import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { Issue, IssueSeverity, IssueStatus } from '@/lib/domain/issues'
import type { IssueMegaCode, IssueSourceType } from '@/lib/domain/issueAnalysis'
import type {
  IssueMinuteSource,
  IssueMinuteSourceKind,
  MinuteLinkedIssue,
} from '@/lib/domain/issueMinuteSource'

/**
 * 프로젝트 이슈 목록 — DB 는 등록순(최신 먼저)으로만 가져오고, 표시 정렬은 도메인
 * sortIssues 가 담당한다. 실패 시 [] + 로그 (읽기 계층 관례 — silent-empty 금지, 로그 필수).
 * 담당자 이름은 여기서 조인하지 않는다: 페이지가 getProjectMembers 를 병렬 로드하므로
 * 뷰에서 Map 병합이 왕복 0회 추가다 (FK 임베드는 관계 미탐지 시 부모 쿼리 전체가 죽는다 —
 * 담당자 id 도 임베드 대신 프로젝트 단위 별도 조회로 가져와 같은 함정을 피한다).
 */
export const getIssues = cache(async (projectId: string): Promise<Issue[]> => {
  const sb = await createServerClient()
  const [issuesRes, assigneesRes, linksRes, majorsRes, attachRes] = await Promise.all([
    sb.from('issues')
      .select('id, issue_no, pi_issue_code, project_id, mega_code, mega_seq, major_id, title, body, status, severity, start_date, due_date, sub_process, owner_department, related_systems, source_type, source_detail, resolution_note, resolved_at, created_by, created_by_name, created_at, updated_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
    // 지정 순서(created_at)로 정렬해 두 번 실행해도 배열 순서가 같게 한다 — 뷰 정렬과 무관한 안정성.
    sb.from('issue_assignees')
      .select('issue_id, member_id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .order('member_id', { ascending: true }),
    sb.from('issue_links')
      .select('id, issue_id, project_id, minute_id, minute_version_id, minute_version_no, minute_title_snapshot, minute_date_snapshot, body_hash, block_index, block_hash, excerpt_snapshot, source_kind, source_key, created_at')
      .eq('project_id', projectId)
      .eq('link_type', 'minute_block')
      .order('created_at', { ascending: true }),
    sb.from('issue_major_processes')
      .select('id, mega_code, major_seq, name')
      .eq('project_id', projectId),
    // 첨부 개수(0068). project_id 로 프로젝트 한 방에 긁는다 — .in('issue_id', ids) 로 하면
    // 이슈 조회 결과를 기다려야 해서 이 Promise.all 병렬이 깨지고 왕복이 1회 늘어난다.
    sb.from('issue_attachments')
      .select('issue_id')
      .eq('project_id', projectId),
  ])

  if (issuesRes.error) console.error('[getIssues] 조회 실패:', issuesRes.error.message)
  // 담당자 조회 실패를 삼키고 전부 '담당 없음'으로 그리면 조용한 오표시가 된다 — 로그 필수(읽기 계층 관례).
  if (assigneesRes.error) console.error('[getIssues] 담당자 조회 실패:', assigneesRes.error.message)
  if (linksRes.error) console.error('[getIssues] 회의록 출처 조회 실패:', linksRes.error.message)
  if (majorsRes.error) console.error('[getIssues] Major Process 조회 실패:', majorsRes.error.message)
  // 첨부가 있는데 배지가 안 뜨는 것도 조용한 오표시다 — 목록은 계속 뜨되 사유는 남긴다.
  if (attachRes.error) console.error('[getIssues] 첨부 조회 실패:', attachRes.error.message)

  const assigneesByIssue = new Map<string, string[]>()
  for (const r of (assigneesRes.data ?? []) as { issue_id: string; member_id: string }[]) {
    const list = assigneesByIssue.get(r.issue_id)
    if (list) list.push(r.member_id)
    else assigneesByIssue.set(r.issue_id, [r.member_id])
  }

  const linksByIssue = new Map<string, IssueMinuteSource[]>()
  for (const r of (linksRes.data ?? []) as Record<string, unknown>[]) {
    const source: IssueMinuteSource = {
      id: r.id as string,
      issueId: r.issue_id as string,
      projectId: r.project_id as string,
      minuteId: r.minute_id as string,
      minuteVersionId: r.minute_version_id as string,
      minuteVersionNo: Number(r.minute_version_no),
      minuteTitle: r.minute_title_snapshot as string,
      minuteDate: r.minute_date_snapshot as string,
      bodyHash: r.body_hash as string,
      blockIndex: Number(r.block_index),
      blockHash: r.block_hash as string,
      excerpt: r.excerpt_snapshot as string,
      kind: r.source_kind as IssueMinuteSourceKind,
      sourceKey: (r.source_key as string | null) ?? null,
      createdAt: r.created_at as string,
    }
    const list = linksByIssue.get(source.issueId)
    if (list) list.push(source)
    else linksByIssue.set(source.issueId, [source])
  }

  const attachCountByIssue = new Map<string, number>()
  for (const r of (attachRes.data ?? []) as { issue_id: string }[]) {
    attachCountByIssue.set(r.issue_id, (attachCountByIssue.get(r.issue_id) ?? 0) + 1)
  }

  const majorById = new Map<string, { majorSeq: number; name: string }>()
  for (const r of (majorsRes.data ?? []) as { id: string; major_seq: number | string; name: string }[]) {
    majorById.set(r.id, { majorSeq: Number(r.major_seq), name: r.name })
  }

  return (issuesRes.data ?? []).map((r: Record<string, unknown>) => {
    const majorId = (r.major_id as string | null) ?? null
    const major = majorId ? majorById.get(majorId) ?? null : null
    return {
    id: r.id as string,
    issueNo: Number(r.issue_no),
    piIssueCode: (r.pi_issue_code as string | null) ?? null,
    projectId: r.project_id as string,
    megaCode: (r.mega_code as IssueMegaCode | null) ?? null,
    megaSeq: r.mega_seq == null ? null : Number(r.mega_seq),
    majorId,
    majorSeq: major?.majorSeq ?? null,
    majorName: major?.name ?? null,
    title: r.title as string,
    body: (r.body as string) ?? '',
    status: r.status as IssueStatus,
    severity: r.severity as IssueSeverity,
    assigneeMemberIds: assigneesByIssue.get(r.id as string) ?? [],
    attachmentCount: attachCountByIssue.get(r.id as string) ?? 0,
    startDate: (r.start_date as string | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null,
    subProcess: (r.sub_process as string | null) ?? '',
    ownerDepartment: (r.owner_department as string | null) ?? '',
    relatedSystems: Array.isArray(r.related_systems)
      ? r.related_systems.filter((value): value is string => typeof value === 'string')
      : [],
    sourceType: (r.source_type as IssueSourceType | null) ?? null,
    sourceDetail: (r.source_detail as string | null) ?? '',
    minuteSources: linksByIssue.get(r.id as string) ?? [],
    resolutionNote: (r.resolution_note as string) ?? '',
    resolvedAt: (r.resolved_at as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    }
  })
})

// 폼 자동완성용 Major 목록은 fetchIssueMajorProcesses 서버 액션이 단일 경로다 —
// 여기 중복 로더를 두면 쿼리·매핑이 두 곳에서 드리프트한다(적대적 리뷰 반영).

/** 회의록 블록 팝오버에 표시할 연결 이슈. 현재/과거 버전 링크를 모두 읽고 뷰에서 bodyHash로 거른다. */
export const getMinuteLinkedIssues = cache(async (minuteId: string): Promise<MinuteLinkedIssue[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('issue_links')
    .select('id, issue_id, project_id, minute_version_id, body_hash, block_index, block_hash, issues!issue_links_issue_project_fk(issue_no, pi_issue_code, title, status)')
    .eq('minute_id', minuteId)
    .eq('link_type', 'minute_block')
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[getMinuteLinkedIssues] 조회 실패:', error.message)
    return []
  }
  return ((data ?? []) as Record<string, unknown>[]).flatMap(r => {
    const raw = r.issues as Record<string, unknown> | Record<string, unknown>[] | null
    const issue = Array.isArray(raw) ? raw[0] : raw
    if (!issue) return []
    return [{
      linkId: r.id as string,
      issueId: r.issue_id as string,
      issueNo: Number(issue.issue_no),
      piIssueCode: (issue.pi_issue_code as string | null) ?? null,
      projectId: r.project_id as string,
      title: issue.title as string,
      status: issue.status as IssueStatus,
      minuteVersionId: r.minute_version_id as string,
      bodyHash: r.body_hash as string,
      blockIndex: Number(r.block_index),
      blockHash: r.block_hash as string,
    }]
  })
})
