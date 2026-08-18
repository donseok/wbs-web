'use server'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { getActor, requireProjectAdmin, resolveProjectId } from '@/lib/authz'
import { ERR_LOOKUP } from '@/lib/authz/errors'
import {
  ISSUE_ATTACHMENT_MAX_COUNT,
  isIssueAttachmentPathValid,
  isIssueAttachmentSizeAllowed,
  remainingIssueAttachmentSlots,
  type IssueAttachment,
} from '@/lib/domain/issueAttachments'
import { createServerClient } from '@/lib/supabase/server'

const BUCKET = 'issue-attachments'

export type IssueAttachmentList =
  | { ok: true; items: IssueAttachment[] }
  | { ok: false; error: string }

/**
 * 첨부 추가·삭제 게이트 — 이슈 수정 권한과 같다(작성자 또는 프로젝트 관리자).
 * 0068 의 `can_edit_issue()` SQL 헬퍼와 같은 정의이며, RLS 가 2차 방어선으로 한 번 더 본다.
 *
 * export 하지 않는다. 이 파일은 'use server' 라서 export 하면 그 자체가 브라우저에서
 * 호출 가능한 서버 액션 엔드포인트가 된다(attachments.ts 의 requireAttachPermission 과 같은 이유).
 *
 * 기존 `adminOrOwnerGate` 를 쓰지 않는 이유: 그것은 created_by 를 비교하지 않고
 * projectId 도 돌려주지 않아 여기서 필요한 것을 채우지 못한다.
 */
async function requireIssueEditable(issueId: string): Promise<
  { ok: true; projectId: string; userId: string } | { ok: false; error: string }
> {
  const found = await resolveProjectId('issues', issueId)
  if (!found.ok) return { ok: false, error: found.error }
  // issues.project_id 는 not null 이지만 타입이 nullable 이다. null 이면 첨부의 not null
  // 컬럼을 채울 수 없으므로 '권한 없음'이 아니라 중단한다.
  if (!found.projectId) {
    console.error('[issueAttachments] 이슈의 프로젝트를 확정하지 못했습니다:', issueId)
    return { ok: false, error: ERR_LOOKUP }
  }
  const projectId = found.projectId

  const admin = await requireProjectAdmin(projectId)
  if (admin.ok) return { ok: true, projectId, userId: admin.actor.userId }

  let actor: Awaited<ReturnType<typeof getActor>> = null
  try { actor = await getActor() } catch { actor = null }
  if (!actor) return { ok: false, error: admin.error }

  const sb = await createServerClient()
  const { data, error } = await sb.from('issues').select('created_by').eq('id', issueId).maybeSingle()
  if (error) {
    console.error('[issueAttachments] 이슈 작성자 조회 실패:', error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!data) return { ok: false, error: '이슈를 찾을 수 없습니다.' }
  if ((data.created_by as string | null) !== actor.userId) return { ok: false, error: '권한 없음' }
  return { ok: true, projectId, userId: actor.userId }
}

/**
 * 이슈의 첨부 목록(서명 URL 포함, 최신순). 다운로드는 로그인 사용자 전체에 열려 있다.
 *
 * 빈 배열이 아니라 에러 채널을 둔 이유: 목록 화면의 클립 배지는 getIssues 의 **별도 쿼리**에서
 * 오므로, 여기서 실패를 [] 로 뭉개면 목록은 '첨부 3개'라고 하는데 상세는 '첨부 없음'이 된다.
 * 사용자는 파일이 소실됐다고 읽는다(에러 3원칙 ①).
 */
export async function listIssueAttachments(issueId: string): Promise<IssueAttachmentList> {
  if (!(await getSession())) {
    console.error('[listIssueAttachments] 비로그인 호출')
    return { ok: false, error: '로그인 필요' }
  }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('issue_attachments')
    .select('id, issue_id, file_name, file_path, size, mime, created_at')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[listIssueAttachments] 첨부 조회 실패:', error.message)
    return { ok: false, error: ERR_LOOKUP }
  }

  const out: IssueAttachment[] = []
  for (const r of data ?? []) {
    const filePath = r.file_path as string
    const fileName = r.file_name as string
    // 건별 호출이다 — 복수형 createSignedUrls 는 경로별로 다른 download 이름을 줄 수 없다.
    // 빈 파일명이면 true 로 폴백해 Content-Disposition 자체는 붙게 한다(minutes.ts:715 와 같은 처리).
    const { data: signed, error: signErr } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(filePath, 3600, { download: fileName || true })
    if (signErr) {
      // 서명 실패를 조용히 null 로 넘기면 화면에서 '링크 없음'으로 위장된다(에러 3원칙 ①).
      console.error('[listIssueAttachments] 서명 URL 생성 실패:', filePath, signErr.message)
    }
    out.push({
      id: r.id as string,
      issueId: r.issue_id as string,
      fileName,
      filePath,
      size: (r.size as number) ?? null,
      mime: (r.mime as string) ?? null,
      createdAt: r.created_at as string,
      url: signed?.signedUrl ?? null,
    })
  }
  return { ok: true, items: out }
}

