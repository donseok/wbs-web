'use server'
// 이슈 조치/해결 경과 이력 — 등록·조회·취소선·완전삭제.
//
// issues.ts 와 파일을 가르는 이유: 상세 모달·이슈 액션 테스트의 mock 표면을 늘리지 않기
// 위해서다. 저 파일에 심볼을 더하면 통모킹한 테스트들이 함께 흔들린다.
//
// 이 파일은 'use server' 다 — export 하는 순간 브라우저에서 호출 가능한 엔드포인트가 된다.
// 게이트·헬퍼는 절대 export 하지 않는다.
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { ERR_LOOKUP } from '@/lib/authz/errors'
import { displayNameFrom } from '@/lib/domain/display-name'
import {
  ISSUE_UPDATE_BODY_MAX,
  isIssueUpdateCategory,
  type IssueUpdate,
  type IssueUpdateCategory,
} from '@/lib/domain/issueUpdates'
import { createServerClient } from '@/lib/supabase/server'

export type IssueUpdateListResult =
  | { ok: true; items: IssueUpdate[] }
  | { ok: false; error: string }

/** partial 은 "이력은 남았지만 뒷단 일부가 실패" — 성공으로 뭉개지 않고 화면에 고지한다. */
export type IssueUpdateResult =
  | { ok: true; partial?: string }
  | { ok: false; error: string }

const NAME_FALLBACK = '(이름 없음)'

/**
 * 이력 쓰기 게이트 — 그 이슈가 속한 프로젝트의 멤버. '진행 저장'과 같은 등급이다.
 * isAdmin 을 함께 돌려주는 이유: 취소선·완전삭제 판정이 같은 왕복 안에서 끝나야
 * 액션마다 requireProjectAdmin 을 또 부르지 않는다.
 */
async function requireIssueMember(issueId: string): Promise<
  { ok: true; projectId: string; userId: string; isAdmin: boolean } | { ok: false; error: string }
> {
  const found = await resolveProjectId('issues', issueId)
  if (!found.ok) return { ok: false, error: found.error }
  // issues.project_id 는 not null 이지만 타입이 nullable 이다. null 이면 이력의 not null
  // 컬럼을 채울 수 없으므로 '권한 없음'이 아니라 중단한다(에러 3원칙 ②).
  if (!found.projectId) {
    console.error('[issueUpdates] 이슈의 프로젝트를 확정하지 못했습니다:', issueId)
    return { ok: false, error: ERR_LOOKUP }
  }
  const projectId = found.projectId
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = await requireProjectAdmin(projectId)
  return { ok: true, projectId, userId: g.actor.userId, isAdmin: admin.ok }
}

/**
 * issues.resolution_note 파생 미러 재계산 — 최신 '살아있는' note 본문을 부모에 복사한다.
 *
 * "방금 쓴 body 복사"가 아니라 재계산인 이유는 셋이다.
 *   (1) 취소선·완전삭제 뒤에도 미러가 맞아야 한다. 안 그러면 화면에서 지운 문장을
 *       AI RAG(ai/index/content.ts:290)가 계속 인용한다.
 *   (2) 동시 등록 경합을 흡수한다.
 *   (3) 이력이 0건이면 빈 문자열이어야 한다 — NULL 은 0041:38 NOT NULL 위반(23502)이다.
 *
 * updated_at 을 함께 미는 것은 필수다. issues 엔 updated_at 트리거가 없고(0041:14-15),
 * 안 밀면 0031:172-176 의 신선도 게이트가 재색인을 return 0 으로 스킵한다.
 *
 * payload 에 이 두 키 말고는 절대 넣지 않는다 — major_id 가 섞이면 0062:202
 * ISSUE_MAJOR_UNSET_FORBIDDEN 으로 터진다. 트리거는 동일값 rewrite 를 통과시키므로
 * DB 가 이 규칙을 지켜주지 않는다.
 *
 * 반환: 성공이면 null, 실패면 사유 문자열(replaceAssignees 관례).
 */
async function syncResolutionNoteMirror(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  issueId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from('issue_updates')
    .select('body')
    .eq('issue_id', issueId)
    .eq('kind', 'note')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
  if (error) {
    console.error('[issueUpdates] 미러 재계산용 조회 실패:', error.message)
    return error.message
  }
  const latest = (data?.[0]?.body as string | undefined) ?? ''

  const { data: updated, error: upErr } = await sb
    .from('issues')
    .update({ resolution_note: latest, updated_at: new Date().toISOString() })
    .eq('id', issueId)
    .select('id')
  if (upErr) {
    console.error('[issueUpdates] 미러 갱신 실패:', upErr.message)
    return upErr.message
  }
  if (!updated?.length) {
    console.error('[issueUpdates] 미러 갱신이 0행입니다:', issueId)
    return '이슈를 찾을 수 없습니다.'
  }
  return null
}

