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
  assigneeMemberId: string | null
  dueDate: string | null
}

export interface IssueProgressPatch {
  status?: IssueStatus
  assigneeMemberId?: string | null
  resolutionNote?: string
}

const TITLE_MAX = 200
const TEXT_MAX = 20000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 형식 + 실재성(2026-02-30 반려) — announcements isValidDate 관례. */
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function validateInput(input: IssueInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > TITLE_MAX) return `제목은 ${TITLE_MAX}자 이하여야 합니다.`
  if (input.body.length > TEXT_MAX) return `내용은 ${TEXT_MAX}자 이하여야 합니다.`
  if (!ISSUE_SEVERITIES.includes(input.severity)) return '잘못된 심각도입니다.'
  // 과거 날짜는 허용(즉시 지연 표시 안내는 폼 몫) — 형식·실재성만 검증
  if (input.dueDate !== null && !isValidDate(input.dueDate)) return '목표 해결일 날짜 형식이 올바르지 않습니다.'
  return null
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
      // 담당자-프로젝트 정합은 0041 복합 FK 가 DB 에서 이중 방어(타 프로젝트 멤버면 FK 위반)
      assignee_member_id: input.assigneeMemberId,
      due_date: input.dueDate,
      created_by: user.id,
      created_by_name: displayNameFrom(user.user_metadata, user.email),
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  revalidateIssues(projectId)
  return { ok: true, id: data.id as string }
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
      assignee_member_id: input.assigneeMemberId,
      due_date: input.dueDate,
      updated_at: new Date().toISOString(),
      // created_by / status / resolution_note 는 여기서 SET 하지 않음(전자 불변, 후자는 진행 액션 전용)
    })
    .eq('id', issueId)
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  revalidateIssues(cur.project_id as string)
  return { ok: true }
}

/** 진행 업데이트(상태·담당자·조치메모) — 멤버 전체. 상태 변경은 전환 맵 검증 + CAS. */
export async function updateIssueProgress(issueId: string, patch: IssueProgressPatch): Promise<IssueActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (patch.status === undefined && patch.assigneeMemberId === undefined && patch.resolutionNote === undefined) {
    return { ok: false, error: '변경할 내용이 없습니다.' }
  }
  if (patch.resolutionNote !== undefined && patch.resolutionNote.length > TEXT_MAX) {
    return { ok: false, error: `조치 메모는 ${TEXT_MAX}자 이하여야 합니다.` }
  }

  const sb = await createServerClient()
  const { data: cur } = await sb.from('issues').select('project_id, created_by, status, resolved_at').eq('id', issueId).maybeSingle()
  if (!cur) return { ok: false, error: '이슈를 찾을 수 없습니다.' }
  const from = cur.status as IssueStatus

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.assigneeMemberId !== undefined) payload.assignee_member_id = patch.assigneeMemberId
  if (patch.resolutionNote !== undefined) payload.resolution_note = patch.resolutionNote
  if (patch.status !== undefined) {
    if (!canTransition(from, patch.status)) {
      return { ok: false, error: '허용되지 않는 상태 전환입니다. 화면을 새로고침해 주세요.' }
    }
    payload.status = patch.status
    payload.resolved_at = nextResolvedAt(from, patch.status, (cur.resolved_at as string | null) ?? null, new Date().toISOString())
  }

  if (patch.status !== undefined) {
    // CAS: 선검증 시점의 상태와 같을 때만 반영. 0행 = 그새 다른 사용자가 바꿈(또는 삭제됨).
    // .select() 필수 — RLS/0행은 error 없이 빈 배열이라 그대로 두면 실패가 성공으로 둔갑한다(wbs.ts 관례).
    const { data: updated, error } = await sb
      .from('issues')
      .update(payload)
      .eq('id', issueId)
      .eq('status', from)
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
