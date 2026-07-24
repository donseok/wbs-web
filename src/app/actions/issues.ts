'use server'
// 이슈 쓰기 액션 — 전부 세션+멤버십 fail-closed. RLS 는 "멤버면 수정 가능" 백스톱까지만
// 보장하므로(0041 헤더 참조) 진행 필드 vs 전체 편집의 세분화는 여기서 강제한다.
// updated_at 트리거 없음 — 모든 update 페이로드에 수동 포함(레포 관례).
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { displayNameFrom } from '@/lib/domain/display-name'
import {
  ISSUE_SEVERITIES, canTransition, nextResolvedAt,
  type IssueSeverity, type IssueStatus,
} from '@/lib/domain/issues'

export interface IssueActionResult {
  ok: boolean
  error?: string
  id?: string
  /** CAS 0행 — 다른 사용자가 먼저 상태를 바꿨다. 클라이언트는 router.refresh() 후 안내. */
  conflict?: boolean
}

export interface IssueInput {
  title: string
  body: string
  severity: IssueSeverity
  assigneeMemberIds: string[]
  dueDate: string | null
}

export interface IssueProgressPatch {
  status?: IssueStatus
  /** status 를 보낼 때 필수 — 클라이언트가 화면에 보이는 상태(CAS 비교 기준). 서버가 방금 읽은 상태가 아니다. */
  expectedStatus?: IssueStatus
  assigneeMemberIds?: string[]
  resolutionNote?: string
}

const TITLE_MAX = 200
const TEXT_MAX = 20000
const ASSIGNEES_MAX = 20
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 형식 + 실재성(2026-02-30 반려) — announcements isValidDate 관례. */
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** 서버 액션 인자는 클라이언트가 임의로 만든다 — 배열 형태·원소 타입·개수를 여기서 못박는다. */
function validateAssignees(ids: unknown): string | null {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) return '담당자 형식이 올바르지 않습니다.'
  if (ids.length > ASSIGNEES_MAX) return `담당자는 최대 ${ASSIGNEES_MAX}명까지 지정할 수 있습니다.`
  return null
}

function validateInput(input: IssueInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > TITLE_MAX) return `제목은 ${TITLE_MAX}자 이하여야 합니다.`
  if (input.body.length > TEXT_MAX) return `내용은 ${TEXT_MAX}자 이하여야 합니다.`
  if (!ISSUE_SEVERITIES.includes(input.severity)) return '잘못된 심각도입니다.'
  const assigneeErr = validateAssignees(input.assigneeMemberIds)
  if (assigneeErr) return assigneeErr
  // 과거 날짜는 허용(즉시 지연 표시 안내는 폼 몫) — 형식·실재성만 검증
  if (input.dueDate !== null && !isValidDate(input.dueDate)) return '목표 해결일 날짜 형식이 올바르지 않습니다.'
  return null
}

/**
 * 담당자 전체 교체 — 회의 replaceAttendees 관례.
 * 유효성 검증(해당 프로젝트 멤버인지)을 delete 보다 먼저 수행해, 잘못된 id 목록이
 * 기존 담당자를 먼저 지워버리는 것을 막는다. 0042 복합 FK 가 DB 에서 이중 방어한다.
 */
async function replaceAssignees(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  issueId: string,
  projectId: string,
  memberIds: string[],
): Promise<string | null> {
  const unique = [...new Set(memberIds)]
  if (unique.length === 0) {
    const { error: clrErr } = await sb.from('issue_assignees').delete().eq('issue_id', issueId)
    return clrErr ? clrErr.message : null
  }
  const { data: valid, error: validErr } = await sb
    .from('project_members')
    .select('id')
    .eq('project_id', projectId)
    .in('id', unique)
  // 쓰기 선행 검증 조회 실패를 '유효 멤버 0명'으로 오인하면 담당자 변경이 통째로 유실되며
  // 액션은 성공을 보고한다 — 실패는 실패로 올린다(silent-empty 금지).
  if (validErr) {
    console.error('[replaceAssignees] 멤버 검증 조회 실패:', validErr.message)
    return validErr.message
  }
  const validIds = (valid ?? []).map((r: { id: string }) => r.id)
  if (validIds.length !== unique.length) return '프로젝트 멤버가 아닌 담당자가 있습니다. 새로고침 후 다시 시도하세요.'
  const { error: delErr } = await sb.from('issue_assignees').delete().eq('issue_id', issueId)
  if (delErr) return delErr.message // 삭제 실패를 삼키면 이어지는 insert 가 PK 충돌이 된다
  const { error } = await sb
    .from('issue_assignees')
    .insert(validIds.map(id => ({ issue_id: issueId, member_id: id, project_id: projectId })))
  return error ? error.message : null
}

