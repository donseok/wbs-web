import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type {
  ExplorerData, ExplorerLeaf, InsightKind, MeetingCategory, Minute, MinuteFile, MinuteFolder, MinuteHighlight,
  MinuteInsight, TeamCode,
} from '@/lib/domain/types'
import { ilikeOrPattern, MINUTES_TREE_LIMIT } from '@/lib/domain/minutes'
import { folderPathOf } from '@/lib/minutes/folders'
import type { MinuteSignal } from '@/components/dashboard/MinuteSignals'
import type { MinuteVersionListItem } from '@/components/minutes/MinuteVersionPanel'
import type {
  MinuteWikiImpactCardProps, MinuteWikiImpactCounts, MinuteWikiImpactItem, MinuteWikiSyncStatus,
} from '@/components/minutes/MinuteWikiImpactCard'
import { createAdminClient } from '@/lib/supabase/admin'

type Row = Record<string, unknown>

/** 인사이트 조회 컬럼 — 다른 테이블을 임베드하지 않는다.
 *  임베드로 묶으면 그 테이블/관계가 어긋난 순간 PostgREST가 쿼리 전체를 거절해 인사이트가 통째로 사라진다(2026-07 실제 사고). */
const INSIGHT_COLS = 'id, minute_id, body_hash, kind, label, block_index, block_hash'

export const getProjectMinuteSignals = cache(async (projectId: string, limit = 8): Promise<MinuteSignal[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('minute_insights')
    .select(`${INSIGHT_COLS}, minutes!inner(title, minute_date, meeting_id, archived_at, meetings!inner(project_id))`)
    .in('kind', ['action', 'risk', 'decision', 'deadline'])
    .eq('minutes.meetings.project_id', projectId)
    .is('minutes.archived_at', null)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) {
    console.error('[getProjectMinuteSignals] 조회 실패:', error.message)
    return []
  }
  return ((data ?? []) as Row[]).map((r: Row) => {
    const minute = r.minutes as Row
    return {
      id: r.id as string, minuteId: r.minute_id as string, bodyHash: r.body_hash as string,
      kind: r.kind as 'action' | 'risk' | 'decision' | 'deadline', label: r.label as string, blockIndex: r.block_index as number,
      blockHash: r.block_hash as string,
      minuteTitle: minute.title as string, minuteDate: minute.minute_date as string,
    }
  })
})

const LIST_COLS =
  'id, minute_date, team_code, title, meeting_id, project_id, meeting_occurrence_date, archived_at, created_by, created_by_name, created_at, updated_at, body_preview, folder_id, minute_files(count), meetings(category, project_id), projects(name)'

function mapMinute(r: Row, bodyMd = ''): Minute {
  const files = r.minute_files as { count: number }[] | undefined
  return {
    id: r.id as string,
    minuteDate: r.minute_date as string,
    teamCode: r.team_code as TeamCode,
    title: r.title as string,
    bodyMd,
    meetingId: (r.meeting_id as string | null) ?? null,
    projectId: (r.project_id as string | null)
      ?? ((r.meetings as { project_id?: string } | null)?.project_id ?? null),
    projectName: ((r.projects as { name?: string } | null)?.name) ?? null,
    meetingOccurrenceDate: (r.meeting_occurrence_date as string | null) ?? null,
    // 목록/트리에서도 '연결된 회의' 링크를 걸려면 회의의 프로젝트가 필요하다(projectId 는 회의와 다른
    // 프로젝트로 지정될 수 있어 대체재가 아니다). 조인이 비면 null — 링크를 만들지 않는다.
    meetingProjectId: ((r.meetings as { project_id?: string } | null)?.project_id) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    archivedAt: (r.archived_at as string | null) ?? null,
    fileCount: files?.[0]?.count ?? 0,
    bodyPreview: (r.body_preview as string | null) ?? '',
    meetingCategory: ((r.meetings as { category?: MeetingCategory } | null)?.category) ?? null,
    folderId: (r.folder_id as string | null) ?? null,
    externalId: (r.external_id as string | null) ?? null,
  }
}

