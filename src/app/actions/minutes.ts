'use server'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { getActor } from '@/lib/authz'
import {
  isProjectAdmin, isProjectMember, isAnyProjectAdmin, hasAnyProjectRole, type Actor,
} from '@/lib/domain/authz'
import { displayNameFrom } from '@/lib/domain/display-name'
import {
  validateMinuteInput, isMinuteFilePathValid, validateFolderName, folderDepthOf, MINUTE_FOLDER_DEPTH_MAX,
  isTeamRootName, isTeamRootFolder, teamSubOfFolder, normalizeFolderName,
  MINUTES_PROJECT_BULK_MAX,
  type MinuteInput,
} from '@/lib/domain/minutes'
import { resolveFolderDrop, type MinuteDropReject } from '@/lib/domain/minutes-drop'
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
import { activeTeamCodesSync, teamsSync } from '@/lib/teams/master'
import { resolveMinuteProject } from '@/lib/minutes/project'
import {
  type MinuteVersionFile,
} from '@/lib/minutes/versions'
import {
  enqueueMinuteWikiProcessing, processMinuteWikiJob,
  rebuildProjectWikiFromActiveMinutes,
} from '@/lib/ai/wiki-ingest'

const BUCKET = 'minutes'

export interface MinuteActionResult {
  ok: boolean
  error?: string
  id?: string
  /** 녹취툴 시간대(+9h) 보정이 적용됐으면 보정 전/후 시각. UI 토스트용. */
  timeFix?: { from: string; to: string }
}

type Sb = Awaited<ReturnType<typeof createServerClient>>

export interface MinuteCreateSource {
  /** 클라이언트가 Storage 경로를 만들 때 선발급한 회의록 UUID. */
  minuteId: string
  file: MinuteVersionFile
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * 이 파일 전용 로그인+Actor 게이트. minutes 계열은 RLS 쓰기 정책이 0개이고 앱이
 * service_role 로 쓰므로(스펙 §1.5) **여기 게이트가 유일한 방어선**이다.
 * 권한 조회 실패는 통과도 거부 위장도 아닌 별도 문구로 중단한다(에러 처리 3원칙).
 */
async function requireActor(): Promise<{ ok: true; actor: Actor } | { ok: false; error: string }> {
  let actor: Actor | null
  try {
    actor = await getActor()
  } catch {
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  if (!actor) return { ok: false, error: '로그인 필요' }
  return { ok: true, actor }
}

/** 소유권 사전 확인 — RLS 0행 침묵 실패 방지. 반환: 에러 메시지 또는 null.
 *  프로젝트 미지정(project_id null) 회의록은 프로젝트로 판정할 수 없으므로
 *  isProjectAdmin(actor, null)=슈퍼유저만 통과 — '작성자 본인 또는 슈퍼유저'로
 *  좁아지는 것은 의도된 fail-closed 다(스펙 §3.5). */
async function checkOwner(sb: Sb, minuteId: string, actor: Actor): Promise<string | null> {
  const { data, error } = await sb.from('minutes')
    .select('created_by, archived_at, project_id')
    .eq('id', minuteId)
    .maybeSingle()
  // 보안 가드 조회 — 실패 시 소유자 판정 자체가 불가능하므로 거부(fail-closed).
  if (error) {
    console.error('[checkOwner] 소유권 조회 실패:', error.message)
    return '권한 확인에 실패했습니다. 잠시 후 다시 시도하세요.'
  }
  if (!data) return '회의록을 찾을 수 없습니다.'
  if (data.archived_at) return '보관된 회의록은 변경할 수 없습니다.'
  if ((data.created_by as string | null) !== actor.userId
      && !isProjectAdmin(actor, (data.project_id as string | null) ?? null)) return '권한 없음'
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
  input: MinuteInput, folderId: string | null = null, source?: MinuteCreateSource,
): Promise<MinuteActionResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const err = validateMinuteInput(input, activeTeamCodesSync())
  if (err) return { ok: false, error: err }
  if (source) {
    if (!UUID_RE.test(source.minuteId) || !isMinuteFilePathValid(source.minuteId, source.file.filePath)) {
      return { ok: false, error: '잘못된 원본 파일 경로입니다.' }
    }
    if (!/\.(md|markdown)$/i.test(source.file.fileName)) {
      return { ok: false, error: '.md 파일만 가능합니다.' }
    }
  }
  const sb = await createServerClient()
  const resolvedProject = await resolveMinuteProject(sb, {
    meetingId: input.meetingId,
    projectId: input.projectId,
  })
  if (resolvedProject.error) return { ok: false, error: resolvedProject.error }
  // 회의록 생성은 멤버 이상(스펙 D8). 프로젝트가 정해지면 그 프로젝트의 멤버여야 하고,
  // 미지정이면 어느 프로젝트든 역할이 있어야 한다(조회 전용 차단 — app_role() is not null 과 같은 의미).
  if (resolvedProject.projectId
    ? !isProjectMember(g.actor, resolvedProject.projectId)
    : !hasAnyProjectRole(g.actor)) return { ok: false, error: '권한 없음' }
  // §6.3 — 폴더가 주어지면 team 은 폴더에서 파생한다(클라이언트 teamCode 불신).
  let effectiveTeam = input.teamCode
  if (folderId) {
    const folders = await loadFolders(sb)
    if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
    if (!folders.some(f => f.id === folderId)) return { ok: false, error: '폴더를 찾을 수 없습니다.' }
    const derived = teamSubOfFolder(folders, folderId)
    if (!derived) return { ok: false, error: '담당 팀을 판정할 수 없는 폴더입니다.' }
    effectiveTeam = derived.team
  }
  // 폴더 미지정이면 담당 팀 루트 폴더로 자동 편철(0043) — 부재·실패는 미분류(null) 폴백
  const effectiveFolderId = folderId ?? await resolveTeamRootFolderId(sb, effectiveTeam)
  // 녹취툴 산출물이면 시간 줄 +9h(UTC→KST) 보정 — DB·다운스트림 전부 보정본 사용
  const fix = correctMinuteBodyTime(input.bodyMd)
  if (fix.corrected) console.info(`[minutes] 시간 보정 적용: ${fix.from} → ${fix.to} (${input.title.trim()})`)
  const bodyMd = fix.body
  const createdByName = displayNameFrom(user.user_metadata, user.email)
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '버전 저장 설정을 확인하세요.' }
  }
  // minutes + v1 + 현재 body 파일 포인터를 한 트랜잭션으로 만든다. 일반 인증
  // 사용자의 minutes 직접 쓰기는 0045에서 닫혀 있어 모든 생성 경로가 이 불변식을 거친다.
  const { data: createdRaw, error: createError } = await admin.rpc('create_minute_with_version', {
    p_minute_id: source?.minuteId ?? null,
    p_minute_date: input.minuteDate,
    p_team_code: effectiveTeam,
    p_title: input.title.trim(),
    p_body_md: bodyMd,
    p_body_hash: fnv1a64(bodyMd),
    p_meeting_id: input.meetingId,
    p_project_id: resolvedProject.projectId,
    p_meeting_occurrence_date: input.meetingId
      ? (input.meetingOccurrenceDate ?? input.minuteDate)
      : null,
    p_folder_id: effectiveFolderId,
    p_external_id: null,
    p_actor_id: user.id,
    p_actor_name: createdByName,
    p_file_name: source?.file.fileName ?? null,
    p_file_path: source?.file.filePath ?? null,
    p_file_size: source?.file.size ?? null,
    p_file_mime: source?.file.mime ?? null,
  }).single()
  if (createError || !createdRaw) {
    return { ok: false, error: createError?.message ?? '회의록 생성에 실패했습니다.' }
  }
  const created = createdRaw as unknown as {
    minute_id: string
    version_id: string
    wiki_rebuild_required: boolean
  }
  const minuteId = created.minute_id
  const versionId = created.version_id
  const wikiJobId = await enqueueMinuteWikiProcessing({
    projectId: resolvedProject.projectId,
    minuteId,
    minuteVersionId: versionId,
    bodyMd,
  })
  revalidatePath('/minutes')
  if (resolvedProject.projectId) revalidatePath(`/p/${resolvedProject.projectId}/wiki`)
  after(async () => {
    await Promise.all([
      ingestMinute(minuteId, bodyMd),
      generateMinuteInsights(minuteId, bodyMd),
      created.wiki_rebuild_required && resolvedProject.projectId
        ? rebuildProjectWikiFromActiveMinutes(resolvedProject.projectId)
        : wikiJobId === null ? Promise.resolve(null) : processMinuteWikiJob(wikiJobId),
    ])
  })
  return { ok: true, id: minuteId, timeFix: fix.corrected ? { from: fix.from!, to: fix.to! } : undefined }
}