/**
 * 브라우저가 Storage 업로드를 끝낸 뒤 메타데이터를 기록한다.
 * 파일 바이트는 서버 액션으로 넘어오지 않는다 — 본문 상한(1MB/4.5MB)에 걸린다.
 */
export async function recordIssueAttachment(
  issueId: string,
  file: { fileName: string; filePath: string; size: number; mime: string },
): Promise<{ ok: boolean; error?: string }> {
  const g = await requireIssueEditable(issueId)
  if (!g.ok) return { ok: false, error: g.error }

  // 이게 없으면 편집 권한이 있는 이슈 하나로 임의 경로의 객체를 메타에 꽂을 수 있다.
  // 기존 recordAttachment 에는 없는 검증이다 — 선례를 따르는 게 아니라 선례의 구멍을 메운다.
  if (!isIssueAttachmentPathValid(issueId, file.filePath)) {
    return { ok: false, error: '첨부 경로가 올바르지 않습니다.' }
  }
  if (!isIssueAttachmentSizeAllowed(file.size)) {
    return { ok: false, error: '파일 크기가 상한을 넘었습니다.' }
  }

  const sb = await createServerClient()
  const { data: existing, error: countErr } = await sb
    .from('issue_attachments').select('id').eq('issue_id', issueId)
  if (countErr || !existing) {
    // 개수를 모르면 통과시키지 않는다(쓰기 전 선행 조회 실패는 중단).
    console.error('[recordIssueAttachment] 기존 첨부 개수 조회 실패:', countErr?.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (remainingIssueAttachmentSlots(existing.length) < 1) {
    return { ok: false, error: `첨부는 이슈당 ${ISSUE_ATTACHMENT_MAX_COUNT}개까지입니다.` }
  }

  // project_id 는 클라이언트가 보내는 값이 아니라 게이트가 이슈에서 확정한 값이다.
  const { error } = await sb.from('issue_attachments').insert({
    issue_id: issueId,
    project_id: g.projectId,
    file_name: file.fileName,
    file_path: file.filePath,
    size: file.size,
    mime: file.mime,
    uploaded_by: g.userId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${g.projectId}/issues`)
  return { ok: true }
}

/** 첨부 삭제(Storage 객체 + 메타). */
export async function removeIssueAttachment(id: string): Promise<{ ok: boolean; error?: string }> {
  const sb = await createServerClient()
  // 어느 이슈의 첨부인지 모르면 권한을 판정할 수 없다 — 조회 실패를 '없음'으로 위장하지 않는다.
  const { data: att, error: attErr } = await sb
    .from('issue_attachments').select('id, file_path, issue_id').eq('id', id).maybeSingle()
  if (attErr) {
    console.error('[removeIssueAttachment] 첨부 조회 실패:', attErr.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!att) return { ok: false, error: '첨부 없음' }

  const g = await requireIssueEditable(att.issue_id as string)
  if (!g.ok) return { ok: false, error: g.error }

  // Storage 를 먼저 지운다 — 반대로 하면 메타를 잃은 객체를 다시 찾을 수 없다.
  // remove() 는 아무것도 지우지 못해도 error 가 null 이라 성공 여부를 판정할 수 없다.
  // 대신 멱등이라 재실행이 안전하므로, 감지에 기대지 않고 메타 삭제로 진행한다.
  await sb.storage.from(BUCKET).remove([att.file_path as string])
  // .select() 로 실제 지워진 행을 확인한다 — supabase-js 는 RLS 거부·경합으로 0행이 지워져도
  // error 를 주지 않는다. 그대로 ok 를 반환하면 객체는 사라졌는데 메타는 남아
  // 목록에 영구히 죽은 링크가 뜨고 사용자에게는 '삭제 완료'로 보인다.
  const { data: gone, error } = await sb
    .from('issue_attachments').delete().eq('id', id).select('id').maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!gone) {
    console.error('[removeIssueAttachment] 메타 행이 지워지지 않았습니다:', id)
    return { ok: false, error: '첨부 삭제에 실패했습니다.' }
  }
  revalidatePath(`/p/${g.projectId}/issues`)
  return { ok: true }
}
