import { after, NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { folderPathOf, resolveFolderPath, resolveTeamRootFolderId } from '@/lib/minutes/folders'
import { fnv1a64 } from '@/lib/minutes/blocks'
import {
  enqueueMinuteWikiProcessing,
  rebuildProjectWikiFromActiveMinutes,
} from '@/lib/ai/wiki-ingest'
import { activeTeamCodesSync } from '@/lib/teams/master'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound, gateMinutesApi,
  parseMinutePayload, parseUserEmail, resolveUserByEmail, runMinutePostProcessing,
  type AdminClient, type ExternalMinutePayload, type ResolvedUser,
} from '@/lib/minutes/externalApi'
import { resolveOrCreateExternalMeeting } from '@/lib/minutes/meetings'

/**
 * POST /api/v1/minutes — 회의록 생성/갱신(upsert by external_id), GET — 목록/존재 확인.
 * 계약: docs/design/dflow-minutes-upload-api-spec.md §4·§5.1. 또박또박 서버가 호출한다.
 */

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const MINUTE_SELECT = 'id, minute_date, team_code, title, body_md, meeting_id, project_id, meeting_occurrence_date, archived_at, external_id, folder_id, created_by, created_by_name, created_at, updated_at'

interface ExistingRow {
  id: string
  minute_date: string
  team_code: string
  title: string
  body_md: string
  meeting_id: string | null
  project_id: string | null
  meeting_occurrence_date: string | null
  archived_at: string | null
  external_id: string
  folder_id: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

/**
 * 편철 품질 신호(계약 v2.4 §4.3 · 결정 §2-C). 경로가 짧아지는 원인이 3개라 boolean 하나로는
 * 또박또박이 구분할 수 없고, 스스로 판정하려면 정규화 규칙과 팀 캐시를 재구현해야 한다.
 */
type FolderPathStatus = 'exact' | 'truncated' | 'partial' | 'unclassified'

/**
 * 계약 §4.3 응답. folder_id·folder_path 는 **둘 다 nullable**(v2.3 §3.3):
 *   folder_id: null + folder_path: null  → 미분류(시드 루트 부재 폴백)
 *   folder_id: <id> + folder_path: []    → 성립하지 않음 — 경로는 최소 [팀코드]다
 * `[]`(팀 루트 편철 성공)와 `null`(미분류)을 뭉개면 또박또박이 정반대 안내를 한다.
 */
function respondMinute(req: NextRequest, status: number, args: {
  id: string; action: 'created' | 'replaced' | 'skipped'
  title: string; date: string; team: string; meetingId: string | null
  externalId: string; createdByName: string | null; createdAt: string; updatedAt: string
  folderId: string | null; folderPath: string[] | null
  folderPathStatus: FolderPathStatus
  /** v2.5 §4.3 — inline meeting 처리 시에만 값이 있다. undefined 면 키 자체를 넣지 않아 기존 응답 불변. */
  meetingCreated?: boolean
}) {
  return NextResponse.json({
    ok: true, id: args.id, action: args.action,
    title: args.title, date: args.date, team: args.team,
    meeting_id: args.meetingId, external_id: args.externalId,
    ...(args.meetingCreated === undefined ? {} : { meeting_created: args.meetingCreated }),
    folder_id: args.folderId, folder_path: args.folderPath,
    folder_path_status: args.folderPathStatus,
    created_by_name: args.createdByName,
    url: `${req.nextUrl.origin}/minutes/${args.id}`,
    created_at: args.createdAt, updated_at: args.updatedAt,
  }, { status })
}

/**
 * folder_path → 편철 대상 확정 (§3.1 3값 규약 · §3.2 정규화).
 * `provided: false` = 키 부재 → 호출부가 "기존 위치 유지 / 팀 루트 폴백"을 각자 정한다.
 * validation 실패만 400 이고, 시드 루트 부재(no_team_root)는 **등록을 막지 않는다**(§3.2-5).
 */
async function resolvePayloadFolder(
  admin: AdminClient, p: ExternalMinutePayload, actorId: string,
): Promise<
  | { ok: true; provided: false }
  | {
      ok: true; provided: true
      folderId: string | null; folderPath: string[] | null; status: FolderPathStatus
    }
  | { ok: false; error: string }
> {
  if (!p.folderPathProvided || p.folderPath === null) return { ok: true, provided: false }
  const res = await resolveFolderPath(admin, p.teamCode, p.folderPath, {
    actorId, activeTeamCodes: activeTeamCodesSync(),
  })
  if (!res.ok) {
    if (res.kind === 'validation_failed') return { ok: false, error: res.error }
    // no_team_root — 편철 실패가 등록 자체를 막으면 안 된다(resolveTeamRootFolderId 관례 유지).
    // 원인은 거의 항상 0043 미적용이다.
    console.error(`[minutes-api] ${res.error} 미분류 폴백 — 0043 적용 여부를 확인하세요.`)
    return { ok: true, provided: true, folderId: null, folderPath: null, status: 'unclassified' }
  }
  if (!res.complete) {
    console.error(
      `[minutes-api] 폴더 경로 일부만 편철됨: ${res.resolvedPath.join('/')} (목표 ${res.targetPath.join('/')})`,
    )
  }
  // 심각한 쪽부터 — partial(생성 실패로 조상에 떨어짐)은 종전에 완전히 침묵하던 경로다.
  const status: FolderPathStatus = res.failed ? 'partial' : res.truncated ? 'truncated' : 'exact'
  return { ok: true, provided: true, folderId: res.folderId, folderPath: res.resolvedPath, status }
}

/** 동일 external_id 레코드가 이미 있을 때의 on_conflict 분기 — 계약 §4.2. */
async function handleExisting(
  req: NextRequest,
  admin: AdminClient,
  p: ExternalMinutePayload,
  existing: ExistingRow,
  actor: ResolvedUser,
  meetingProjectId: string | null,
  meetingCreated?: boolean,
): Promise<NextResponse> {
  if (existing.archived_at) {
    return apiFail(409, 'archived', '보관된 회의록입니다. 복원 후 다시 시도하세요.')
  }
  if (p.onConflict === 'error') return apiFail(409, 'conflict', '이미 존재하는 external_id 입니다.')
  if (p.onConflict === 'skip') {
    return respondMinute(req, 200, {
      id: existing.id, action: 'skipped', title: existing.title, date: existing.minute_date,
      team: existing.team_code, meetingId: existing.meeting_id, externalId: existing.external_id,
      createdByName: existing.created_by_name, createdAt: existing.created_at, updatedAt: existing.updated_at,
      folderId: existing.folder_id, folderPath: await folderPathOf(admin, existing.folder_id),
      folderPathStatus: existing.folder_id === null ? 'unclassified' : 'exact',
    })
  }
  // replace — §0 D3: created_by/created_by_name/external_id 는 갱신 범위 밖(소유권·멱등키 불변).
  // meeting_id 는 필드가 전송된 경우에만 갱신(부재=유지, null=해제 — v2.2) — 또박또박 v1은
  // 미전송이 기본이라 무조건 갱신하면 수동 연결분(E4)의 프로젝트 연관이 소리 없이 끊긴다.
  const nowIso = new Date().toISOString()
  const targetProjectId = p.meetingIdProvided && p.meetingId
    ? meetingProjectId
    : existing.project_id
  // §3.1 D1=B: 재전송마다 또박또박이 폴더 위치의 SSOT다. 단 3값 — 키 부재면 metadata 에
  // folder_id 키를 **넣지 않아야** 기존 위치가 유지된다(RPC 는 키가 있으면 null 도 적용해
  // 미분류로 강등한다). 시드 루트 부재(folderId null)도 같은 이유로 키를 넣지 않는다 —
  // 되돌릴 위치가 없다고 회의록을 미분류로 빼내면 안 된다.
  const folder = await resolvePayloadFolder(admin, p, actor.id)
  if (!folder.ok) return apiBadRequest(folder.error)
  // ⚠️ 부분 편철(중간 폴더 생성 실패)이면 폴더를 **건드리지 않는다**. 신규 등록은 원래 자리가
  // 없으니 조상에 넣는 편이 미분류보다 낫지만, replace 는 이미 자리가 있는 회의록을 목표의
  // 조상으로 **강등**시키는 셈이다 — 배치가 failed(folder_error) 로 명시 금지한 바로 그 동작이다.
  const folderPartial = folder.provided && folder.status === 'partial'
  if (folderPartial) {
    console.error(`[minutes-api] 부분 편철 — 기존 위치를 유지한다(${p.externalId})`)
  }
  let folderUpdated = folder.provided && folder.folderId !== null && !folderPartial
  let teamMovedFolderId: string | null = null
  // 결정 §6 「구버전 replace 의 team 불일치」 — folder_path 키가 없는데 team 만 바뀐 재전송은
  // 폴더가 옛 팀 서브트리에 남아 "team=ERP 인데 폴더는 MES" 인 데이터를 만든다(§6.4 가 D&D
  // 에서 금지한 상태를 외부 API 가 정상 경로로 만드는 셈). 새 팀 루트로 옮긴다.
  // 400 거절은 구버전 클라이언트의 정상 조작(담당 정정)을 막으므로 채택하지 않는다.
  if (!folderUpdated && p.teamCode !== existing.team_code) {
    teamMovedFolderId = await resolveTeamRootFolderId(admin, p.teamCode)
    if (teamMovedFolderId) folderUpdated = true
    else console.error(`[minutes-api] 담당 변경(${existing.team_code}→${p.teamCode}) 팀 루트 부재 — 폴더 유지`)
  }
  const metadata = {
    minute_date: p.minuteDate,
    team_code: p.teamCode,
    title: p.title,
    meeting_id: p.meetingIdProvided ? p.meetingId : existing.meeting_id,
    project_id: targetProjectId,
    meeting_occurrence_date: p.meetingIdProvided
      ? (p.meetingId ? p.minuteDate : null)
      : existing.meeting_occurrence_date,
    ...(folderUpdated ? { folder_id: teamMovedFolderId ?? (folder.provided ? folder.folderId : null) } : {}),
  }
  // 불변 버전 append + 본문/메타 갱신 + 파일 없는 현재 원본 포인터 해제를 한
  // DB 트랜잭션으로 처리한다. 이전 파일은 기존 minute_version이 계속 보존한다.
  const { data: committedRaw, error } = await admin.rpc('commit_minute_body_version', {
    p_minute_id: existing.id,
    p_body_md: p.bodyMd,
    p_body_hash: fnv1a64(p.bodyMd),
    p_file_name: null,
    p_file_path: null,
    p_file_size: null,
    p_file_mime: null,
    p_actor_id: actor.id,
    p_actor_name: actor.name,
    p_metadata: metadata,
  }).single()
  if (error || !committedRaw) {
    console.error('[minutes-api] replace 원자 커밋 실패:', error?.message ?? 'no row')
    // 계약 v2.4 ⑨ — 비활성 팀은 메타 갱신 RPC 가 t.active 를 요구해 반드시 실패한다.
    // 500 으로 두면 또박또박에서 원인 불명 장애로 보인다.
    if (error?.message?.includes('MINUTE_TEAM_INVALID')) {
      return apiFail(400, 'team_inactive', `비활성 팀(${p.teamCode})입니다. D'Flow에서 팀을 활성화한 뒤 다시 시도하세요.`)
    }
    return apiInternalError()
  }
  const committed = committedRaw as unknown as {
    version_id: string
    wiki_rebuild_required: boolean
  }
  const projectChanged = existing.project_id !== targetProjectId
  const wikiJobId = committed.wiki_rebuild_required || projectChanged
    ? await enqueueMinuteWikiProcessing({
        projectId: targetProjectId,
        minuteId: existing.id,
        minuteVersionId: committed.version_id,
        bodyMd: p.bodyMd,
      })
    : null
  after(async () => {
    await Promise.all([
      runMinutePostProcessing(existing.id, p.bodyMd, {
        rematch: true,
        projectId: targetProjectId,
        minuteVersionId: committed.version_id,
        // 본문 교체/프로젝트 이동은 아래 전체 rebuild가 이 job까지 회의 시점 순서에
        // 맞춰 처리한다. 여기서 따로 실행하면 과거 회의가 늦게 적용돼 거짓 충돌이 생긴다.
        wikiJobId: committed.wiki_rebuild_required || projectChanged ? null : wikiJobId,
      }),
      projectChanged && existing.project_id
        ? rebuildProjectWikiFromActiveMinutes(existing.project_id, existing.id)
        : Promise.resolve(),
      (committed.wiki_rebuild_required || projectChanged) && targetProjectId
        ? rebuildProjectWikiFromActiveMinutes(targetProjectId)
        : Promise.resolve(),
    ])
  })
  // 에코는 **실제 편철 결과**다(§3.3) — 갱신했으면 새 위치, 아니면(키 부재·시드 루트 부재)
  // 손대지 않은 현재 위치. 요청한 경로를 그대로 되돌려주면 안 된다.
  const echoFolderId = folderUpdated
    ? (teamMovedFolderId ?? (folder.provided ? folder.folderId : null))
    : existing.folder_id
  return respondMinute(req, 200, {
    id: existing.id, action: 'replaced', title: p.title, date: p.minuteDate,
    team: p.teamCode, meetingId: p.meetingIdProvided ? p.meetingId : existing.meeting_id,
    externalId: p.externalId,
    // skipped 응답(위)에는 싣지 않는다 — v2.5 §4.3: created/replaced 전용.
    meetingCreated,
    createdByName: existing.created_by_name,
    createdAt: existing.created_at,
    updatedAt: nowIso,
    folderId: echoFolderId,
    folderPath: folderUpdated
      ? (teamMovedFolderId ? [p.teamCode] : (folder.provided ? folder.folderPath : null))
      : await folderPathOf(admin, existing.folder_id),
    folderPathStatus: echoFolderId === null
      ? 'unclassified'
      : (folder.provided && !teamMovedFolderId ? folder.status : 'exact'),
  })
}

async function insertNew(
  req: NextRequest,
  admin: AdminClient,
  p: ExternalMinutePayload,
  user: ResolvedUser,
  meetingProjectId: string | null,
  meetingCreated?: boolean,
): Promise<NextResponse> {
  // folder_path 를 받았으면 팀 루트 아래에 같은 폴더 트리를 만들어 편철하고(§3.2), 키가 아예
  // 없으면(구버전 또박또박) 기존대로 담당 팀 루트로 편철한다(0043). 부재·실패는 미분류(null)
  // 폴백 — 편철 실패가 등록 자체를 막으면 안 된다.
  const folder = await resolvePayloadFolder(admin, p, user.id)
  if (!folder.ok) return apiBadRequest(folder.error)
  const folderId = folder.provided
    ? folder.folderId
    : await resolveTeamRootFolderId(admin, p.teamCode)
  const folderPath = folder.provided
    ? folder.folderPath
    : (folderId ? [p.teamCode] : null)
  const { data: createdRaw, error } = await admin.rpc('create_minute_with_version', {
    p_minute_id: null,
    p_minute_date: p.minuteDate,
    p_team_code: p.teamCode,
    p_title: p.title,
    p_body_md: p.bodyMd,
    p_body_hash: fnv1a64(p.bodyMd),
    p_meeting_id: p.meetingId,
    p_project_id: meetingProjectId,
    p_meeting_occurrence_date: p.meetingId ? p.minuteDate : null,
    p_folder_id: folderId,
    p_external_id: p.externalId,
    p_actor_id: user.id,
    p_actor_name: user.name,
    p_file_name: null,
    p_file_path: null,
    p_file_size: null,
    p_file_mime: null,
  }).single()
  if (error || !createdRaw) {
    // 동시 전송 경합: 부분 unique 인덱스 위반(23505)이면 그 사이 생긴 레코드 기준으로 재분기.
    if (error?.code === '23505') {
      const { data: raced, error: reErr } = await admin.from('minutes')
        .select(MINUTE_SELECT).eq('external_id', p.externalId).maybeSingle()
      if (!reErr && raced) return handleExisting(req, admin, p, raced as ExistingRow, user, meetingProjectId, meetingCreated)
    }
    console.error('[minutes-api] insert 실패:', error?.message ?? 'no row')
    return apiInternalError()
  }
  const created = createdRaw as unknown as {
    minute_id: string
    version_id: string
    created_at: string
    updated_at: string
    wiki_rebuild_required: boolean
  }
  const wikiJobId = await enqueueMinuteWikiProcessing({
    projectId: meetingProjectId,
    minuteId: created.minute_id,
    minuteVersionId: created.version_id,
    bodyMd: p.bodyMd,
  })
  after(async () => {
    await Promise.all([
      runMinutePostProcessing(created.minute_id, p.bodyMd, {
        rematch: false,
        projectId: meetingProjectId,
        minuteVersionId: created.version_id,
        wikiJobId: created.wiki_rebuild_required ? null : wikiJobId,
      }),
      created.wiki_rebuild_required && meetingProjectId
        ? rebuildProjectWikiFromActiveMinutes(meetingProjectId)
        : Promise.resolve(),
    ])
  })
  return respondMinute(req, 201, {
    id: created.minute_id, action: 'created', title: p.title, date: p.minuteDate,
    team: p.teamCode, meetingId: p.meetingId, externalId: p.externalId,
    meetingCreated,
    createdByName: user.name,
    createdAt: created.created_at, updatedAt: created.updated_at,
    folderId, folderPath,
    folderPathStatus: folder.provided
      ? folder.status
      : (folderId === null ? 'unclassified' : 'exact'),
  })
}

export async function POST(req: NextRequest) {
  const gate = gateMinutesApi(req)
  if (gate) return gate

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return apiBadRequest('잘못된 요청입니다.')
  }
  const userEmail = parseUserEmail(raw)
  if (!userEmail) return apiBadRequest('user_email이 필요합니다.')