export async function updateMinuteMeta(
  id: string, patch: Omit<MinuteInput, 'bodyMd'>, folderId?: string | null,
): Promise<MinuteActionResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const err = validateMinuteInput({ ...patch, bodyMd: '' }, activeTeamCodesSync())
  if (err) return { ok: false, error: err }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, g.actor)
  if (own) return { ok: false, error: own }
  const resolvedProject = await resolveMinuteProject(sb, {
    meetingId: patch.meetingId,
    projectId: patch.projectId,
  })
  if (resolvedProject.error) return { ok: false, error: resolvedProject.error }
  // §6.3 — 폴더가 주어지면 team 은 **폴더에서 파생**한다. 클라이언트가 보낸 teamCode 를 그대로
  // 믿으면 "폴더는 MES 인데 team_code 는 ERP" 인 데이터를 서버가 직접 만든다(파생은 UI 에만
  // 있었다). 파생 불가 폴더(시드 체인 밖)는 추측하지 않고 거절한다.
  let effectiveTeam = patch.teamCode
  if (folderId) {
    const folders = await loadFolders(sb)
    if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
    if (!folders.some(f => f.id === folderId)) return { ok: false, error: '폴더를 찾을 수 없습니다.' }
    const derived = teamSubOfFolder(folders, folderId)
    if (!derived) return { ok: false, error: '담당 팀을 판정할 수 없는 폴더입니다.' }
    effectiveTeam = derived.team
  }
  // folderId 미전달(undefined) = 폴더 무접촉(수동 편철 존중). null = 미분류로 이동.
  // 문자열 = 해당 폴더로 이동. RPC 는 p_metadata 에 folder_id 키 존재 여부로 무접촉을 판정하므로
  // 무접촉일 때는 키 자체를 넣지 않는다(값을 null 로 넣는 것과는 다르다).
  const upd: Record<string, unknown> = {
    minute_date: patch.minuteDate, team_code: effectiveTeam, title: patch.title.trim(),
    meeting_id: patch.meetingId,
    project_id: resolvedProject.projectId,
    meeting_occurrence_date: patch.meetingId
      ? (patch.meetingOccurrenceDate ?? patch.minuteDate)
      : null,
  }
  if (folderId !== undefined) upd.folder_id = folderId
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '회의록 수정 설정을 확인하세요.' }
  }
  const { data: updateRaw, error } = await admin.rpc('update_minute_metadata_with_wiki_retraction', {
    p_minute_id: id,
    p_metadata: upd,
  }).single()
  if (error || !updateRaw) return { ok: false, error: error?.message ?? '회의록 수정에 실패했습니다.' }
  const updateResult = updateRaw as unknown as {
    old_project_id: string | null
    new_project_id: string | null
    wiki_rebuild_required: boolean
  }
  const projectChanged = updateResult.old_project_id !== updateResult.new_project_id
  const wikiRebuildRequired = projectChanged || updateResult.wiki_rebuild_required === true
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  if (updateResult.old_project_id) {
    revalidatePath(`/p/${updateResult.old_project_id}/wiki`)
  }
  if (updateResult.new_project_id) {
    revalidatePath(`/p/${updateResult.new_project_id}/wiki`)
  }
  if (
    resolvedProject.projectId
    || (projectChanged && updateResult.old_project_id)
    || wikiRebuildRequired
  ) {
    after(async () => {
      await Promise.all([
        projectChanged && updateResult.old_project_id
          ? rebuildProjectWikiFromActiveMinutes(updateResult.old_project_id, id)
          : Promise.resolve(),
        wikiRebuildRequired && updateResult.new_project_id
          // 과거 회의록이 새 프로젝트의 후속 지식보다 늦게 단독 적용돼 거짓 충돌을
          // 만들지 않도록, 프로젝트 이동/시간축 변경은 회의 시점 순으로 다시 구성한다.
          ? rebuildProjectWikiFromActiveMinutes(updateResult.new_project_id)
          : Promise.resolve(),
      ])
    })
  }
  return { ok: true }
}

