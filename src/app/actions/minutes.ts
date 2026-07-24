'use server'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { displayNameFrom } from '@/lib/domain/display-name'
import {
  validateMinuteInput, isMinuteFilePathValid, validateFolderName, folderDepthOf, MINUTE_FOLDER_DEPTH_MAX,
  isTeamRootName, isTeamSeedFolder,
  type MinuteInput,
} from '@/lib/domain/minutes'
import {
  getMinuteDetail, getMinuteFavorites, getMinutesExplorer, getMinutesPage, searchMinutes,
} from '@/lib/data/minutes'
import type { ExplorerData, Minute, MinuteFolder, TeamCode } from '@/lib/domain/types'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { ingestMinute } from '@/lib/ai/minutes-ingest'
import { splitMinuteBlocks, isMarkableBlock, fnv1a64 } from '@/lib/minutes/blocks'
import { ensureMinuteInsights, generateMinuteInsights } from '@/lib/ai/minutes-insights'
import { rematchHighlights, type HighlightRow } from '@/lib/minutes/rematch'
import { nextShareState, type ShareOp, type ShareState } from '@/lib/minutes/share'
import { createAdminClient } from '@/lib/supabase/admin'
import { correctMinuteBodyTime } from '@/lib/minutes/timeFix'
import { resolveTeamRootFolderId } from '@/lib/minutes/folders'

const BUCKET = 'minutes'

export interface MinuteActionResult {
  ok: boolean
  error?: string
  id?: string
  /** 녹취툴 시간대(+9h) 보정이 적용됐으면 보정 전/후 시각. UI 토스트용. */
  timeFix?: { from: string; to: string }
}

type Sb = Awaited<ReturnType<typeof createServerClient>>

/** 소유권 사전 확인 — RLS 0행 침묵 실패 방지. 반환: 에러 메시지 또는 null. */
async function checkOwner(sb: Sb, minuteId: string, userId: string, role: string): Promise<string | null> {
  const { data, error } = await sb.from('minutes').select('created_by').eq('id', minuteId).maybeSingle()
  // 보안 가드 조회 — 실패 시 소유자 판정 자체가 불가능하므로 거부(fail-closed).
  if (error) {
    console.error('[checkOwner] 소유권 조회 실패:', error.message)
    return '권한 확인에 실패했습니다. 잠시 후 다시 시도하세요.'
  }
  if (!data) return '회의록을 찾을 수 없습니다.'
  if ((data.created_by as string | null) !== userId && role !== 'pmo_admin') return '권한 없음'
  return null
}