/** 기간(달력 그리드) + 담당 필터 목록. body_md 제외. 실패 시 빈 배열. */
export const getMinutesPage = cache(async (
  rangeStart: string, rangeEnd: string, team: TeamCode | null,
): Promise<Minute[]> => {
  const sb = await createServerClient()
  let q = sb.from('minutes').select(LIST_COLS)
    .is('archived_at', null)
    .gte('minute_date', rangeStart).lte('minute_date', rangeEnd)
    .order('minute_date', { ascending: false }).order('created_at', { ascending: false })
  if (team) q = q.eq('team_code', team)
  const { data, error } = await q
  // 표시용 목록 — 실패를 삼키면 보관함이 '회의록 없음' 빈 화면으로 위장돼 재업로드를 유발한다. 최소한 원인은 남긴다.
  if (error) console.error('[getMinutesPage] 조회 실패:', error.message)
  return (data ?? []).map((r: Row) => mapMinute(r))
})

/** 전 기간 제목/본문 ILIKE 검색 — minute_date desc, 최대 limit건. */
export const searchMinutes = cache(async (
  qtext: string, team: TeamCode | null, limit = 100,
): Promise<Minute[]> => {
  const needle = qtext.trim()
  if (!needle) return []
  const sb = await createServerClient()
  const pat = ilikeOrPattern(needle)
  let q = sb.from('minutes').select(LIST_COLS)
    .is('archived_at', null)
    .or(`title.ilike.${pat},body_md.ilike.${pat}`)
    .order('minute_date', { ascending: false }).limit(limit)
  if (team) q = q.eq('team_code', team)
  const { data, error } = await q
  // 표시용 검색 — 실패를 '검색 결과 0건'으로 위장하면 사용자는 회의록이 없다고 오인한다. 폴백은 유지하되 로깅.
  if (error) console.error('[searchMinutes] 조회 실패:', error.message)
  return (data ?? []).map((r: Row) => mapMinute(r))
})

/** 탐색기 v2 — 전 기간 리프 + 폴더 전량. 실패 시 로깅 + null(빈 결과 객체와 구분 —
 *  조용한 빈 화면 방지). 트리 조립은 클라이언트(buildFolderTree) — 팀 탭 필터를 리프에
 *  먼저 적용해야 하므로 서버 조립은 성립하지 않는다. */