type BulkProjectResult = {
  ok: boolean
  error?: string
  /** 실제로 project_id 가 바뀐 건수 */
  updated: number
  /** 이미 그 프로젝트라 건드리지 않은 건수 */
  unchanged: number
  /** 건별 실패·거절 — 조용히 빠뜨리면 '전부 됐다'로 오인한다 */
  skipped: { id: string; reason: string }[]
}

/**
 * 여러 회의록의 프로젝트를 한 번에 지정/해제 — 탐색기 다중 선택.
 *
 * 건별로 updateMinuteMeta 와 **같은 메타 RPC** 를 태운다. raw update 로 하면 위키 회수·재적재가
 * 빠져 옛 프로젝트 위키에 그 회의록 지식이 남는다(0045 §위키 연동).
 *
 * 회의에 연결된 회의록은 회의의 프로젝트가 정본이라(resolveMinuteProject 와 같은 규칙) 다른
 * 프로젝트로 지정하는 것을 거절한다 — 조용히 덮으면 회의와 회의록이 서로 다른 프로젝트를 가리킨다.
 *
 * 위키 재적재는 프로젝트 단위로 **한 번씩만** 돈다(건별로 돌리면 200건이 200회 재적재가 된다).
 */
export async function assignMinutesProject(
  ids: string[], projectId: string | null,
): Promise<BulkProjectResult> {
  const empty = { updated: 0, unchanged: 0, skipped: [] as { id: string; reason: string }[] }
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error, ...empty }
  // 대상 프로젝트로 지정하는 것은 그 프로젝트의 관리자 이상(스펙 §4.3). 해제(null)는 건별 판정만.
  if (projectId && !isProjectAdmin(g.actor, projectId)) return { ok: false, error: '권한 없음', ...empty }
  const targets = [...new Set(ids)].filter(id => UUID_RE.test(id))
  if (targets.length === 0) return { ok: false, error: '선택된 회의록이 없습니다.', ...empty }
  if (targets.length > MINUTES_PROJECT_BULK_MAX) {
    return { ok: false, error: `한 번에 ${MINUTES_PROJECT_BULK_MAX}건까지 지정할 수 있습니다.`, ...empty }
  }
  const sb = await createServerClient()
  // 대상 프로젝트 실재 확인 — 없는 id 로 200건을 돌리고 전건 실패하는 것을 막는다
  if (projectId) {
    const { data: p, error: pErr } = await sb.from('projects').select('id').eq('id', projectId).maybeSingle()
    if (pErr) {
      console.error('[assignMinutesProject] 프로젝트 조회 실패:', pErr.message)
      return { ok: false, error: '프로젝트를 확인하지 못했습니다.', ...empty }
    }
    if (!p) return { ok: false, error: '프로젝트를 찾을 수 없습니다.', ...empty }
  }
  // 가드 선행조회 — 실패하면 소유권·보관 판정이 불가능하므로 중단(fail-closed, 건별 N회 왕복 회피)
  const { data: rows, error: rowsErr } = await sb.from('minutes')
    .select('id, created_by, archived_at, project_id, meeting_id')
    .in('id', targets)
  if (rowsErr) {
    console.error('[assignMinutesProject] 대상 조회 실패:', rowsErr.message)
    return { ok: false, error: '회의록을 불러오지 못했습니다.', ...empty }
  }
  type MinuteRow = {
    id: string; created_by: string | null; archived_at: string | null
    project_id: string | null; meeting_id: string | null
  }
  const byId = new Map((rows ?? []).map(r => [(r as MinuteRow).id, r as MinuteRow]))

  // 연결된 회의의 프로젝트 — 회의별 1회만 읽는다
  const meetingIds = [...new Set([...byId.values()].map(r => r.meeting_id).filter((v): v is string => !!v))]
  const meetingProject = new Map<string, string | null>()
  if (meetingIds.length > 0) {
    const { data: ms, error: msErr } = await sb.from('meetings').select('id, project_id').in('id', meetingIds)
    if (msErr) {
      console.error('[assignMinutesProject] 회의 조회 실패:', msErr.message)
      return { ok: false, error: '연결된 회의를 확인하지 못했습니다.', ...empty }
    }
    for (const r of ms ?? []) {
      meetingProject.set((r as { id: string }).id, (r as { project_id: string | null }).project_id ?? null)
    }
  }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '프로젝트 지정 설정을 확인하세요.', ...empty }
  }

  const skipped: { id: string; reason: string }[] = []
  const rebuildProjects = new Set<string>()
  let updated = 0
  let unchanged = 0

  for (const id of targets) {
    const row = byId.get(id)
    if (!row) { skipped.push({ id, reason: '회의록을 찾을 수 없습니다.' }); continue }
    if (row.archived_at) { skipped.push({ id, reason: '보관된 회의록' }); continue }
    // 미지정(project_id null) 회의록은 isProjectAdmin(actor, null)=슈퍼유저만 — 의도된 fail-closed.
    if (row.created_by !== g.actor.userId && !isProjectAdmin(g.actor, row.project_id)) { skipped.push({ id, reason: '권한 없음' }); continue }
    if (row.meeting_id) {
      const mp = meetingProject.get(row.meeting_id) ?? null
      if (mp !== projectId) { skipped.push({ id, reason: '연결된 회의의 프로젝트와 다릅니다.' }); continue }
    }
    if (row.project_id === projectId) { unchanged += 1; continue }

    const { data: raw, error } = await admin.rpc('update_minute_metadata_with_wiki_retraction', {
      p_minute_id: id,
      p_metadata: { project_id: projectId },
    }).single()
    if (error || !raw) {
      console.error('[assignMinutesProject] 갱신 실패:', id, error?.message ?? 'no row')
      skipped.push({ id, reason: rpcErrorMessage(error?.message, '지정에 실패했습니다.') })
      continue
    }
    const res = raw as unknown as {
      old_project_id: string | null; new_project_id: string | null; wiki_rebuild_required: boolean
    }
    if (res.old_project_id) rebuildProjects.add(res.old_project_id)
    if (res.new_project_id) rebuildProjects.add(res.new_project_id)
    updated += 1
    revalidatePath(`/minutes/${id}`)
  }

  revalidatePath('/minutes')
  for (const pid of rebuildProjects) revalidatePath(`/p/${pid}/wiki`)
  if (updated > 0 && rebuildProjects.size > 0) {
    const projects = [...rebuildProjects]
    after(async () => {
      // 순차 — 프로젝트별 재적재는 무겁고, 동시에 돌리면 같은 위키를 두 경로가 함께 만진다
      for (const pid of projects) await rebuildProjectWikiFromActiveMinutes(pid)
    })
  }
  return { ok: true, updated, unchanged, skipped }
}