function revalidateIssues(projectId: string) {
  revalidatePath(`/p/${projectId}/issues`)
}

export async function createIssue(projectId: string, input: IssueInput): Promise<IssueActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const err = validateInput(input)
  if (err) return { ok: false, error: err }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  const { data, error } = await sb
    .from('issues')
    .insert({
      project_id: projectId,
      title: input.title.trim(),
      body: input.body,
      severity: input.severity,
      due_date: input.dueDate,
      created_by: user.id,
      created_by_name: displayNameFrom(user.user_metadata, user.email),
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  const issueId = data.id as string

  const assignErr = await replaceAssignees(sb, issueId, projectId, input.assigneeMemberIds)
  if (assignErr) {
    // 담당자 저장 실패 시 방금 만든 이슈를 롤백(보상)해 담당 없는 반쪽 이슈가 남지 않게 한다(회의 관례).
    const { error: rbErr } = await sb.from('issues').delete().eq('id', issueId)
    if (rbErr) {
      console.error('[createIssue] 담당자 저장 실패 후 이슈 롤백 실패(담당 없는 이슈 잔존):', rbErr.message)
      revalidateIssues(projectId)
      return { ok: false, error: `담당자 저장에 실패했습니다(${assignErr}). 이슈가 생성됐을 수 있으니 목록을 확인하세요.` }
    }
    return { ok: false, error: assignErr }
  }
  revalidateIssues(projectId)
  return { ok: true, id: issueId }
}

/** 전체 편집(제목·내용·심각도·기한·담당자) — 작성자 또는 pmo_admin 만. */
export async function updateIssue(issueId: string, input: IssueInput): Promise<IssueActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const err = validateInput(input)
  if (err) return { ok: false, error: err }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  // 소유권 선검증(RLS 와 동일 — 0행 무음 성공 방지, meetings 관례)
  const { data: cur } = await sb.from('issues').select('project_id, created_by').eq('id', issueId).maybeSingle()
  if (!cur) return { ok: false, error: '이슈를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const { error } = await sb
    .from('issues')
    .update({
      title: input.title.trim(),
      body: input.body,
      severity: input.severity,
      due_date: input.dueDate,
      updated_at: new Date().toISOString(),
      // created_by / status / resolution_note 는 여기서 SET 하지 않음(전자 불변, 후자는 진행 액션 전용)
    })
    .eq('id', issueId)
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  // 본문 수정은 이미 커밋됨 — 담당자 교체가 실패해도 변경분이 보이도록 revalidate 후 에러 보고(회의 관례).
  const assignErr = await replaceAssignees(sb, issueId, cur.project_id as string, input.assigneeMemberIds)
  revalidateIssues(cur.project_id as string)
  // 부분 실패는 부분 실패로 고지한다 — 맨 에러만 돌려주면 사용자가 전체 실패로 읽고
  // 이미 저장된 제목·내용 변경을 모른 채 지나간다(updateIssueProgress 와 같은 문구 원칙).
  if (assignErr) return { ok: false, error: `담당자 저장에 실패했습니다(${assignErr}). 제목·내용 등 나머지 변경은 저장되었습니다.` }
  return { ok: true }
}

/** 진행 업데이트(상태·담당자·조치메모) — 멤버 전체. 상태 변경은 전환 맵 검증 + CAS. */
export async function updateIssueProgress(issueId: string, patch: IssueProgressPatch): Promise<IssueActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (patch.status === undefined && patch.assigneeMemberIds === undefined && patch.resolutionNote === undefined) {
    return { ok: false, error: '변경할 내용이 없습니다.' }
  }
  if (patch.status !== undefined && patch.expectedStatus === undefined) {
    return { ok: false, error: '상태 기준값이 없습니다. 새로고침 후 다시 시도하세요.' }
  }
  if (patch.resolutionNote !== undefined && patch.resolutionNote.length > TEXT_MAX) {
    return { ok: false, error: `조치 메모는 ${TEXT_MAX}자 이하여야 합니다.` }
  }
  if (patch.assigneeMemberIds !== undefined) {
    const assigneeErr = validateAssignees(patch.assigneeMemberIds)
    if (assigneeErr) return { ok: false, error: assigneeErr }
  }

  const sb = await createServerClient()
  const { data: cur } = await sb.from('issues').select('project_id, created_by, status, resolved_at').eq('id', issueId).maybeSingle()
  if (!cur) return { ok: false, error: '이슈를 찾을 수 없습니다.' }
  const curStatus = cur.status as IssueStatus

  // 담당자만 바꿔도 issues.updated_at 은 반드시 오른다 — AI 인덱스 신선도 가드의 입력(0041 헤더).
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.resolutionNote !== undefined) payload.resolution_note = patch.resolutionNote
  if (patch.status !== undefined) {
    // CAS 비교 기준은 서버가 방금 읽은 curStatus 가 아니라 클라이언트가 화면에서 관측한 expectedStatus.
    // 그래야 read→write 사이가 아니라 "클라이언트가 화면을 마지막으로 갱신한 시점 이후" 변경까지 잡아낸다.
    if (curStatus !== patch.expectedStatus) {
      return { ok: false, conflict: true, error: '다른 사용자가 먼저 변경했거나 이슈가 삭제되었습니다. 최신 상태로 새로고침합니다.' }
    }
    if (!canTransition(patch.expectedStatus, patch.status)) {
      return { ok: false, error: '허용되지 않는 상태 전환입니다. 화면을 새로고침해 주세요.' }
    }
    payload.status = patch.status
    payload.resolved_at = nextResolvedAt(patch.expectedStatus, patch.status, (cur.resolved_at as string | null) ?? null, new Date().toISOString())
  }

  if (patch.status !== undefined) {
    // CAS: expectedStatus 와 같을 때만 반영(위 선검증과 동일 기준). 0행 = 그 사이(read→write) 추가 경합.
    // .select() 필수 — RLS/0행은 error 없이 빈 배열이라 그대로 두면 실패가 성공으로 둔갑한다(wbs.ts 관례).
    const { data: updated, error } = await sb
      .from('issues')
      .update(payload)
      .eq('id', issueId)
      .eq('status', patch.expectedStatus)
      .select('id')
    if (error) return { ok: false, error: error.message }
    if (!updated?.length) {
      return { ok: false, conflict: true, error: '다른 사용자가 먼저 변경했거나 이슈가 삭제되었습니다. 최신 상태로 새로고침합니다.' }
    }
  } else {
    const { data: updated, error } = await sb
      .from('issues')
      .update(payload)
      .eq('id', issueId)
      .select('id')
    if (error) return { ok: false, error: error.message }
    if (!updated?.length) return { ok: false, error: '이슈가 삭제되어 저장할 수 없습니다.' }
  }

  // 담당자 교체는 상태 CAS 가 통과한 뒤에만 — 충돌 감지 시 담당자까지 절반만 저장되는 일이 없게 한다.
  if (patch.assigneeMemberIds !== undefined) {
    const assignErr = await replaceAssignees(sb, issueId, cur.project_id as string, patch.assigneeMemberIds)
    if (assignErr) {
      // 상태·메모는 이미 커밋됐다 — 화면이 그 변경을 반영하도록 revalidate 하고 실패는 실패로 알린다.
      revalidateIssues(cur.project_id as string)
      return { ok: false, error: `담당자 저장에 실패했습니다(${assignErr}). 나머지 변경은 저장되었습니다.` }
    }
  }
  revalidateIssues(cur.project_id as string)
  return { ok: true }
}

export async function deleteIssue(issueId: string): Promise<IssueActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  const { data: cur } = await sb.from('issues').select('project_id, created_by').eq('id', issueId).maybeSingle()
  if (!cur) return { ok: false, error: '이슈를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const { error } = await sb.from('issues').delete().eq('id', issueId).select('id').single()
  if (error) return { ok: false, error: error.message }
  revalidateIssues(cur.project_id as string)
  return { ok: true }
}
