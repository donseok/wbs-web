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
  if (error) {
    // PostgREST 는 error.message 에 제약/테이블 이름을 실어 보낸다. MinutesView 가 그 문자열을
    // 토스트로 그대로 렌더하므로, 알려진 SQLSTATE 는 사용자 메시지로 매핑해 스키마 세부가 새지 않게 한다.
    //
    // 23505 = unique_violation (minutes_file_path_key). 두 경우가 여기로 온다:
    //  (1) 같은 업로드를 두 번 제출 — 등록 버튼 더블클릭. minutesStoragePath() 의 타임스탬프는
    //      서로 다른 업로드끼리만 구별해 주지, 한 업로드를 두 번 보내는 것은 막지 못한다.
    //  (2) 남의 file_path 를 가리키려는 위조 — UNIQUE 가 그 별칭을 차단한다.
    // 사용자 메시지는 둘 다에 맞다.
    if (error.code === '23505') return { ok: false, error: '이미 등록된 파일입니다.' }
    // 23514 = check_violation (minutes_title_len·minutes_md_only 등). 앱 검증을 앞에 두었지만
    // 경합/우회로 DB 까지 닿으면 여기서 일반 메시지로 막는다.
    if (error.code === '23514') return { ok: false, error: '입력 값이 올바르지 않습니다.' }
    // 42501 = insufficient_privilege (insert_minutes RLS 거부).
    if (error.code === '42501') return { ok: false, error: '권한이 없습니다.' }
    // 22P02 = invalid_text_representation (잘못된 uuid 등).
    if (error.code === '22P02') return { ok: false, error: '잘못된 요청입니다.' }
    // 그 밖은 진짜 예상 밖 — 삼키기보다 드러낸다.
    return { ok: false, error: error.message }
  }

  revalidateMinutes(projectId)
  return { ok: true, id: data.id as string }
}

/**
 * 삭제 — Storage 객체 제거 **후** 메타 삭제.
 *
 * 이 순서는 이제 선호가 아니라 필수다. 스토리지 삭제 정책이
 *   exists (select 1 from meeting_minutes mm where mm.file_path = storage.objects.name
 *           and (mm.created_by = auth.uid() or app_role() = 'pmo_admin'))
 * 로 행 삭제 권한을 그대로 미러링하므로, 행을 먼저 지우면 EXISTS 가 거짓이 되어
 * 객체 삭제가 거부되고 아무도 참조하지 않는 고아 객체가 영구히 남는다.
 * 반대로 객체를 먼저 지우고 행 삭제가 실패하면 "깨진 링크 행"이 남지만,
 * remove() 는 없는 키에 멱등이므로(측정 확인) 사용자가 다시 삭제하면 복구된다.
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

  // rmErr 이 잡는 것: 전송 실패와 비-2xx 응답. storage-js 는 `!result.ok` 일 때만 error 를
  // 만든다(storage-js/dist/index.mjs:361). 그 외에는 언제나 error:null 이다.
  // rmErr 이 구별하지 못하는 것: "RLS 거부"와 "객체가 원래 없음". remove() 는 벌크 엔드포인트
  // (DELETE /object/{bucket}, body {prefixes})를 부르는데(index.mjs:1363-1368), 둘 다
  // 200 + data:[] + error:null 로 온다(실측: 삭제 정책이 없는 anon 키로도 200 + []).
  //
  // 그런데 이 지점에서는 거부가 일어날 수 없다. 스토리지 삭제 정책의 EXISTS 절이
  // canDeleteMinutes 와 같은 식이고, 그 EXISTS 가 보는 행은 아직 지워지지 않았기 때문이다
  // (그래서 객체를 먼저 지운다 — 위 주석 참조). 따라서 여기서 data:[] 는 "객체가 이미 없다"는
  // 뜻뿐이고, 그건 사용자가 재시도로 정리하는 깨진 링크 행 상태다. 행 삭제를 막지 않는다.
  const { error: rmErr } = await sb.storage.from(BUCKET).remove([cur.file_path as string])
  if (rmErr) return { ok: false, error: `파일 삭제 실패: ${rmErr.message}` }

  const { error } = await sb.from('meeting_minutes').delete().eq('id', id).select('id').single()
  if (error) {
    // 객체는 이미 지워졌는데 행 삭제가 실패했다 — 깨진 링크 행이 남는다.
    // PGRST116 = 단수 표현(.single())에 0행. PK 조회라 "2행 이상"은 불가능하므로 항상 0행이다.
    // (실측: PostgREST 406 + {"code":"PGRST116","details":"The result contains 0 rows"})
    // remove() 는 없는 키에 멱등이므로 사용자가 다시 삭제하면 복구된다.
    if (error.code === 'PGRST116') return { ok: false, error: '회의록 기록을 삭제하지 못했습니다. 다시 시도해 주세요.' }
    return { ok: false, error: error.message }
  }

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