function mapRow(r: Record<string, unknown>): IssueUpdate {
  return {
    id: r.id as string,
    issueId: r.issue_id as string,
    kind: r.kind as IssueUpdate['kind'],
    category: (r.category as IssueUpdateCategory | null) ?? null,
    body: r.body as string,
    mentionedMemberIds: (r.mentioned_member_ids as string[] | null) ?? [],
    authorUserId: (r.author_user_id as string | null) ?? null,
    authorName: r.author_name as string,
    createdAt: r.created_at as string,
    archivedAt: (r.archived_at as string | null) ?? null,
    archivedByName: (r.archived_by_name as string | null) ?? null,
  }
}

/**
 * 이력 목록(오래된 순). 조회는 로그인 사용자 전체에 열려 있다(이슈 본문·첨부와 동일).
 *
 * 빈 배열이 아니라 에러 채널을 둔 이유: 여기서 실패를 [] 로 뭉개면 사용자는 "아무도 아무
 * 조치도 안 했다"고 읽는다. 조치 이력이 사라진 것처럼 보이는 것이 최악이다(에러 3원칙 ①).
 */
export async function listIssueUpdates(issueId: string): Promise<IssueUpdateListResult> {
  if (!(await getSession())) {
    console.error('[listIssueUpdates] 비로그인 호출')
    return { ok: false, error: '로그인 필요' }
  }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('issue_updates')
    .select('id, issue_id, kind, category, body, mentioned_member_ids, author_user_id, author_name, created_at, archived_at, archived_by_name')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) {
    console.error('[listIssueUpdates] 이력 조회 실패:', error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  return { ok: true, items: (data ?? []).map(mapRow) }
}

/** 이력 등록 — 프로젝트 멤버. kind 는 보내지 않는다(컬럼 grant 밖이라 42501 이 된다). */
export async function addIssueUpdate(
  issueId: string,
  input: { body: string; category: IssueUpdateCategory | null; mentionedMemberIds: string[] },
): Promise<IssueUpdateResult> {
  const g = await requireIssueMember(issueId)
  if (!g.ok) return { ok: false, error: g.error }

  const body = input.body.trim()
  if (body.length === 0) return { ok: false, error: '내용을 입력하세요.' }
  if (body.length > ISSUE_UPDATE_BODY_MAX) {
    return { ok: false, error: `내용은 ${ISSUE_UPDATE_BODY_MAX}자 이하여야 합니다.` }
  }
  if (input.category !== null && !isIssueUpdateCategory(input.category)) {
    return { ok: false, error: '알 수 없는 분류입니다.' }
  }

  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()

  // 멘션 대상 선행 검증 — uuid[] 컬럼이라 FK 를 걸 수 없다(replaceAssignees 와 같은 처리).
  // 남의 프로젝트 멤버 id 를 꽂아 알림을 보내는 경로를 여기서 끊는다.
  let mentioned: string[] = []
  if (input.mentionedMemberIds.length > 0) {
    const { data, error } = await sb
      .from('project_members')
      .select('id')
      .in('id', input.mentionedMemberIds)
      .eq('project_id', g.projectId)
    if (error) {
      console.error('[addIssueUpdate] 멘션 대상 검증 실패:', error.message)
      return { ok: false, error: ERR_LOOKUP }
    }
    mentioned = (data ?? []).map((r: { id: string }) => r.id)
  }

  const { data: inserted, error } = await sb
    .from('issue_updates')
    .insert({
      issue_id: issueId,
      project_id: g.projectId,
      category: input.category,
      body,
      mentioned_member_ids: mentioned,
      author_user_id: user.id,
      author_name: displayNameFrom(user.user_metadata, user.email) ?? NAME_FALLBACK,
    })
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!inserted) {
    console.error('[addIssueUpdate] 이력 INSERT 가 0행입니다:', issueId)
    return { ok: false, error: '이력 저장에 실패했습니다.' }
  }

  const mirrorErr = await syncResolutionNoteMirror(sb, issueId)
  revalidatePath(`/p/${g.projectId}/issues`)
  if (mirrorErr) {
    return { ok: true, partial: `이력은 저장됐지만 요약 반영에 실패했습니다(${mirrorErr}).` }
  }
  return { ok: true }
}
