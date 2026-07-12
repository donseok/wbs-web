'use server'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { displayNameFrom } from '@/lib/domain/display-name'
import { validateMinuteInput, isMinuteFilePathValid, type MinuteInput } from '@/lib/domain/minutes'
import { getMinuteDetail, getMinutesPage, searchMinutes } from '@/lib/data/minutes'
import type { Minute, TeamCode } from '@/lib/domain/types'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { ingestMinute } from '@/lib/ai/minutes-ingest'
import { splitMinuteBlocks, isMarkableBlock, fnv1a64 } from '@/lib/minutes/blocks'
import { ensureMinuteInsights, generateMinuteInsights } from '@/lib/ai/minutes-insights'
import { rematchHighlights, type HighlightRow } from '@/lib/minutes/rematch'
import { createAdminClient } from '@/lib/supabase/admin'

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

/** 본문 교체 후 하이라이트 재배정 — 실패는 로그만(표시 규칙이 오표시를 차단). service_role. */
async function rematchMinuteHighlights(minuteId: string, newBodyMd: string): Promise<void> {
  try {
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return
    const admin = createAdminClient()
    const { data: rows } = await admin.from('minute_highlights')
      .select('id, created_by, created_by_name, block_index, block_hash, created_at')
      .eq('minute_id', minuteId)
    if (!rows || rows.length === 0) return
    const { reinserts, deleteIds } = rematchHighlights(rows as unknown as HighlightRow[], splitMinuteBlocks(newBodyMd))
    if (deleteIds.length === 0 && reinserts.length === 0) return
    // delete 선실행 → insert — unique (minute_id, created_by, block_index) 충돌 원천 차단(스펙 §5)
    if (deleteIds.length) {
      const { error } = await admin.from('minute_highlights').delete().in('id', deleteIds)
      if (error) { console.error('[minutes] 재매칭 삭제 실패:', error.message); return }
    }
    if (reinserts.length) {
      const { error } = await admin.from('minute_highlights').insert(
        reinserts.map(r => ({ ...r, minute_id: minuteId })),
      )
      if (error) console.error('[minutes] 재매칭 삽입 실패:', error.message)
    }
  } catch (e) {
    console.error('[minutes] 재매칭 실패(무시):', e instanceof Error ? e.message : e)
  }
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
  revalidatePath('/minutes')
  after(async () => {
    await ingestMinute(data.id as string, input.bodyMd)
    await generateMinuteInsights(data.id as string, input.bodyMd)
  })
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
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  // ① 하이라이트 재매칭(delete→reinsert, service_role) → ② 재인제스트 → ③ 인사이트 재생성 — 스펙 §4.2
  after(async () => {
    await rematchMinuteHighlights(id, bodyMd)
    await ingestMinute(id, bodyMd)
    await generateMinuteInsights(id, bodyMd)
  })
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

/** 월 이동 시 클라이언트 호출용. */
export async function fetchMinutesRange(
  rangeStart: string, rangeEnd: string, team: TeamCode | null,
): Promise<Minute[]> {
  const user = await getSession()
  if (!user) return []
  return getMinutesPage(rangeStart, rangeEnd, team)
}

/** 검색 입력 시 클라이언트 호출용(전 기간, 100건 캡). */
export async function fetchMinutesSearch(q: string, team: TeamCode | null): Promise<Minute[]> {
  const user = await getSession()
  if (!user) return []
  return searchMinutes(q, team, 100)
}

/** 블록 하이라이트 토글 — 스펙 §6.7. 서버가 현재 본문 기준으로 (인덱스, 해시) 재검증. */
export async function toggleMinuteHighlight(
  minuteId: string, blockIndex: number, blockHash: string,
): Promise<{ ok: boolean; on?: boolean; error?: string }> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: minute } = await sb.from('minutes').select('body_md').eq('id', minuteId).maybeSingle()
  if (!minute) return { ok: false, error: '회의록을 찾을 수 없습니다.' }
  const blocks = splitMinuteBlocks(minute.body_md as string)
  const block = blocks[blockIndex]
  if (!block || !isMarkableBlock(block) || block.hash !== blockHash)
    return { ok: false, error: '본문이 변경되었습니다. 새로고침 해주세요.' }

  const { data: existing } = await sb.from('minute_highlights')
    .select('id, block_hash').eq('minute_id', minuteId)
    .eq('created_by', user.id).eq('block_index', blockIndex).maybeSingle()

  if (existing && (existing.block_hash as string) === blockHash) {
    // 끄기
    const { error } = await sb.from('minute_highlights').delete().eq('id', existing.id as string)
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/minutes/${minuteId}`)
    return { ok: true, on: false }
  }
  if (existing) {
    // stale 행(재매칭 실패 잔존, 해시 불일치) — 지우고 새로 켠다(스펙 §6.7)
    await sb.from('minute_highlights').delete().eq('id', existing.id as string)
  }
  const { error } = await sb.from('minute_highlights').insert({
    minute_id: minuteId, block_index: blockIndex, block_hash: blockHash,
    created_by: user.id, created_by_name: displayNameFrom(user.user_metadata, user.email),
  })
  // 동시 토글 경합: unique 위반은 "이미 하이라이트됨"으로 멱등 처리
  if (error && error.code !== '23505') return { ok: false, error: error.message }
  revalidatePath(`/minutes/${minuteId}`)
  return { ok: true, on: true }
}

/** 요약 카드 self-heal 트리거 — 스펙 §4.3. 멤버십 게이트(무료 쿼터 보호). */
export async function ensureMinuteInsightsAction(
  minuteId: string,
): Promise<{ status: 'ready' | 'generated' | 'unavailable' }> {
  const m = await getMembership()
  if (!m) return { status: 'unavailable' }
  const user = await getSession()
  if (!user) return { status: 'unavailable' }
  const sb = await createServerClient()
  const { data: minute } = await sb.from('minutes').select('body_md').eq('id', minuteId).maybeSingle()
  if (!minute) return { status: 'unavailable' }
  const bodyMd = minute.body_md as string
  if (!bodyMd.trim()) return { status: 'ready' }
  const status = await ensureMinuteInsights(minuteId, bodyMd, fnv1a64(bodyMd))
  if (status === 'generated') revalidatePath(`/minutes/${minuteId}`)
  return { status }
}