/** 또박또박 연결 초기화 — external_id 를 null 로. 0045 이후 minutes 직접 쓰기가 닫혀 있어
 *  admin(service_role) 경유. moveMinuteToFolder 와 동일하게 소유권 선확인 후 update. */
export async function resetMinuteExternalId(id: string): Promise<{ ok: boolean; error?: string }> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, g.actor)
  if (own) return { ok: false, error: own }
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '연결 초기화 설정을 확인하세요.' }
  }
  const { data, error } = await admin.from('minutes')
    .update({ external_id: null, updated_at: new Date().toISOString() })
    .eq('id', id).select('id')
  if (error) { console.error('[resetMinuteExternalId] 실패:', error.message); return { ok: false, error: error.message } }
  // RLS 가 소유자/pmo_admin 이 아니면 0행 — 조용한 no-op 을 성공으로 위장하지 않는다
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 회의록이 없습니다.' }
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  return { ok: true }
}

/** 폴더 전량(라이트) — 수정 모달의 하위 구분 초기화·편철용. 실패는 빈 배열(하위 구분 숨김). */
/** 폴더 전량(라이트). **실패는 null** — 폴더 선택이 필수가 된 §6 이후로는 빈 배열이 곧
 *  "고를 것이 없는 막다른 모달"이라 조회 실패와 구분되지 않으면 원인 표시가 불가능하다
 *  (fetchMinutesExplorer 와 같은 관례). */
export async function fetchMinuteFoldersLite(): Promise<MinuteFolder[] | null> {
  const user = await getSession()
  if (!user) return null
  const sb = await createServerClient()
  return await loadFolders(sb)
}

/** 본문 교체 — 클라이언트가 새 .md 를 Storage 업로드한 뒤 호출. 기존 body 파일 0건 허용(복구 경로). */
export async function replaceMinuteBody(
  id: string, bodyMd: string,
  file: { fileName: string; filePath: string; size: number; mime: string },
): Promise<MinuteActionResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (bodyMd.length > 100_000) return { ok: false, error: '본문은 100,000자 이하여야 합니다.' }
  if (!isMinuteFilePathValid(id, file.filePath)) return { ok: false, error: '잘못된 파일 경로입니다.' }
  if (!/\.(md|markdown)$/i.test(file.fileName)) return { ok: false, error: '.md 파일만 가능합니다.' }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, g.actor)
  if (own) return { ok: false, error: own }
  // 녹취툴 산출물이면 시간 줄 +9h(UTC→KST) 보정 — DB·재매칭·재인제스트 전부 보정본 사용
  const fix = correctMinuteBodyTime(bodyMd)
  if (fix.corrected) console.info(`[minutes] 본문 교체 시간 보정 적용: ${fix.from} → ${fix.to} (id=${id})`)
  const body = fix.body
  const { data: minute, error: minuteErr } = await sb.from('minutes')
    .select('project_id')
    .eq('id', id)
    .single()
  if (minuteErr || !minute) return { ok: false, error: minuteErr?.message ?? '회의록을 찾을 수 없습니다.' }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '버전 저장 설정을 확인하세요.' }
  }
  // 버전 append + 현재 파일 포인터 + current body를 DB 함수 한 트랜잭션으로 커밋한다.
  // 어느 단계에서든 실패하면 전부 롤백되며, 이전 Storage 객체는 함수가 삭제하지 않는다.
  const { data: committedRaw, error: commitError } = await admin.rpc('commit_minute_body_version', {
    p_minute_id: id,
    p_body_md: body,
    p_body_hash: fnv1a64(body),
    p_file_name: file.fileName,
    p_file_path: file.filePath,
    p_file_size: file.size,
    p_file_mime: file.mime,
    p_actor_id: user.id,
    p_actor_name: displayNameFrom(user.user_metadata, user.email),
  }).single()
  if (commitError || !committedRaw) {
    console.error('[replaceMinuteBody] 원자 커밋 실패:', commitError?.message ?? 'no row')
    return { ok: false, error: commitError?.message ?? '새 버전 저장에 실패했습니다.' }
  }
  const committed = committedRaw as unknown as {
    version_id: string
    wiki_rebuild_required: boolean
  }
  const versionId = committed.version_id as string
  const wikiJobId = committed.wiki_rebuild_required
    ? await enqueueMinuteWikiProcessing({
        projectId: (minute.project_id as string | null) ?? null,
        minuteId: id,
        minuteVersionId: versionId,
        bodyMd: body,
      })
    : null
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  // ① 하이라이트 재매칭 → ② 검색/요약/Wiki 갱신. Wiki는 새 버전 ID를 근거로 보존한다.
  after(async () => {
    await rematchMinuteHighlights(id, body)
    await Promise.all([
      ingestMinute(id, body),
      generateMinuteInsights(id, body),
      committed.wiki_rebuild_required && minute.project_id
        ? rebuildProjectWikiFromActiveMinutes(minute.project_id as string)
        : wikiJobId === null ? Promise.resolve(null) : processMinuteWikiJob(wikiJobId),
    ])
  })
  return { ok: true, timeFix: fix.corrected ? { from: fix.from!, to: fix.to! } : undefined }
}