  try {
    const admin = createAdminClient()
    const user = await resolveUserByEmail(admin, userEmail)
    if (!user) return apiFail(403, 'unknown_user', "해당 이메일의 D'Flow 사용자가 없습니다.")

    const parsed = parseMinutePayload(raw)
    if ('error' in parsed) return apiBadRequest(parsed.error)
    const p = parsed.payload

    let meetingProjectId: string | null = null
    if (p.meetingId) {
      const { data: mt, error: mtErr } = await admin.from('meetings')
        .select('id, project_id').eq('id', p.meetingId).maybeSingle()
      // 쓰기 선행조회 실패를 '회의 없음'으로 오인하면 정상 요청이 400으로 거짓 거절된다 — 실패는 실패로.
      if (mtErr) { console.error('[minutes-api] 회의 존재 확인 실패:', mtErr.message); return apiInternalError() }
      if (!mt) return apiBadRequest('연결할 회의를 찾을 수 없습니다.')
      meetingProjectId = mt.project_id as string
    }

    // upsert 는 사전 select 후 insert/update 분기 — DB ON CONFLICT 구문은 부분 unique 인덱스가
    // conflict 대상 추론에 매칭되지 않아 42P10 으로 실패한다(계약 §12 주의).
    const { data: existing, error: selErr } = await admin.from('minutes')
      .select(MINUTE_SELECT).eq('external_id', p.externalId).maybeSingle()
    if (selErr) { console.error('[minutes-api] 기존 레코드 조회 실패:', selErr.message); return apiInternalError() }

    // v2.5 — skip/error/보관 분기가 회의 확보보다 먼저다. 이 분기들은 회의록을 갱신하지 않는
    // 응답이라 회의를 만들면 실패·무시 응답 뒤에 고아 회의가 남는다(409 archived 포함).
    if (existing) {
      const ex = existing as ExistingRow
      if (ex.archived_at !== null || p.onConflict !== 'replace') {
        return await handleExisting(req, admin, p, ex, user, meetingProjectId)
      }
    }

    // created 또는 replace 진입 확정 후에만 회의를 확보(생성/dedup 재사용)한다. 확보되면
    // meeting_id 가 전송된 것과 완전히 같게 동작하도록 파싱 결과에 주입한다(v2.5 §4.2).
    let meetingCreated: boolean | undefined
    if (p.meeting) {
      const got = await resolveOrCreateExternalMeeting(admin, p.meeting, user)
      if (!got.ok) return apiFail(got.status, got.code, got.error)
      p.meetingId = got.meetingId
      p.meetingIdProvided = true
      meetingProjectId = got.projectId
      meetingCreated = got.created
    }

    if (existing) {
      return await handleExisting(req, admin, p, existing as ExistingRow, user, meetingProjectId, meetingCreated)
    }
    return await insertNew(req, admin, p, user, meetingProjectId, meetingCreated)
  } catch (e) {
    console.error('[minutes-api] POST 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

function clampInt(v: string | null, min: number, max: number, def: number): number {
  const n = v === null ? Number.NaN : Number.parseInt(v, 10)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

export async function GET(req: NextRequest) {
  const gate = gateMinutesApi(req)
  if (gate) return gate

  const sp = req.nextUrl.searchParams
  const team = sp.get('team')
  if (team && !activeTeamCodesSync().includes(team)) return apiBadRequest('잘못된 담당입니다.')
  const dateFrom = sp.get('date_from')
  const dateTo = sp.get('date_to')
  if ((dateFrom && !DATE_RE.test(dateFrom)) || (dateTo && !DATE_RE.test(dateTo))) {
    return apiBadRequest('날짜 형식이 올바르지 않습니다.')
  }
  const linked = sp.get('linked')
  if (linked && linked !== 'true' && linked !== 'false') return apiBadRequest('linked는 true 또는 false여야 합니다.')
  // v2.3 §5.1 — 보관분 포함 조회. 기본 false(현행 동작 유지). 이게 없으면 D'Flow 에서 보관만
  // 해도 또박또박의 exists_on_dflow 가 false 가 되어 '연결 초기화됨'으로 오진하고, 안내하는
  // 복구 두 갈래([D'Flow에서 찾기]·[새로 전송])가 **둘 다 막힌** 상태로 사용자를 보낸다.
  const includeArchivedRaw = sp.get('include_archived')
  if (includeArchivedRaw && includeArchivedRaw !== 'true' && includeArchivedRaw !== 'false') {
    return apiBadRequest('include_archived는 true 또는 false여야 합니다.')
  }
  const includeArchived = includeArchivedRaw === 'true'
  const page = clampInt(sp.get('page'), 1, Number.MAX_SAFE_INTEGER, 1)
  const perPage = clampInt(sp.get('per_page'), 1, 100, 20)

  try {
    const admin = createAdminClient()
    let q = admin.from('minutes').select(
      'id, minute_date, team_code, title, external_id, archived_at, created_by_name, created_at, updated_at',
      { count: 'exact' },
    )
    if (!includeArchived) q = q.is('archived_at', null)
    const externalId = sp.get('external_id')
    if (externalId) q = q.eq('external_id', externalId)
    if (linked === 'true') q = q.not('external_id', 'is', null)
    if (linked === 'false') q = q.is('external_id', null)
    if (team) q = q.eq('team_code', team)
    if (dateFrom) q = q.gte('minute_date', dateFrom)
    if (dateTo) q = q.lte('minute_date', dateTo)

    const offset = (page - 1) * perPage
    const { data, error, count } = await q
      .order('minute_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1)
    if (error) {
      // 범위 초과 페이지는 PostgREST 가 416(PGRST103)을 에러로 넘긴다 — 정상 순회의 일부이므로
      // 같은 필터의 head 카운트로 total 만 채워 빈 페이지로 응답한다(500 아님).
      if (error.code === 'PGRST103') {
        let cq = admin.from('minutes').select('id', { count: 'exact', head: true })
        if (!includeArchived) cq = cq.is('archived_at', null)
        if (externalId) cq = cq.eq('external_id', externalId)
        if (linked === 'true') cq = cq.not('external_id', 'is', null)
        if (linked === 'false') cq = cq.is('external_id', null)
        if (team) cq = cq.eq('team_code', team)
        if (dateFrom) cq = cq.gte('minute_date', dateFrom)
        if (dateTo) cq = cq.lte('minute_date', dateTo)
        const { count: totalCount, error: cntErr } = await cq
        if (!cntErr) return NextResponse.json({ items: [], total: totalCount ?? 0, page, per_page: perPage })
      }
      console.error('[minutes-api] 목록 조회 실패:', error.message)
      return apiInternalError()
    }

    // 본문(body_md) 제외 — 연결 후보 화면용 최소 집합(계약 §5.1)
    const items = ((data ?? []) as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      title: row.title as string,
      date: row.minute_date as string,
      team: row.team_code as string,
      external_id: (row.external_id as string | null) ?? null,
      // 또박또박이 '초기화됨'과 '보관됨'을 구분해 안내하는 근거(§9.7 (a)).
      archived: row.archived_at != null,
      created_by_name: (row.created_by_name as string | null) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      url: `${req.nextUrl.origin}/minutes/${row.id as string}`,
    }))
    return NextResponse.json({ items, total: count ?? 0, page, per_page: perPage })
  } catch (e) {
    console.error('[minutes-api] GET 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

// 미정의 메서드도 404 — 405 + Allow 응답이 비활성 라우트의 존재를 노출하지 않게(§3.4 존재 은닉 보강).
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