/** 본문 교체 후 하이라이트 재배정 — 실패는 로그만(표시 규칙이 오표시를 차단). service_role. */
async function rematchMinuteHighlights(minuteId: string, newBodyMd: string): Promise<void> {
  try {
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return
    const admin = createAdminClient()
    const { data: rows, error: rowsErr } = await admin.from('minute_highlights')
      .select('id, created_by, created_by_name, block_index, block_hash, created_at')
      .eq('minute_id', minuteId)
    if (rowsErr) { console.error('[minutes] 재매칭 대상 하이라이트 조회 실패:', rowsErr.message); return }
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

export async function createMinute(
  input: MinuteInput, folderId: string | null = null,
): Promise<MinuteActionResult> {
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
  if (folderId) {
    const { data: fd } = await sb.from('minute_folders').select('id').eq('id', folderId).maybeSingle()
    if (!fd) return { ok: false, error: '폴더를 찾을 수 없습니다.' }
  }
  // 폴더 미지정이면 담당 팀 루트 폴더로 자동 편철(0043) — 부재·실패는 미분류(null) 폴백
  const effectiveFolderId = folderId ?? await resolveTeamRootFolderId(sb, input.teamCode)
  // 녹취툴 산출물이면 시간 줄 +9h(UTC→KST) 보정 — DB·다운스트림 전부 보정본 사용
  const fix = correctMinuteBodyTime(input.bodyMd)
  if (fix.corrected) console.info(`[minutes] 시간 보정 적용: ${fix.from} → ${fix.to} (${input.title.trim()})`)
  const bodyMd = fix.body
  const { data, error } = await sb.from('minutes').insert({
    minute_date: input.minuteDate, team_code: input.teamCode, title: input.title.trim(),
    body_md: bodyMd, meeting_id: input.meetingId, folder_id: effectiveFolderId,
    created_by: user.id, created_by_name: displayNameFrom(user.user_metadata, user.email),
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  revalidatePath('/minutes')
  after(async () => {
    await ingestMinute(data.id as string, bodyMd)
    await generateMinuteInsights(data.id as string, bodyMd)
  })
  return { ok: true, id: data.id as string, timeFix: fix.corrected ? { from: fix.from!, to: fix.to! } : undefined }
}

export async function updateMinuteMeta(
  id: string, patch: Omit<MinuteInput, 'bodyMd'>, folderId?: string,
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
  if (folderId) {
    const { data: fd } = await sb.from('minute_folders').select('id').eq('id', folderId).maybeSingle()
    if (!fd) return { ok: false, error: '폴더를 찾을 수 없습니다.' }
  }
  // folderId 미전달 = 폴더 무접촉(수동 편철 존중). 전달 시에만 하위 구분 변경으로 이동.
  const upd: Record<string, unknown> = {
    minute_date: patch.minuteDate, team_code: patch.teamCode, title: patch.title.trim(),
    meeting_id: patch.meetingId, updated_at: new Date().toISOString(),
  }
  if (folderId) upd.folder_id = folderId
  const { error } = await sb.from('minutes').update(upd).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  return { ok: true }
}

/** 폴더 전량(라이트) — 수정 모달의 하위 구분 초기화·편철용. 실패는 빈 배열(하위 구분 숨김). */
export async function fetchMinuteFoldersLite(): Promise<MinuteFolder[]> {
  const user = await getSession()
  if (!user) return []
  const sb = await createServerClient()
  return (await loadFolders(sb)) ?? []
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
  // 녹취툴 산출물이면 시간 줄 +9h(UTC→KST) 보정 — DB·재매칭·재인제스트 전부 보정본 사용
  const fix = correctMinuteBodyTime(bodyMd)
  if (fix.corrected) console.info(`[minutes] 본문 교체 시간 보정 적용: ${fix.from} → ${fix.to} (id=${id})`)
  const body = fix.body
  // 기존 body 파일 경로는 DB에서 해석(클라이언트 신뢰 안 함) — 소유권 확인 후에만 Storage 삭제
  const { data: old, error: oldErr } = await sb.from('minute_files')
    .select('id, file_path').eq('minute_id', id).eq('role', 'body').maybeSingle()
  // 삭제 대상 판단용 선행 조회 — 실패를 '기존 body 없음'으로 오인하면 아래 insert 로 role='body' 행이 2개가 되고,
  // 그 뒤로는 이 maybeSingle 이 항상 복수 행으로 실패하는 자기 강화 고장이 된다. 실패는 실패로 반환한다.
  if (oldErr) {
    console.error('[replaceMinuteBody] 기존 본문 파일 조회 실패:', oldErr.message)
    return { ok: false, error: oldErr.message }
  }
  if (old) {
    // 순서 고정: 메타 행 delete 를 먼저 한다. Storage 를 먼저 지우면 행 delete 실패 시
    // 행은 남고 그 file_path 가 가리키는 객체만 사라져 본문 다운로드가 영구히 깨진다(dangling pointer).
    // 행 delete 가 실패하면 Storage 는 손대지 않은 원상이므로 그대로 중단한다.
    const { error: delErr } = await sb.from('minute_files').delete().eq('id', old.id as string)
    if (delErr) {
      console.error('[replaceMinuteBody] 기존 본문 파일 메타 삭제 실패:', delErr.message)
      return { ok: false, error: delErr.message }
    }
    // 행이 사라진 뒤의 Storage 삭제 실패는 고아 파일만 남기므로 로그 후 진행.
    const { error: rmErr } = await sb.storage.from(BUCKET).remove([old.file_path as string])
    if (rmErr) console.error('[replaceMinuteBody] 기존 본문 파일 Storage 삭제 실패(고아 파일 잔존):', rmErr.message)
  }
  const { error: insErr } = await sb.from('minute_files').insert({
    minute_id: id, role: 'body', file_name: file.fileName, file_path: file.filePath,
    size: file.size, mime: file.mime, uploaded_by: user.id,
  })
  if (insErr) return { ok: false, error: insErr.message }
  const { error } = await sb.from('minutes')
    .update({ body_md: body, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  // ① 하이라이트 재매칭(delete→reinsert, service_role) → ② 재인제스트 → ③ 인사이트 재생성 — 스펙 §4.2
  after(async () => {
    await rematchMinuteHighlights(id, body)
    await ingestMinute(id, body)
    await generateMinuteInsights(id, body)
  })
  return { ok: true, timeFix: fix.corrected ? { from: fix.from!, to: fix.to! } : undefined }
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
  // Storage 삭제 실패는 고아 파일만 남기므로 로그 후 진행(메타 행 삭제는 계속한다).
  const { error: rmErr } = await sb.storage.from(BUCKET).remove([f.file_path as string])
  if (rmErr) console.error('[removeMinuteFile] Storage 삭제 실패(고아 파일 잔존):', rmErr.message)
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
  // 삭제 대상 파일 목록 조회 — 실패를 '첨부 0건'으로 오인한 채 minutes 행을 지우면
  // Storage 파일을 가리키는 유일한 포인터가 사라져 영구 고아가 된다. 실패 시 삭제를 중단한다.
  const { data: fs, error: fsErr } = await sb.from('minute_files').select('file_path').eq('minute_id', id)
  if (fsErr) {
    console.error('[deleteMinute] 첨부 파일 목록 조회 실패:', fsErr.message)
    return { ok: false, error: fsErr.message }
  }
  const paths = (fs ?? []).map(f => f.file_path as string)
  if (paths.length) {
    const { error: rmErr } = await sb.storage.from(BUCKET).remove(paths)
    if (rmErr) console.error('[deleteMinute] Storage 삭제 실패(고아 파일 잔존):', rmErr.message)
  }
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
  const { data: f } = await sb.from('minute_files').select('file_path, file_name').eq('id', fileId).maybeSingle()
  if (!f) return { ok: false, error: '파일 없음' }
  // download 지정 → Content-Disposition: attachment. 인라인 렌더 시 charset 미지정으로
  // 한글이 깨져 보이는 문제를 피하고, 원본 파일명으로 바로 내려받게 한다.
  const { data: signed } = await sb.storage.from(BUCKET)
    .createSignedUrl(f.file_path as string, 3600, { download: (f.file_name as string) || true })
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

/** 회의 상세 모달의 '연결된 회의록' 바로가기용 — 역방향 조회(회의 → 회의록). */
export async function fetchMeetingMinutesLite(
  meetingId: string,
): Promise<{ id: string; title: string; minuteDate: string }[]> {
  const user = await getSession()
  if (!user) return []
  const sb = await createServerClient()
  const { data, error } = await sb.from('minutes')
    .select('id, title, minute_date')
    .eq('meeting_id', meetingId)
    .order('minute_date', { ascending: false })
  if (error) console.error('[fetchMeetingMinutesLite] 연결된 회의록 조회 실패:', error.message)
  return (data ?? []).map(r => ({
    id: r.id as string,
    title: r.title as string,
    minuteDate: r.minute_date as string,
  }))
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

/** 탐색기 진입/재시도/업로드 후 클라이언트 호출용.
 *  기존 액션들의 [] 폴백과 달리 에러 상태를 UI까지 전달하기 위해 null을 반환한다(의도적 관례 이탈).
 *  미로그인/세션 만료도 v1에서는 구분하지 않는다 — 이 페이지는 인증 하에 있어 실사용상 만료 엣지뿐이며
 *  에러 카드+재시도로 수용(스펙 '서버 액션' 절). */
export async function fetchMinutesExplorer(): Promise<ExplorerData | null> {
  const user = await getSession()
  if (!user) return null
  return getMinutesExplorer()
}

/** 폴더 전량 로드(액션 내부용) — 깊이 검증에 사용. 실패 시 null. */
async function loadFolders(sb: Awaited<ReturnType<typeof createServerClient>>): Promise<MinuteFolder[] | null> {
  const { data, error } = await sb.from('minute_folders').select('id, name, parent_id, sort, created_by')
  if (error) { console.error('[loadFolders] 조회 실패:', error.message); return null }
  return (data ?? []).map((f: Record<string, unknown>) => ({
    id: f.id as string, name: f.name as string,
    parentId: (f.parent_id as string | null) ?? null,
    sort: f.sort as number, createdBy: (f.created_by as string | null) ?? null,
  }))
}

const FOLDER_DUP_MSG = '같은 폴더에 같은 이름이 이미 있습니다.'

export async function createMinuteFolder(
  name: string, parentId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const nameErr = validateFolderName(name)
  if (nameErr) return { ok: false, error: nameErr }
  // 루트의 팀코드 동명은 시드 전용(자동 편철 앵커) — 선점(스쿼팅)되면 전사 편철이 하이재킹된다
  if (parentId === null && isTeamRootName(name))
    return { ok: false, error: '팀 기본 폴더명(PMO·ERP·MES·가공·MDM)은 루트에 사용할 수 없습니다.' }
  const sb = await createServerClient()
  const folders = await loadFolders(sb)
  if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
  if (parentId && !folders.some(f => f.id === parentId)) return { ok: false, error: '상위 폴더를 찾을 수 없습니다.' }
  if (folderDepthOf(folders, parentId) + 1 > MINUTE_FOLDER_DEPTH_MAX)
    return { ok: false, error: `폴더는 최대 ${MINUTE_FOLDER_DEPTH_MAX}단까지 만들 수 있습니다.` }
  const { error } = await sb.from('minute_folders')
    .insert({ name: name.trim(), parent_id: parentId, created_by: user.id })
  if (error) {
    if (error.code === '23505') return { ok: false, error: FOLDER_DUP_MSG }
    if (error.code === '23503') return { ok: false, error: '상위 폴더가 방금 삭제되었습니다. 새로고침 후 다시 시도하세요.' }
    console.error('[createMinuteFolder] 실패:', error.message)
    return { ok: false, error: error.message }
  }
  revalidatePath('/minutes')
  return { ok: true }
}

export async function renameMinuteFolder(
  id: string, name: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const nameErr = validateFolderName(name)
  if (nameErr) return { ok: false, error: nameErr }
  const sb = await createServerClient()
  // 개명 가드 선행조회 — 실패하면 판정 불가이므로 중단(쓰기 선행조회 원칙)
  const folders = await loadFolders(sb)
  if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
  const target = folders.find(f => f.id === id)
  if (!target) return { ok: false, error: '폴더가 없습니다.' }
  // 팀 시드 폴더(루트 5축 + 하위 구분)는 개명 금지 — 이름 매칭 편철 앵커라 개명되면
  // 자동 편철·업로드 하위 구분이 소리 없이 어긋난다
  if (isTeamSeedFolder(folders, target))
    return { ok: false, error: '팀 기본 폴더는 이름을 변경할 수 없습니다.' }
  // 루트에서 팀코드 동명으로의 개명도 차단(앵커 사칭 방지)
  if (target.parentId === null && isTeamRootName(name))
    return { ok: false, error: '팀 기본 폴더명(PMO·ERP·MES·가공·MDM)은 루트에 사용할 수 없습니다.' }
  const { data, error } = await sb.from('minute_folders')
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq('id', id).select('id')
  if (error) {
    if (error.code === '23505') return { ok: false, error: FOLDER_DUP_MSG }
    console.error('[renameMinuteFolder] 실패:', error.message)
    return { ok: false, error: error.message }
  }
  // RLS 가 소유자/pmo_admin 이 아니면 0행 — 조용한 no-op 을 성공으로 위장하지 않는다
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 폴더가 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}

export async function deleteMinuteFolder(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  // 삭제 가드 선행조회 — 팀 시드 폴더(루트 5축 + 하위 구분)는 삭제 금지(편철 앵커 + cascade 소실)
  const folders = await loadFolders(sb)
  if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
  const target = folders.find(f => f.id === id)
  if (!target) return { ok: false, error: '폴더가 없습니다.' }
  if (isTeamSeedFolder(folders, target))
    return { ok: false, error: '팀 기본 폴더는 삭제할 수 없습니다.' }
  // 하위 폴더는 FK cascade, 소속 회의록은 set null(미분류 강등)이 정리한다
  const { data, error } = await sb.from('minute_folders').delete().eq('id', id).select('id')
  if (error) { console.error('[deleteMinuteFolder] 실패:', error.message); return { ok: false, error: error.message } }
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 폴더가 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}

export async function moveMinuteToFolder(
  minuteId: string, folderId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  if (folderId) {
    const { data: f } = await sb.from('minute_folders').select('id').eq('id', folderId).maybeSingle()
    if (!f) return { ok: false, error: '이동할 폴더를 찾을 수 없습니다.' }
  }
  // 권한은 update_own_minutes RLS(작성자 or pmo_admin)가 담당 — 0행이면 권한 없음으로 판정
  const { data, error } = await sb.from('minutes')
    .update({ folder_id: folderId, updated_at: new Date().toISOString() })
    .eq('id', minuteId).select('id')
  if (error) { console.error('[moveMinuteToFolder] 실패:', error.message); return { ok: false, error: error.message } }
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 회의록이 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}

/** 탐색기 즐겨찾기 목록 — 미로그인/실패 null (fetchMinutesExplorer 관례와 동일). */
export async function fetchMinuteFavorites(): Promise<string[] | null> {
  const user = await getSession()
  if (!user) return null
  return getMinuteFavorites()
}

/** 회의록 즐겨찾기 토글 — 성공 여부만 반환(실패 시 호출부가 낙관적 갱신 롤백 + 토스트). */
export async function toggleMinuteFavorite(minuteId: string, on: boolean): Promise<boolean> {
  const user = await getSession()
  if (!user) return false
  const sb = await createServerClient()
  if (on) {
    const { error } = await sb.from('minute_favorites')
      .upsert({ user_id: user.id, minute_id: minuteId }, { onConflict: 'user_id,minute_id', ignoreDuplicates: true })
    if (error) { console.error('[toggleMinuteFavorite] 저장 실패:', error.message); return false }
  } else {
    const { error } = await sb.from('minute_favorites')
      .delete().eq('user_id', user.id).eq('minute_id', minuteId)
    if (error) { console.error('[toggleMinuteFavorite] 삭제 실패:', error.message); return false }
  }
  return true
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

  const { data: existing, error: exErr } = await sb.from('minute_highlights')
    .select('id, block_hash').eq('minute_id', minuteId)
    .eq('created_by', user.id).eq('block_index', blockIndex).maybeSingle()
  // 토글 방향(끄기/켜기)을 정하는 선행 조회 — 실패를 '없음'으로 오인하면 끄기가 켜기로 뒤집히고,
  // 뒤이은 insert 의 unique 위반(23505)이 멱등 처리에 삼켜져 ok:true 로 보고된다.
  if (exErr) {
    console.error('[toggleMinuteHighlight] 기존 하이라이트 조회 실패:', exErr.message)
    return { ok: false, error: exErr.message }
  }

  if (existing && (existing.block_hash as string) === blockHash) {
    // 끄기
    const { error } = await sb.from('minute_highlights').delete().eq('id', existing.id as string)
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/minutes/${minuteId}`)
    return { ok: true, on: false }
  }
  if (existing) {
    // stale 행(재매칭 실패 잔존, 해시 불일치) — 지우고 새로 켠다(스펙 §6.7)
    // 삭제 실패를 삼키면 뒤이은 insert 가 unique(minute_id, created_by, block_index) 위반(23505)을 내고,
    // 그것이 아래 멱등 처리에 삼켜져 하이라이트가 갱신되지 않았는데도 ok:true 로 보고된다. 실패는 실패로 중단한다.
    const { error: staleErr } = await sb.from('minute_highlights').delete().eq('id', existing.id as string)
    if (staleErr) {
      console.error('[toggleMinuteHighlight] stale 하이라이트 삭제 실패:', staleErr.message)
      return { ok: false, error: staleErr.message }
    }
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

export interface MinuteShareResult { ok: boolean; enabled?: boolean; token?: string | null; error?: string }

/** 소유자/관리자 검증 + 공유 컬럼 단일 조회 — get/set 공용(왕복 1회, 소유권 규칙 한 곳). */
async function readShareRow(sb: Sb, id: string, userId: string, role: string):
  Promise<{ state: ShareState } | { error: string }> {
  const { data } = await sb.from('minutes')
    .select('created_by, share_token, share_enabled').eq('id', id).maybeSingle()
  if (!data) return { error: '회의록을 찾을 수 없습니다.' }
  if ((data.created_by as string | null) !== userId && role !== 'pmo_admin') return { error: '권한 없음' }
  return { state: { token: (data.share_token as string | null) ?? null, enabled: !!data.share_enabled } }
}

/** 공유 상태 조회 — 토큰은 이 액션으로만 클라이언트에 전달(페이지 payload 미포함, 소유자/관리자 한정). */
export async function getMinuteShare(id: string): Promise<MinuteShareResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const row = await readShareRow(sb, id, user.id, m.role)
  if ('error' in row) return { ok: false, error: row.error }
  return { ok: true, enabled: row.state.enabled, token: row.state.token }
}

/** 공유 토글/재발급 — 쓰기는 RLS update_own_minutes 가 최종 방어선. updated_at 은 건드리지 않는다(내용 편집 아님). */
export async function setMinuteShare(id: string, op: ShareOp): Promise<MinuteShareResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const row = await readShareRow(sb, id, user.id, m.role)
  if ('error' in row) return { ok: false, error: row.error }
  const next = nextShareState(row.state, op, crypto.randomUUID())
  const { error } = await sb.from('minutes')
    .update({ share_token: next.token, share_enabled: next.enabled }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true, enabled: next.enabled, token: next.token }
}
