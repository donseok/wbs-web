'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { displayNameFrom } from '@/lib/domain/display-name'
import { validateMinuteInput, isMinuteFilePathValid, type MinuteInput } from '@/lib/domain/minutes'
import { getMinuteDetail } from '@/lib/data/minutes'
import { getProjectMeetingData } from '@/lib/data/meetings'

const BUCKET = 'minutes'

export interface MinuteActionResult { ok: boolean; error?: string; id?: string }

type Sb = Awaited<ReturnType<typeof createServerClient>>

/** 소유권 사전 확인 — RLS 0행 침묵 실패 방지. 반환: 에러 메시지 또는 null. */
async function checkOwner(sb: Sb, minuteId: string, userId: string, role: string): Promise<string | null> {
  const { data } = await sb.from('minutes').select('created_by').eq('id', minuteId).maybeSingle()
  if (!data) return '회의록을 찾을 수 없습니다.'
  if ((data.created_by as string | null) !== userId && role !== 'pmo_admin') return '권한 없음'
  return null
}

export async function createMinute(input: MinuteInput): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const err = validateMinuteInput(input)
  if (err) return { ok: false, error: err }
  const sb = await createServerClient()
  if (input.meetingId) {
    const { data: mt } = await sb.from('meetings').select('id').eq('id', input.meetingId).maybeSingle()
    if (!mt) return { ok: false, error: '연결할 회의를 찾을 수 없습니다.' }
  }
  const { data, error } = await sb.from('minutes').insert({
    minute_date: input.minuteDate, team_code: input.teamCode, title: input.title.trim(),
    body_md: input.bodyMd, meeting_id: input.meetingId,
    created_by: user.id, created_by_name: displayNameFrom(user.user_metadata, user.email),
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  // [P2] after(() => ingestMinute(data.id as string, input.bodyMd)) — Task 13에서 배선
  revalidatePath('/minutes')
  return { ok: true, id: data.id as string }
}

export async function updateMinuteMeta(
  id: string, patch: Omit<MinuteInput, 'bodyMd'>,
): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const err = validateMinuteInput({ ...patch, bodyMd: '' })
  if (err) return { ok: false, error: err }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, user.id, m.role)
  if (own) return { ok: false, error: own }
  if (patch.meetingId) {
    const { data: mt } = await sb.from('meetings').select('id').eq('id', patch.meetingId).maybeSingle()
    if (!mt) return { ok: false, error: '연결할 회의를 찾을 수 없습니다.' }
  }
  const { error } = await sb.from('minutes').update({
    minute_date: patch.minuteDate, team_code: patch.teamCode, title: patch.title.trim(),
    meeting_id: patch.meetingId, updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  return { ok: true }
}

/** 본문 교체 — 클라이언트가 새 .md 를 Storage 업로드한 뒤 호출. 기존 body 파일 0건 허용(복구 경로). */
export async function replaceMinuteBody(
  id: string, bodyMd: string,
  file: { fileName: string; filePath: string; size: number; mime: string },
): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (bodyMd.length > 100_000) return { ok: false, error: '본문은 100,000자 이하여야 합니다.' }
  if (!isMinuteFilePathValid(id, file.filePath)) return { ok: false, error: '잘못된 파일 경로입니다.' }
  if (!/\.(md|markdown)$/i.test(file.fileName)) return { ok: false, error: '.md 파일만 가능합니다.' }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, user.id, m.role)
  if (own) return { ok: false, error: own }
  // 기존 body 파일 경로는 DB에서 해석(클라이언트 신뢰 안 함) — 소유권 확인 후에만 Storage 삭제
  const { data: old } = await sb.from('minute_files')
    .select('id, file_path').eq('minute_id', id).eq('role', 'body').maybeSingle()
  if (old) {
    await sb.storage.from(BUCKET).remove([old.file_path as string])
    await sb.from('minute_files').delete().eq('id', old.id as string)
  }
  const { error: insErr } = await sb.from('minute_files').insert({
    minute_id: id, role: 'body', file_name: file.fileName, file_path: file.filePath,
    size: file.size, mime: file.mime, uploaded_by: user.id,
  })
  if (insErr) return { ok: false, error: insErr.message }
  const { error } = await sb.from('minutes')
    .update({ body_md: bodyMd, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  // [P2] after(() => ingestMinute(id, bodyMd)) — Task 13에서 배선
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  return { ok: true }
}

/** 클라이언트 Storage 업로드 후 메타 기록. file_path 는 {minuteId}/ 접두 강제. */
export async function recordMinuteFile(
  minuteId: string,
  file: { role: 'body' | 'attachment'; fileName: string; filePath: string; size: number; mime: string },
): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (!isMinuteFilePathValid(minuteId, file.filePath)) return { ok: false, error: '잘못된 파일 경로입니다.' }
  if (file.role === 'body' && !/\.(md|markdown)$/i.test(file.fileName))
    return { ok: false, error: '.md 파일만 가능합니다.' }
  const sb = await createServerClient()
  const own = await checkOwner(sb, minuteId, user.id, m.role)
  if (own) return { ok: false, error: own }
  const { error } = await sb.from('minute_files').insert({
    minute_id: minuteId, role: file.role, file_name: file.fileName, file_path: file.filePath,
    size: file.size, mime: file.mime, uploaded_by: user.id,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/minutes/${minuteId}`)
  return { ok: true }
}

/** 첨부 삭제(role='attachment' 전용 — body 는 replaceMinuteBody 로만). 경로는 DB 해석. */
export async function removeMinuteFile(fileId: string): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: f } = await sb.from('minute_files')
    .select('id, minute_id, role, file_path').eq('id', fileId).maybeSingle()
  if (!f) return { ok: false, error: '파일 없음' }
  if ((f.role as string) === 'body') return { ok: false, error: '본문 파일은 교체로만 변경할 수 있습니다.' }
  const own = await checkOwner(sb, f.minute_id as string, user.id, m.role)
  if (own) return { ok: false, error: own }
  await sb.storage.from(BUCKET).remove([f.file_path as string])
  const { error } = await sb.from('minute_files').delete().eq('id', fileId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/minutes/${f.minute_id as string}`)
  return { ok: true }
}

export async function deleteMinute(id: string): Promise<MinuteActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, user.id, m.role)
  if (own) return { ok: false, error: own }
  const { data: fs } = await sb.from('minute_files').select('file_path').eq('minute_id', id)
  const paths = (fs ?? []).map(f => f.file_path as string)
  if (paths.length) await sb.storage.from(BUCKET).remove(paths)
  const { error } = await sb.from('minutes').delete().eq('id', id).select('id').single()
  if (error) return { ok: false, error: error.message }
  revalidatePath('/minutes')
  return { ok: true }
}

/** 뷰어 새로고침용 얇은 래퍼 — 세션 게이트 후 위임. */
export async function fetchMinuteDetail(id: string) {
  const user = await getSession()
  if (!user) return null
  return getMinuteDetail(id)
}

/** 다운로드 클릭 시 서명 URL 발급(3600초). */
export async function getMinuteFileUrl(fileId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: f } = await sb.from('minute_files').select('file_path').eq('id', fileId).maybeSingle()
  if (!f) return { ok: false, error: '파일 없음' }
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(f.file_path as string, 3600)
  if (!signed?.signedUrl) return { ok: false, error: 'URL 발급 실패' }
  return { ok: true, url: signed.signedUrl }
}

/** 업로드 모달의 회의 연결 드롭다운용 — 프로젝트 회의 목록(가벼운 필드만). */
export async function fetchProjectMeetingsLite(
  projectId: string,
): Promise<{ id: string; title: string; meetingDate: string }[]> {
  const user = await getSession()
  if (!user) return []
  const { meetings } = await getProjectMeetingData(projectId)
  return meetings.map(mt => ({ id: mt.id, title: mt.title, meetingDate: mt.meetingDate }))
}