/** 클라이언트 Storage 업로드 후 메타 기록. file_path 는 {minuteId}/ 접두 강제. */
export async function recordMinuteFile(
  minuteId: string,
  file: { role: 'body' | 'attachment'; fileName: string; filePath: string; size: number; mime: string },
): Promise<MinuteActionResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (!isMinuteFilePathValid(minuteId, file.filePath)) return { ok: false, error: '잘못된 파일 경로입니다.' }
  if (file.role === 'body' && !/\.(md|markdown)$/i.test(file.fileName))
    return { ok: false, error: '.md 파일만 가능합니다.' }
  const sb = await createServerClient()
  const own = await checkOwner(sb, minuteId, g.actor)
  if (own) return { ok: false, error: own }
  if (file.role === 'body') {
    const { data: minute, error: minuteError } = await sb.from('minutes')
      .select('body_md, project_id')
      .eq('id', minuteId)
      .single()
    if (minuteError || !minute) {
      return { ok: false, error: minuteError?.message ?? '회의록을 찾을 수 없습니다.' }
    }
    let admin: ReturnType<typeof createAdminClient>
    try {
      admin = createAdminClient()
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '버전 저장 설정을 확인하세요.' }
    }
    // 파일 없는 기존 본문에 원본을 연결하는 경우에도 과거 버전을 수정하지 않고,
    // 같은 본문+새 파일의 새 버전을 원자적으로 append한다.
    const bodyMd = minute.body_md as string
    const { data: committedRaw, error: commitError } = await admin.rpc('commit_minute_body_version', {
      p_minute_id: minuteId,
      p_body_md: bodyMd,
      p_body_hash: fnv1a64(bodyMd),
      p_file_name: file.fileName,
      p_file_path: file.filePath,
      p_file_size: file.size,
      p_file_mime: file.mime,
      p_actor_id: user.id,
      p_actor_name: displayNameFrom(user.user_metadata, user.email),
    }).single()
    if (commitError || !committedRaw) {
      return { ok: false, error: commitError?.message ?? '원본 버전 기록에 실패했습니다.' }
    }
    const committed = committedRaw as unknown as {
      version_id: string
      wiki_rebuild_required: boolean
    }
    const wikiJobId = committed.wiki_rebuild_required
      ? await enqueueMinuteWikiProcessing({
          projectId: (minute.project_id as string | null) ?? null,
          minuteId,
          minuteVersionId: committed.version_id,
          bodyMd,
        })
      : null
    after(async () => {
      if (committed.wiki_rebuild_required && minute.project_id) {
        await rebuildProjectWikiFromActiveMinutes(minute.project_id as string)
      } else if (wikiJobId !== null) {
        await processMinuteWikiJob(wikiJobId)
      }
    })
    revalidatePath(`/minutes/${minuteId}`)
    return { ok: true }
  }

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
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const { data: f } = await sb.from('minute_files')
    .select('id, minute_id, role, file_path').eq('id', fileId).maybeSingle()
  if (!f) return { ok: false, error: '파일 없음' }
  if ((f.role as string) === 'body') return { ok: false, error: '본문 파일은 교체로만 변경할 수 있습니다.' }
  const own = await checkOwner(sb, f.minute_id as string, g.actor)
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
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, g.actor)
  if (own) return { ok: false, error: own }
  const { data: minuteScope, error: scopeError } = await sb.from('minutes')
    .select('project_id')
    .eq('id', id)
    .maybeSingle()
  if (scopeError || !minuteScope) {
    return { ok: false, error: scopeError?.message ?? '회의록을 찾을 수 없습니다.' }
  }
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '보관 설정을 확인하세요.' }
  }
  // 사용자에게는 목록에서 사라지지만 원본·모든 버전·Storage 객체·Wiki 감사 근거는
  // 삭제하지 않는다. Wiki 출처 철회와 보관 시각 기록도 DB 한 트랜잭션에서 수행한다.
  const { error } = await admin.rpc('archive_minute_with_wiki_retraction', {
    p_minute_id: id,
    p_reason: '사용자가 회의록을 보관했습니다.',
  })
  if (error) {
    console.error('[deleteMinute] 보관 실패:', error.message)
    return { ok: false, error: error.message }
  }
  revalidatePath('/minutes')
  revalidatePath(`/minutes/${id}`)
  if (minuteScope.project_id) {
    revalidatePath(`/p/${minuteScope.project_id as string}/wiki`)
    after(async () => {
      await rebuildProjectWikiFromActiveMinutes(minuteScope.project_id as string, id)
    })
  }
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
    .is('archived_at', null)
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
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  // 폴더는 프로젝트에 속하지 않는 전역 리소스 — 멤버 이상(조회 전용 차단)이 만든다.
  if (!hasAnyProjectRole(g.actor)) return { ok: false, error: '권한 없음' }
  const nameErr = validateFolderName(name)
  if (nameErr) return { ok: false, error: nameErr }
  // W18(§6.3) — 루트 폴더 생성 금지. 회의록의 team_code 를 폴더에서 파생하려면 "모든 폴더는
  // 시드 팀 루트의 서브트리"라는 불변식이 필요한데, 사용자 루트 폴더가 하나라도 생기면 그
  // 서브트리 회의록의 팀 파생이 끊긴다(teamSubOfFolder 가 null). 팀 축은 팀 마스터가 만든다.
  // 이 가드가 기존 팀코드 동명 스쿼팅 가드를 포섭한다(루트 자체가 막히므로).
  if (parentId === null) {
    return { ok: false, error: '폴더는 담당 팀 폴더 안에만 만들 수 있습니다.' }
  }
  const sb = await createServerClient()
  const folders = await loadFolders(sb)
  if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
  if (parentId && !folders.some(f => f.id === parentId)) return { ok: false, error: '상위 폴더를 찾을 수 없습니다.' }
  if (folderDepthOf(folders, parentId) + 1 > MINUTE_FOLDER_DEPTH_MAX)
    return { ok: false, error: `폴더는 최대 ${MINUTE_FOLDER_DEPTH_MAX}단까지 만들 수 있습니다.` }
  const { error } = await sb.from('minute_folders')
    .insert({ name: normalizeFolderName(name), parent_id: parentId, created_by: g.actor.userId })
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
  // 팀 루트 시드만 개명 금지(팀명=자동 편철 앵커) — 하위 구분은 실폴더에서 동적 유도되므로
  // 하위 폴더 개명은 곧 옵션 변경으로 반영된다(허용)
  if (isTeamRootFolder(target))
    return { ok: false, error: '팀 기본 폴더는 이름을 변경할 수 없습니다.' }
  // 루트에서 팀코드 동명으로의 개명도 차단(앵커 사칭 방지)
  const teamNames = teamsSync().map(t => t.code)
  if (target.parentId === null && isTeamRootName(name, teamNames))
    return { ok: false, error: `팀 기본 폴더명(${teamNames.join('·')})은 루트에 사용할 수 없습니다.` }
  const { data, error } = await sb.from('minute_folders')
    .update({ name: normalizeFolderName(name), updated_at: new Date().toISOString() })
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

