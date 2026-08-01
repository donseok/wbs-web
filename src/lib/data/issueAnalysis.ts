import { createServerClient } from '@/lib/supabase/server'
import {
  isIssueMegaCode,
  isIssueSourceType,
  type IssueMegaCode,
} from '@/lib/domain/issueAnalysis'
import type { IssueSeverity, IssueStatus } from '@/lib/domain/issues'
import type {
  IssueMinuteSource,
  IssueMinuteSourceKind,
} from '@/lib/domain/issueMinuteSource'
import type {
  IssueAnalysisIssueInput,
  IssueAnalysisReport,
} from '@/lib/report/issues/model'
import { parseStoredIssueAnalysisReport } from '@/lib/report/issues/storedRun'

type QueryResult = {
  data: unknown[] | null
  error: { message: string } | null
}

function assertQuery(
  result: QueryResult,
  label: string,
): asserts result is QueryResult & { data: unknown[]; error: null } {
  if (result.error) {
    throw new Error(`[issue-analysis] ${label} 조회 실패: ${result.error.message}`)
  }
}

/**
 * 분석서 생성 전용 엄격 로더.
 *
 * 일반 화면의 getIssues는 화면 열화 정책상 일부 쿼리 실패를 빈 배열로 표시할 수 있지만,
 * 분석서는 그 상태로 생성하면 잘못된 공식 산출물이 된다. 따라서 이슈/담당자/회의록 링크
 * 셋 중 어느 하나라도 실패하면 즉시 throw하고 부분 결과를 절대 반환하지 않는다.
 *
 * 호출 전에 서버 액션이 requireProjectMember(projectId)를 통과해야 한다.
 */
