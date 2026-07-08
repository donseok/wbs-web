'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { canCreateMinutes, canDeleteMinutes, isMarkdownFile, validateMinutesInput } from '@/lib/domain/minutes'

const BUCKET = 'minutes'
/** 서명 URL 유효시간(초). attachments.ts 와 동일. */
const SIGNED_TTL = 3600

export interface MinutesFile {
  fileName: string
  filePath: string
  size: number
  mime: string
}

export interface MinutesInput {
  teamId: string
  minutesDate: string // 'YYYY-MM-DD'
  title: string
  contentMd: string | null // .md 만. 비-md 는 null
}

export interface MinutesActionResult {
  ok: boolean
  error?: string
  id?: string
}

function revalidateMinutes(projectId: string) {
  revalidatePath(`/p/${projectId}/minutes`)
}

/**
 * 클라이언트가 Storage 업로드를 끝낸 뒤 메타 기록. attachments.recordAttachment 와 동일 계약.
 * 게이트(권한·검증)를 전부 통과한 뒤에야 DB 클라이언트를 만든다.
 */
export async function createMinutes(
  projectId: string,
  input: MinutesInput,
  file: MinutesFile,
): Promise<MinutesActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  if (!canCreateMinutes(m, input.teamId)) return { ok: false, error: '담당 팀이 아닙니다.' }

  const err = validateMinutesInput(input)
  if (err) return { ok: false, error: err }

  // file.filePath 는 Storage 객체 키로 그대로 쓰이고 행에 영구 저장된다. 접두사를 강제하지 않으면
  // 호출자가 다른 프로젝트/팀 폴더를 가리키는 filePath 를 실어 보낼 수 있다 — Storage 정책은
  // bucket_id 만 검사하므로(0019 주석) DB 상 row 는 "내 프로젝트"라도 file_path 는 남의 객체를
  // 가리킬 수 있고, 이후 deleteMinutes 가 그 객체를 지워버리는 크로스 테넌트 삭제로 이어진다.
  // minutesStoragePath() 가 생성하는 형식(`${projectId}/${teamId}/...`)을 여기서 그대로 강제한다.
  if (!file.filePath.startsWith(`${projectId}/${input.teamId}/`)) {
    return { ok: false, error: '파일 경로가 올바르지 않습니다.' }
  }

  // DB 의 minutes_md_only 체크제약(file_path ~* '\.(md|markdown)$')을 앱에서 먼저 강제 —
  // 위반 시 Postgres 에러 문자열이 새는 걸 막는다. fileName 이 아니라 filePath 를 검사한다:
  // 둘은 호출자가 각각 통제하는 별개 문자열이고, DB 가 실제로 검사하는 건 filePath 뿐이다.
  // fileName 을 검사하면 fileName:'a.md' + filePath:'x/y/evil.exe' 조합이 여기를 통과해
  // insert 단계에서야 체크제약 위반으로 실패한다(원시 Postgres 에러 노출).
  if (input.contentMd !== null && !isMarkdownFile(file.filePath)) {
    return { ok: false, error: '마크다운 파일이 아닌데 본문이 전달되었습니다.' }
  }

  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  // 표시용 이름 — auth.ts:getDisplayName() 과 동일 로직(계정 생성 시 저장되는 키는 full_name;
  // accounts.ts:66 참조). meetings.ts:createMeeting 은 존재하지 않는 `name` 키를 읽어 항상
  // 이메일 전체로 폴백하는 구 버그가 있다 — 여기서는 반복하지 않는다.
  const full = (user.user_metadata?.full_name as string | undefined)?.trim()
  const { data, error } = await sb
    .from('meeting_minutes')
    .insert({
      project_id: projectId,
      team_id: input.teamId,
      minutes_date: input.minutesDate,
      title: input.title.trim(),
      file_path: file.filePath,
      file_name: file.fileName,
      size: file.size,
      mime: file.mime,
      content_md: input.contentMd,
      created_by: user.id,
      created_by_name: full || user.email?.split('@')[0] || null,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  revalidateMinutes(projectId)
  return { ok: true, id: data.id as string }
}

/**
 * 삭제 — Storage 객체 제거 후 메타 삭제 (attachments.removeAttachment 순서 그대로).
 * 객체가 먼저 사라지고 행 삭제가 실패하면 "깨진 링크 행"이 남지만,
 * 반대 순서는 "영구 고아 객체"를 남긴다. 레포는 전자를 택했다.
 */
export async function deleteMinutes(id: string): Promise<MinutesActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  // RLS 가 막은 DELETE 는 0행 무음 성공이므로 소유권을 먼저 확인한다.
  const { data: cur } = await sb
    .from('meeting_minutes')
    .select('project_id, file_path, created_by')
    .eq('id', id)
    .maybeSingle()
  if (!cur) return { ok: false, error: '회의록을 찾을 수 없습니다.' }
  if (!canDeleteMinutes({ createdBy: (cur.created_by as string | null) ?? null }, user.id, m.role)) {
    return { ok: false, error: '권한 없음' }
  }

  await sb.storage.from(BUCKET).remove([cur.file_path as string])
  const { error } = await sb.from('meeting_minutes').delete().eq('id', id).select('id').single()
  if (error) return { ok: false, error: error.message }

  revalidateMinutes(cur.project_id as string)
  return { ok: true }
}

/**
 * 다운로드용 서명 URL — 단건 발급.
 * 목록에서는 절대 부르지 말 것: attachments.listAttachments 처럼 행마다 발급하면 N 라운드트립이 된다.
 */
export async function getMinutesFileUrl(id: string): Promise<{ url: string | null }> {
  const user = await getSession()
  if (!user) return { url: null }
  const sb = await createServerClient()
  const { data: row } = await sb.from('meeting_minutes').select('file_path').eq('id', id).maybeSingle()
  if (!row) return { url: null }
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(row.file_path as string, SIGNED_TTL)
  return { url: signed?.signedUrl ?? null }
}