/**
 * 폴더 삭제 — **비우기 우선**(결정 §6 「폴더 삭제 가드」).
 *
 * 종전에는 FK cascade 로 하위 폴더가 함께 지워지고 소속 회의록은 `folder_id set null` 로
 * **미분류 강등**됐다. §6.3 이후 `team_code` 를 폴더에서 파생하므로 미분류 강등은 곧
 * **팀 파생이 끊긴 데이터**가 된다. 게다가 외부 API·배치가 만든 폴더는 `isTeamRootFolder`
 * 보호 밖이라 전송자 1명이 지우면 그 안 회의록이 전부 미분류가 될 수 있었다.
 *
 * → 삭제 전에 자식 폴더와 소속 회의록을 **부모로 승격**시킨다. 스키마 변경 없이 UX 유지.
 */
export async function deleteMinuteFolder(id: string): Promise<{ ok: boolean; error?: string }> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const folders = await loadFolders(sb)
  if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
  const target = folders.find(f => f.id === id)
  if (!target) return { ok: false, error: '폴더가 없습니다.' }
  if (isTeamRootFolder(target))
    return { ok: false, error: '팀 기본 폴더는 삭제할 수 없습니다.' }
  // 승격 대상 = 부모. W18 이후 루트 폴더는 생기지 않으므로 삭제 가능한 폴더엔 항상 부모가 있다.
  const parentId = target.parentId
  if (!parentId) return { ok: false, error: '최상위 폴더는 삭제할 수 없습니다.' }
  // RLS(0040)와 **같은 조건**을 명시 선판정한다 — 승격을 먼저 하기 때문에, 삭제가 나중에
  // 권한으로 막히면 옮겨만 놓고 폴더가 남는 상태가 된다. 같은 조건이면 그 일이 없다.
  // isAnyProjectAdmin 은 app_role() shim 의 'pmo_admin' 과 같은 의미라 RLS 판정과 갈라지지 않는다.
  if (target.createdBy !== g.actor.userId && !isAnyProjectAdmin(g.actor)) {
    return { ok: false, error: '권한이 없거나 폴더가 없습니다.' }
  }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '폴더 삭제 설정을 확인하세요.' }
  }
  // ① 자식 폴더 승격 — 같은 부모에 동명이 생기면 부분 유니크 인덱스가 23505 로 막는다.
  //    그 경우 사용자가 이름을 바꾸도록 안내한다(조용히 cascade 로 지우지 않는다).
  const children = folders.filter(f => f.parentId === id)
  if (children.length > 0) {
    const clash = children.find(c => folders.some(f => f.parentId === parentId && f.name === c.name))
    if (clash) {
      return { ok: false, error: `상위 폴더에 같은 이름('${clash.name}')이 있어 비울 수 없습니다. 먼저 이름을 바꾸세요.` }
    }
    const { error: cErr } = await admin.from('minute_folders')
      .update({ parent_id: parentId, updated_at: new Date().toISOString() }).eq('parent_id', id)
    if (cErr) {
      console.error('[deleteMinuteFolder] 하위 폴더 승격 실패:', cErr.message)
      return { ok: false, error: '하위 폴더를 옮기지 못해 삭제를 중단했습니다.' }
    }
  }
  // ② 소속 회의록 승격 — updated_at 은 건드리지 않는다(조직 정리가 외부 연동 GET 에
  //    '방금 수정됨'으로 비치면 안 된다 — 0043 4단계·배치와 같은 규칙).
  const { error: mErr } = await admin.from('minutes').update({ folder_id: parentId }).eq('folder_id', id)
  if (mErr) {
    console.error('[deleteMinuteFolder] 회의록 승격 실패:', mErr.message)
    return { ok: false, error: '회의록을 옮기지 못해 삭제를 중단했습니다.' }
  }
  // ③ 이제 빈 폴더다 — cascade 가 지울 것이 없다.
  const { data, error } = await sb.from('minute_folders').delete().eq('id', id).select('id')
  if (error) { console.error('[deleteMinuteFolder] 실패:', error.message); return { ok: false, error: error.message } }
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 폴더가 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}