export async function loadIssueAnalysisIssues(
  projectId: string,
  megaCode?: IssueMegaCode,
): Promise<IssueAnalysisIssueInput[]> {
  const sb = await createServerClient()
  const issuesQuery = sb.from('issues')
    .select([
      'id',
      'issue_no',
      'project_id',
      'title',
      'body',
      'status',
      'severity',
      'start_date',
      'due_date',
      'resolution_note',
      'resolved_at',
      'created_by',
      'created_by_name',
      'created_at',
      'updated_at',
      'mega_code',
      'mega_seq',
      'pi_issue_code',
      'sub_process',
      'owner_department',
      'related_systems',
      'source_type',
      'source_detail',
      'major_id',
    ].join(', '))
    .eq('project_id', projectId)
  const scopedIssuesQuery = megaCode === undefined
    ? issuesQuery
    : issuesQuery.eq('mega_code', megaCode)

  const [issuesResult, assigneesResult, linksResult, majorsResult] = await Promise.all([
    scopedIssuesQuery.order('issue_no', { ascending: true }),
    sb.from('issue_assignees')
      .select('issue_id, member_id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .order('member_id', { ascending: true }),
    sb.from('issue_links')
      .select([
        'id',
        'issue_id',
        'project_id',
        'minute_id',
        'minute_version_id',
        'minute_version_no',
        'minute_title_snapshot',
        'minute_date_snapshot',
        'body_hash',
        'block_index',
        'block_hash',
        'excerpt_snapshot',
        'source_kind',
        'source_key',
        'created_at',
      ].join(', '))
      .eq('project_id', projectId)
      .eq('link_type', 'minute_block')
      .order('created_at', { ascending: true }),
    sb.from('issue_major_processes')
      .select('id, mega_code, major_seq, name')
      .eq('project_id', projectId),
  ])

  assertQuery(issuesResult as QueryResult, '이슈')
  assertQuery(assigneesResult as QueryResult, '담당자')
  assertQuery(linksResult as QueryResult, '회의록 출처')
  assertQuery(majorsResult as QueryResult, 'Major Process')

  const majorById = new Map<string, { majorSeq: number; name: string }>()
  for (const raw of majorsResult.data as unknown as Record<string, unknown>[]) {
    majorById.set(String(raw.id), { majorSeq: Number(raw.major_seq), name: String(raw.name ?? '') })
  }

  const assigneesByIssue = new Map<string, string[]>()
  for (const raw of assigneesResult.data as unknown as Record<string, unknown>[]) {
    const issueId = String(raw.issue_id)
    const memberId = String(raw.member_id)
    const members = assigneesByIssue.get(issueId)
    if (members) members.push(memberId)
    else assigneesByIssue.set(issueId, [memberId])
  }

  const linksByIssue = new Map<string, IssueMinuteSource[]>()
  for (const raw of linksResult.data as unknown as Record<string, unknown>[]) {
    const issueId = String(raw.issue_id)
    const source: IssueMinuteSource = {
      id: String(raw.id),
      issueId,
      projectId: String(raw.project_id),
      minuteId: String(raw.minute_id),
      minuteVersionId: String(raw.minute_version_id),
      minuteVersionNo: Number(raw.minute_version_no),
      minuteTitle: String(raw.minute_title_snapshot ?? ''),
      minuteDate: String(raw.minute_date_snapshot ?? ''),
      bodyHash: String(raw.body_hash ?? ''),
      blockIndex: Number(raw.block_index),
      blockHash: String(raw.block_hash ?? ''),
      excerpt: String(raw.excerpt_snapshot ?? ''),
      kind: raw.source_kind as IssueMinuteSourceKind,
      sourceKey: typeof raw.source_key === 'string' ? raw.source_key : null,
      createdAt: String(raw.created_at),
    }
    const links = linksByIssue.get(issueId)
    if (links) links.push(source)
    else linksByIssue.set(issueId, [source])
  }

  return (issuesResult.data as unknown as Record<string, unknown>[]).map(raw => {
    const id = String(raw.id)
    const rawMegaCode = raw.mega_code
    const rawSourceType = raw.source_type
    const majorId = typeof raw.major_id === 'string' ? raw.major_id : null
    const major = majorId ? majorById.get(majorId) ?? null : null
    return {
      majorId,
      majorSeq: major?.majorSeq ?? null,
      majorName: major?.name ?? null,
      id,
      issueNo: Number(raw.issue_no),
      projectId: String(raw.project_id),
      title: String(raw.title ?? ''),
      body: String(raw.body ?? ''),
      status: raw.status as IssueStatus,
      severity: raw.severity as IssueSeverity,
      assigneeMemberIds: assigneesByIssue.get(id) ?? [],
      startDate: typeof raw.start_date === 'string' ? raw.start_date : null,
      dueDate: typeof raw.due_date === 'string' ? raw.due_date : null,
      minuteSources: linksByIssue.get(id) ?? [],
      resolutionNote: String(raw.resolution_note ?? ''),
      resolvedAt: typeof raw.resolved_at === 'string' ? raw.resolved_at : null,
      createdBy: typeof raw.created_by === 'string' ? raw.created_by : null,
      createdByName: typeof raw.created_by_name === 'string' ? raw.created_by_name : null,
      createdAt: String(raw.created_at),
      updatedAt: String(raw.updated_at),
      megaCode: isIssueMegaCode(rawMegaCode) ? rawMegaCode : null,
      megaSeq: Number.isSafeInteger(Number(raw.mega_seq)) && Number(raw.mega_seq) > 0
        ? Number(raw.mega_seq)
        : null,
      piIssueCode: typeof raw.pi_issue_code === 'string' ? raw.pi_issue_code : null,
      subProcess: String(raw.sub_process ?? ''),
      ownerDepartment: String(raw.owner_department ?? ''),
      relatedSystems: Array.isArray(raw.related_systems)
        ? raw.related_systems.filter((value): value is string => typeof value === 'string')
        : [],
      sourceType: isIssueSourceType(rawSourceType) ? rawSourceType : null,
      sourceDetail: String(raw.source_detail ?? ''),
    }
  })
}

export interface SavedIssueAnalysisRun {
  runId: string
  projectId: string
  projectName: string
  report: IssueAnalysisReport
}

type SingleQueryResult = {
  data: Record<string, unknown> | null
  error: { message: string } | null
}

/**
 * PPT 다운로드 전용 저장 실행 로더.
 *
 * 브라우저에는 runId만 맡기고, 분석 JSON과 프로젝트명은 RLS가 적용된 서버 조회로
 * 다시 읽는다. 저장 JSON이 현재 스키마·PI ID·요약·개선기회 연결 계약과 다르면
 * 오래되거나 손상된 공식 산출물을 만들지 않고 중단한다.
 *
 * 호출 전에 requireProjectMember(projectId)를 통과해야 한다.
 */
export async function loadSavedIssueAnalysisRun(
  projectId: string,
  runId: string,
): Promise<SavedIssueAnalysisRun | null> {
  const sb = await createServerClient()
  const [runResult, projectResult] = await Promise.all([
    sb.from('issue_analysis_runs')
      .select('id, project_id, status, analysis_json')
      .eq('id', runId)
      .eq('project_id', projectId)
      .maybeSingle(),
    sb.from('projects')
      .select('id, name')
      .eq('id', projectId)
      .maybeSingle(),
  ])
  const run = runResult as unknown as SingleQueryResult
  const project = projectResult as unknown as SingleQueryResult
  if (run.error) throw new Error(`[issue-analysis] 저장 실행 조회 실패: ${run.error.message}`)
  if (project.error) throw new Error(`[issue-analysis] 프로젝트 조회 실패: ${project.error.message}`)
  if (!run.data || !project.data) return null
  if (
    run.data.id !== runId
    || run.data.project_id !== projectId
    || run.data.status !== 'ready'
    || project.data.id !== projectId
    || typeof project.data.name !== 'string'
    || !project.data.name.trim()
  ) return null

  const report = parseStoredIssueAnalysisReport(run.data.analysis_json, projectId)
  if (!report) {
    throw new Error('[issue-analysis] 저장된 실행 결과 스키마 또는 데이터 정합성이 유효하지 않습니다.')
  }
  return {
    runId,
    projectId,
    projectName: project.data.name.trim(),
    report,
  }
}