export const getMinutesExplorer = cache(async (): Promise<ExplorerData | null> => {
  const sb = await createServerClient()
  const [mRes, fRes] = await Promise.all([
    sb.from('minutes').select(LIST_COLS)
      .is('archived_at', null)
      .order('minute_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(MINUTES_TREE_LIMIT),
    sb.from('minute_folders').select('id, name, parent_id, sort, created_by')
      .order('sort').order('name'),
  ])
  if (mRes.error || fRes.error) {
    console.error('[getMinutesExplorer] 조회 실패:', mRes.error?.message ?? fRes.error?.message)
    return null
  }
  const rows = (mRes.data ?? []).map((r: Row) => mapMinute(r))
  const leaves: ExplorerLeaf[] = rows.map(mi => ({
    id: mi.id, minuteDate: mi.minuteDate, teamCode: mi.teamCode, title: mi.title,
    fileCount: mi.fileCount ?? 0, createdBy: mi.createdBy, createdByName: mi.createdByName,
    bodyPreview: mi.bodyPreview ?? '', meetingCategory: mi.meetingCategory ?? null,
    folderId: mi.folderId ?? null,
    projectId: mi.projectId ?? null, projectName: mi.projectName ?? null,
    meetingId: mi.meetingId, meetingProjectId: mi.meetingProjectId ?? null,
  }))
  const folders: MinuteFolder[] = ((fRes.data ?? []) as Row[]).map(f => ({
    id: f.id as string, name: f.name as string,
    parentId: (f.parent_id as string | null) ?? null,
    sort: f.sort as number, createdBy: (f.created_by as string | null) ?? null,
  }))
  return { folders, leaves, total: rows.length, truncated: rows.length >= MINUTES_TREE_LIMIT }
})

/** 뷰어 상세 — body_md + 파일 목록(서명 URL 없이 메타만). 없으면 null. */
export const getMinuteDetail = cache(async (
  id: string,
): Promise<{ minute: Minute; files: MinuteFile[] } | null> => {
  const sb = await createServerClient()
  const { data: r, error } = await sb.from('minutes')
    .select('id, minute_date, team_code, title, body_md, meeting_id, project_id, meeting_occurrence_date, archived_at, external_id, created_by, created_by_name, created_at, updated_at, folder_id, meetings(project_id), projects(name)')
    .eq('id', id).maybeSingle()
  // null 은 호출자에서 404(삭제됨)로 렌더된다 — 조회 실패를 '행 없음'으로 위장하면
  // 멀쩡히 존재하는 회의록이 삭제된 것처럼 보인다. 실패는 실패로 터뜨린다.
  if (error) throw new Error(`[getMinuteDetail] 조회 실패: ${error.message}`)
  if (!r) return null
  const { data: fs, error: fsErr } = await sb.from('minute_files')
    .select('id, minute_id, role, file_name, file_path, size, mime, created_at')
    .eq('minute_id', id).order('created_at', { ascending: true })
  // 파일 목록은 부가 정보 — 본문까지 못 보게 막을 이유는 없어 로깅 후 빈 목록으로 진행.
  if (fsErr) console.error('[getMinuteDetail] 파일 목록 조회 실패:', fsErr.message)
  const files: MinuteFile[] = (fs ?? []).map((f: Row) => ({
    id: f.id as string,
    minuteId: f.minute_id as string,
    role: f.role as 'body' | 'attachment',
    fileName: f.file_name as string,
    filePath: f.file_path as string,
    size: (f.size as number) ?? null,
    mime: (f.mime as string) ?? null,
    createdAt: f.created_at as string,
  }))
  const minute = mapMinute(r as Row, (r as Row).body_md as string)
  minute.meetingProjectId = ((r as Row).meetings as { project_id: string } | null)?.project_id
    ?? minute.projectId ?? null
  return { minute, files }
})

/** 뷰어 breadcrumb 용 폴더 경로(root-first 이름 배열). 미분류·조회 실패·끊긴 체인은 null —
 *  호출부는 minute.folderId 유무로 '미분류'와 '경로 확인 불가'를 구분해 표시한다(실패를
 *  '미분류'로 위장하지 않는다). 실패는 folderPathOf 내부에서 이미 로깅된다. */
export const getMinuteFolderPath = cache(async (
  folderId: string | null,
): Promise<string[] | null> => {
  if (!folderId) return null
  const sb = await createServerClient()
  return folderPathOf(sb, folderId)
})

/** 뷰어 주석 데이터 — 하이라이트 전체 + AI 인사이트. 실패 시 빈 배열(뷰어는 주석 없이 동작). */
export const getMinuteAnnotations = cache(async (
  id: string,
): Promise<{ highlights: MinuteHighlight[]; insights: MinuteInsight[] }> => {
  const sb = await createServerClient()
  const [{ data: hs, error: hsErr }, { data: ins, error: insErr }] = await Promise.all([
    sb.from('minute_highlights')
      .select('id, minute_id, block_index, block_hash, created_by, created_by_name, created_at')
      .eq('minute_id', id).order('created_at', { ascending: true }),
    sb.from('minute_insights')
      .select(INSIGHT_COLS)
      .eq('minute_id', id),
  ])
  if (hsErr) console.error('[getMinuteAnnotations] 하이라이트 조회 실패:', hsErr.message)
  if (insErr) console.error('[getMinuteAnnotations] 인사이트 조회 실패:', insErr.message)
  const insRows = (ins ?? []) as Row[]
  return {
    highlights: (hs ?? []).map((r: Row) => ({
      id: r.id as string,
      minuteId: r.minute_id as string,
      blockIndex: r.block_index as number,
      blockHash: r.block_hash as string,
      createdBy: r.created_by as string,
      createdByName: (r.created_by_name as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
    insights: insRows.map((r: Row) => ({
      id: r.id as string,
      minuteId: r.minute_id as string,
      bodyHash: r.body_hash as string,
      kind: r.kind as InsightKind | 'none',
      label: r.label as string,
      blockIndex: r.block_index as number,
      blockHash: r.block_hash as string,
    })),
  }
})

/** 불변 원본 버전 목록. 파일이 있으면 한 시간 유효한 다운로드 URL을 함께 발급한다. */
export const getMinuteVersions = cache(async (
  id: string,
): Promise<MinuteVersionListItem[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('minute_versions')
    .select('id, version_no, title, minute_date, file_name, file_path, created_by_name, created_at')
    .eq('minute_id', id)
    .order('version_no', { ascending: false })
  if (error) {
    // 0045 미적용 환경에서는 상세 본문 자체는 계속 볼 수 있게 버전 카드만 숨긴다.
    console.error('[getMinuteVersions] 조회 실패:', error.message)
    return []
  }
  return await Promise.all(((data ?? []) as Row[]).map(async row => {
    const filePath = (row.file_path as string | null) ?? null
    let downloadHref: string | null = null
    if (filePath) {
      const { data: signed, error: signedError } = await sb.storage.from('minutes').createSignedUrl(
        filePath,
        3600,
        { download: ((row.file_name as string | null) ?? true) as string | true },
      )
      if (signedError) console.error('[getMinuteVersions] 서명 URL 발급 실패:', signedError.message)
      downloadHref = signed?.signedUrl ?? null
    }
    return {
      id: row.id as string,
      versionNo: row.version_no as number,
      title: (row.title as string | null) ?? null,
      minuteDate: (row.minute_date as string | null) ?? null,
      createdAt: row.created_at as string,
      createdByName: (row.created_by_name as string | null) ?? null,
      fileName: (row.file_name as string | null) ?? null,
      downloadHref,
      viewHref: `/minutes/${id}?version=${encodeURIComponent(row.id as string)}`,
    }
  }))
})

export interface MinuteVersionBody {
  id: string
  versionNo: number
  bodyMd: string
  bodyHash: string
  title: string | null
  minuteDate: string | null
  teamCode: TeamCode | null
  meetingId: string | null
  projectId: string | null
  meetingOccurrenceDate: string | null
  createdAt: string
}

/** Wiki 원문 링크가 교체 전 근거도 정확히 열 수 있도록 특정 불변 버전 본문을 조회한다. */
export const getMinuteVersionBody = cache(async (
  minuteId: string,
  versionId: string,
): Promise<MinuteVersionBody | null> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('minute_versions')
    .select('id, version_no, body_md, body_hash, title, minute_date, team_code, meeting_id, project_id, meeting_occurrence_date, created_at')
    .eq('id', versionId)
    .eq('minute_id', minuteId)
    .maybeSingle()
  if (error) {
    console.error('[getMinuteVersionBody] 조회 실패:', error.message)
    return null
  }
  if (!data) return null
  return {
    id: data.id as string,
    versionNo: data.version_no as number,
    bodyMd: data.body_md as string,
    bodyHash: data.body_hash as string,
    title: (data.title as string | null) ?? null,
    minuteDate: (data.minute_date as string | null) ?? null,
    teamCode: (data.team_code as TeamCode | null) ?? null,
    meetingId: (data.meeting_id as string | null) ?? null,
    projectId: (data.project_id as string | null) ?? null,
    meetingOccurrenceDate: (data.meeting_occurrence_date as string | null) ?? null,
    createdAt: data.created_at as string,
  }
})

const EMPTY_WIKI_COUNTS: MinuteWikiImpactCounts = {
  created: 0,
  changed: 0,
  reaffirmed: 0,
  conflicted: 0,
}

function jobSummary(payload: unknown): MinuteWikiImpactCounts {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ...EMPTY_WIKI_COUNTS }
  const summary = (payload as Row).summary
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return { ...EMPTY_WIKI_COUNTS }
  const row = summary as Row
  const count = (key: keyof MinuteWikiImpactCounts) =>
    typeof row[key] === 'number' && Number.isFinite(row[key]) ? Math.max(0, row[key] as number) : 0
  return {
    created: count('created'),
    changed: count('changed'),
    reaffirmed: count('reaffirmed'),
    conflicted: count('conflicted'),
  }
}

function impactChange(changeType: string): keyof MinuteWikiImpactCounts {
  if (changeType === 'new') return 'created'
  if (changeType === 'reaffirm') return 'reaffirmed'
  if (changeType === 'conflict') return 'conflicted'
  return 'changed'
}

/** 회의록 상세의 "Wiki 반영 결과" 읽기 모델. 내부 큐는 service-role로만 조회한다. */
export const getMinuteWikiImpact = cache(async (
  minuteId: string,
  projectId: string | null,
  projectName: string | null,
): Promise<MinuteWikiImpactCardProps> => {
  if (!projectId) {
    return {
      status: 'unlinked',
      counts: { ...EMPTY_WIKI_COUNTS },
      items: [],
      wikiHref: null,
      projectName: null,
      processedAt: null,
    }
  }

  const fallback: MinuteWikiImpactCardProps = {
    status: 'queued',
    counts: { ...EMPTY_WIKI_COUNTS },
    items: [],
    wikiHref: `/p/${projectId}/wiki`,
    projectName,
    processedAt: null,
  }
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return fallback

  const admin = createAdminClient()
  const { data: job, error: jobError } = await admin.from('wiki_processing_jobs')
    .select('status, payload, updated_at')
    .eq('minute_id', minuteId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (jobError) {
    console.error('[getMinuteWikiImpact] 작업 조회 실패:', jobError.message)
    return fallback
  }

  const counts = jobSummary(job?.payload)
  let status: MinuteWikiSyncStatus = 'queued'
  if (job?.status === 'running') status = 'processing'
  else if (job?.status === 'dead_letter') status = 'failed'
  else if (job?.status === 'done') status = counts.conflicted > 0 ? 'partial' : 'ready'

  const { data: changes, error: changesError } = await admin.from('wiki_change_events')
    .select('wiki_item_id, change_type, created_at')
    .eq('minute_id', minuteId)
    .eq('project_id', projectId)
    .not('wiki_item_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20)
  if (changesError) {
    console.error('[getMinuteWikiImpact] 변경 이력 조회 실패:', changesError.message)
    return { ...fallback, status, counts, processedAt: (job?.updated_at as string | null) ?? null }
  }

  const latestByItem = new Map<string, Row>()
  for (const change of (changes ?? []) as Row[]) {
    const itemId = change.wiki_item_id as string
    if (itemId && !latestByItem.has(itemId)) latestByItem.set(itemId, change)
  }
  const itemIds = [...latestByItem.keys()]
  let items: MinuteWikiImpactItem[] = []
  if (itemIds.length > 0) {
    const { data: wikiItems, error: itemError } = await admin.from('wiki_items')
      .select('id, topic_id, kind, statement, lifecycle_state')
      .in('id', itemIds)
    if (itemError) {
      console.error('[getMinuteWikiImpact] 항목 조회 실패:', itemError.message)
    } else {
      items = ((wikiItems ?? []) as Row[])
        .filter(item => item.lifecycle_state !== 'archived')
        .map(item => {
          const change = latestByItem.get(item.id as string)
          return {
            id: item.id as string,
            title: item.statement as string,
            href: `/p/${projectId}/wiki/topics/${item.topic_id as string}#wiki-item-${item.id as string}`,
            kindLabel: item.kind as string,
            change: impactChange((change?.change_type as string | undefined) ?? 'new'),
          }
        })
        .slice(0, 8)
    }
  }
  return {
    status,
    counts,
    items,
    wikiHref: `/p/${projectId}/wiki`,
    projectName,
    processedAt: (job?.updated_at as string | null) ?? null,
  }
})

/** 내 즐겨찾기 회의록 id 목록(RLS 가 본인 행으로 한정). 실패 시 로깅 + null —
 *  빈 배열과 구분해 '즐겨찾기 없음'으로 위장되는 조용한 빈 화면을 방지한다.
 *  세션 없는 조회는 200+[] 로 돌아오므로(0039 RLS to authenticated) 호출측(page)이 세션 게이트를 건다. */
export const getMinuteFavorites = cache(async (): Promise<string[] | null> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('minute_favorites').select('minute_id')
  if (error) {
    console.error('[getMinuteFavorites] 조회 실패:', error.message)
    return null
  }
  return (data ?? []).map((r: Row) => r.minute_id as string)
})