/** 0045 메타 RPC 가 raise 하는 영문 상수 → 사용자 문구. 매핑이 없으면 'MINUTE_ARCHIVED' 같은
 *  내부 상수가 그대로 화면에 노출된다. */
const RPC_ERROR_MESSAGES: ReadonlyArray<[string, string]> = [
  ['MINUTE_NOT_FOUND', '회의록을 찾을 수 없습니다.'],
  ['MINUTE_ARCHIVED', '보관된 회의록은 변경할 수 없습니다.'],
  ['MINUTE_TEAM_INVALID', '비활성 팀의 폴더로는 이동할 수 없습니다.'],
  ['MINUTE_METADATA_REQUIRED', '회의록 필수 항목이 비어 있습니다.'],
  ['MINUTE_METADATA_KEY_NOT_ALLOWED', '허용되지 않은 항목이 포함됐습니다.'],
]
function rpcErrorMessage(message: string | undefined, fallback: string): string {
  if (!message) return fallback
  for (const [code, text] of RPC_ERROR_MESSAGES) if (message.includes(code)) return text
  return fallback
}

/** 드롭 거부 사유 → 사용자 문구. 클라이언트도 같은 사유 코드로 토스트를 고르지만, 서버가
 *  최종 판정자라 여기서도 사유별 안내를 돌려준다(원인을 모른 채 '실패'만 보이지 않게). */
const FOLDER_MOVE_REJECT_MSG: Record<MinuteDropReject, string> = {
  'team-root': '팀 기본 폴더는 이동할 수 없습니다.',
  'not-found': '이동할 상위 폴더를 찾을 수 없습니다.',
  cycle: '폴더를 자기 자신이나 하위 폴더로 옮길 수 없습니다.',
  depth: `폴더는 최대 ${MINUTE_FOLDER_DEPTH_MAX}단까지 만들 수 있습니다.`,
  'anchor-squat': '팀 기본 폴더명은 루트에 사용할 수 없습니다.',
}

/** 폴더를 다른 폴더(또는 루트) 아래로 이동 — 탐색기 드래그앤드롭.
 *  클라이언트가 이미 같은 규칙으로 걸렀더라도 서버에서 전부 다시 판정한다(fail-closed).
 *  teamCodes 는 비활성 포함 전체 등록 팀 — 활성 팀만 아는 클라이언트보다 넓다. */
export async function moveMinuteFolder(
  id: string, newParentId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  // 이동 가드 선행조회 — 실패하면 판정 불가이므로 중단(쓰기 선행조회 원칙)
  const folders = await loadFolders(sb)
  if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
  const target = folders.find(f => f.id === id)
  if (!target) return { ok: false, error: '폴더가 없습니다.' }
  const verdict = resolveFolderDrop(target, newParentId, folders, teamsSync().map(t => t.code))
  if (verdict.kind === 'noop') return { ok: true }        // 제자리 — 쓰기 없이 성공
  if (verdict.kind === 'reject') return { ok: false, error: FOLDER_MOVE_REJECT_MSG[verdict.reason] }
  const { data, error } = await sb.from('minute_folders')
    .update({ parent_id: newParentId, updated_at: new Date().toISOString() })
    .eq('id', id).select('id')
  if (error) {
    if (error.code === '23505') return { ok: false, error: FOLDER_DUP_MSG }
    console.error('[moveMinuteFolder] 실패:', error.message)
    return { ok: false, error: error.message }
  }
  // RLS 가 소유자/pmo_admin 이 아니면 0행 — 조용한 no-op 을 성공으로 위장하지 않는다
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 폴더가 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}

/**
 * 회의록을 폴더로 이동 — 탐색기 드래그앤드롭·이동 메뉴.
 *
 * §6.4: 폴더가 team 의 유일한 출처가 되므로 **팀 루트를 넘어가면 team_code 도 따라가야** 한다.
 * 아니면 "폴더는 MES인데 team_code 는 ERP"인 불일치가 생겨 목록 필터(?team=)와 트리가 서로
 * 다른 답을 준다. 같은 팀 안 이동(대부분)은 종전처럼 raw update — 싸고 위키에 무영향.
 *
 * 권한은 기존 checkOwner(작성자 또는 pmo_admin) 유지 — archived 차단도 checkOwner 가 한다.
 */
export async function moveMinuteToFolder(
  minuteId: string, folderId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  // 미분류(null)로 빼내는 것은 탐색기 D&D 가 제공하는 조작이라 허용한다. 팀 파생은 대상
  // 폴더가 있을 때만 다시 하고, 미분류면 현재 team_code 를 그대로 둔다(추측 금지).
  const sb = await createServerClient()
  let folders: MinuteFolder[] | null = null
  if (folderId) {
    folders = await loadFolders(sb)
    if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
    if (!folders.some(f => f.id === folderId)) return { ok: false, error: '이동할 폴더를 찾을 수 없습니다.' }
  }
  const own = await checkOwner(sb, minuteId, g.actor)
  if (own) return { ok: false, error: own }

  // 현재 팀 — 쓰기 선행조회 실패는 판정 불가이므로 중단(추측 금지)
  const { data: cur, error: curErr } = await sb.from('minutes')
    .select('team_code').eq('id', minuteId).maybeSingle()
  if (curErr) {
    console.error('[moveMinuteToFolder] 현재 담당 조회 실패:', curErr.message)
    return { ok: false, error: '회의록 정보를 불러오지 못했습니다.' }
  }
  if (!cur) return { ok: false, error: '회의록을 찾을 수 없습니다.' }
  const currentTeam = (cur as { team_code: string }).team_code

  // 대상 폴더에서 팀 파생. 시드 체인 밖(§6.3 불변식 위반)이면 추측하지 않고 거절한다.
  let nextTeam = currentTeam
  if (folderId && folders) {
    const derived = teamSubOfFolder(folders, folderId)
    if (!derived) return { ok: false, error: '담당 팀을 판정할 수 없는 폴더입니다.' }
    nextTeam = derived.team
  }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '폴더 이동 설정을 확인하세요.' }
  }

  if (nextTeam !== currentTeam) {
    // 팀이 바뀌면 team_code 는 v_index_content_changed 대상이라 검색 인덱스 재적재가 따라야
    // 한다. raw update 로 하면 ai_documents 가 옛 팀으로 남는다. updateMinuteMeta 와 같은
    // 경로를 재사용한다(부분 patch — 보낸 키만 덮으므로 나머지 메타는 보존된다).
    const { data: updateRaw, error } = await admin.rpc('update_minute_metadata_with_wiki_retraction', {
      p_minute_id: minuteId,
      p_metadata: { team_code: nextTeam, folder_id: folderId },
    }).single()
    if (error || !updateRaw) {
      console.error('[moveMinuteToFolder] 팀 이동 실패:', error?.message ?? 'no row')
      return { ok: false, error: rpcErrorMessage(error?.message, '폴더 이동에 실패했습니다.') }
    }
    const result = updateRaw as unknown as {
      old_project_id: string | null
      new_project_id: string | null
      wiki_rebuild_required: boolean
    }
    revalidatePath('/minutes'); revalidatePath(`/minutes/${minuteId}`)
    if (result.old_project_id) revalidatePath(`/p/${result.old_project_id}/wiki`)
    if (result.new_project_id) revalidatePath(`/p/${result.new_project_id}/wiki`)
    if (result.wiki_rebuild_required && result.new_project_id) {
      const projectId = result.new_project_id
      after(async () => { await rebuildProjectWikiFromActiveMinutes(projectId) })
    }
    return { ok: true }
  }

  const { data, error } = await admin.from('minutes')
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
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  // 하이라이트는 다른 사용자에게도 보이는 공유 표식 — 멤버 이상(조회 전용 차단).
  if (!hasAnyProjectRole(g.actor)) return { ok: false, error: '권한 없음' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: minute } = await sb.from('minutes')
    .select('body_md, archived_at')
    .eq('id', minuteId)
    .maybeSingle()
  if (!minute) return { ok: false, error: '회의록을 찾을 수 없습니다.' }
  if (minute.archived_at) return { ok: false, error: '보관된 회의록은 변경할 수 없습니다.' }
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
  // 멤버십 게이트(무료 쿼터 보호) — 조회 전용은 self-heal 을 트리거하지 못한다.
  const g = await requireActor()
  if (!g.ok) return { status: 'unavailable' }
  if (!hasAnyProjectRole(g.actor)) return { status: 'unavailable' }
  const sb = await createServerClient()
  const { data: minute } = await sb.from('minutes')
    .select('body_md, archived_at')
    .eq('id', minuteId)
    .maybeSingle()
  if (!minute) return { status: 'unavailable' }
  if (minute.archived_at) return { status: 'ready' }
  const bodyMd = minute.body_md as string
  if (!bodyMd.trim()) return { status: 'ready' }
  const status = await ensureMinuteInsights(minuteId, bodyMd, fnv1a64(bodyMd))
  if (status === 'generated') revalidatePath(`/minutes/${minuteId}`)
  return { status }
}

export interface MinuteShareResult { ok: boolean; enabled?: boolean; token?: string | null; error?: string }

/** 소유자/관리자 검증 + 공유 컬럼 단일 조회 — get/set 공용(왕복 1회, 소유권 규칙 한 곳).
 *  미지정(project_id null) 회의록은 작성자 본인 또는 슈퍼유저만 — checkOwner 와 같은 fail-closed. */
async function readShareRow(sb: Sb, id: string, actor: Actor):
  Promise<{ state: ShareState } | { error: string }> {
  const { data } = await sb.from('minutes')
    .select('created_by, share_token, share_enabled, archived_at, project_id').eq('id', id).maybeSingle()
  if (!data) return { error: '회의록을 찾을 수 없습니다.' }
  if (data.archived_at) return { error: '보관된 회의록은 공유 설정을 바꿀 수 없습니다.' }
  if ((data.created_by as string | null) !== actor.userId
      && !isProjectAdmin(actor, (data.project_id as string | null) ?? null)) return { error: '권한 없음' }
  return { state: { token: (data.share_token as string | null) ?? null, enabled: !!data.share_enabled } }
}

/** 공유 상태 조회 — 토큰은 이 액션으로만 클라이언트에 전달(페이지 payload 미포함, 소유자/관리자 한정). */
export async function getMinuteShare(id: string): Promise<MinuteShareResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const row = await readShareRow(sb, id, g.actor)
  if ('error' in row) return { ok: false, error: row.error }
  return { ok: true, enabled: row.state.enabled, token: row.state.token }
}

/** 공유 토글/재발급 — 서버에서 소유권을 확인한 뒤 service role로 허용 컬럼만 쓴다. */
export async function setMinuteShare(id: string, op: ShareOp): Promise<MinuteShareResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const row = await readShareRow(sb, id, g.actor)
  if ('error' in row) return { ok: false, error: row.error }
  const next = nextShareState(row.state, op, crypto.randomUUID())
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '공유 설정을 확인하세요.' }
  }
  const { error } = await admin.from('minutes')
    .update({ share_token: next.token, share_enabled: next.enabled }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true, enabled: next.enabled, token: next.token }
}
