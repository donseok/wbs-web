import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type {
  ExplorerData, ExplorerLeaf, InsightKind, MeetingCategory, Minute, MinuteFile, MinuteFolder, MinuteHighlight,
  MinuteInsight, MinutesTreeGroup, TeamCode,
} from '@/lib/domain/types'
import { buildMinutesTree, ilikeOrPattern, MINUTES_TREE_LIMIT } from '@/lib/domain/minutes'
import type { MinuteSignal } from '@/components/dashboard/MinuteSignals'

type Row = Record<string, unknown>

/** 인사이트 조회 컬럼 — 다른 테이블을 임베드하지 않는다.
 *  임베드로 묶으면 그 테이블/관계가 어긋난 순간 PostgREST가 쿼리 전체를 거절해 인사이트가 통째로 사라진다(2026-07 실제 사고). */
const INSIGHT_COLS = 'id, minute_id, body_hash, kind, label, block_index, block_hash'

export const getProjectMinuteSignals = cache(async (projectId: string, limit = 8): Promise<MinuteSignal[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('minute_insights')
    .select(`${INSIGHT_COLS}, minutes!inner(title, minute_date, meeting_id, meetings!inner(project_id))`)
    .in('kind', ['action', 'risk', 'decision', 'deadline'])
    .eq('minutes.meetings.project_id', projectId)
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
  'id, minute_date, team_code, title, meeting_id, created_by, created_by_name, created_at, updated_at, body_preview, folder_id, minute_files(count), meetings(category)'

function mapMinute(r: Row, bodyMd = ''): Minute {
  const files = r.minute_files as { count: number }[] | undefined
  return {
    id: r.id as string,
    minuteDate: r.minute_date as string,
    teamCode: r.team_code as TeamCode,
    title: r.title as string,
    bodyMd,
    meetingId: (r.meeting_id as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    fileCount: files?.[0]?.count ?? 0,
    bodyPreview: (r.body_preview as string | null) ?? '',
    meetingCategory: ((r.meetings as { category?: MeetingCategory } | null)?.category) ?? null,
    folderId: (r.folder_id as string | null) ?? null,
  }
}

/** 기간(달력 그리드) + 담당 필터 목록. body_md 제외. 실패 시 빈 배열. */
export const getMinutesPage = cache(async (
  rangeStart: string, rangeEnd: string, team: TeamCode | null,
): Promise<Minute[]> => {
  const sb = await createServerClient()
  let q = sb.from('minutes').select(LIST_COLS)
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
    .or(`title.ilike.${pat},body_md.ilike.${pat}`)
    .order('minute_date', { ascending: false }).limit(limit)
  if (team) q = q.eq('team_code', team)
  const { data, error } = await q
  // 표시용 검색 — 실패를 '검색 결과 0건'으로 위장하면 사용자는 회의록이 없다고 오인한다. 폴백은 유지하되 로깅.
  if (error) console.error('[searchMinutes] 조회 실패:', error.message)
  return (data ?? []).map((r: Row) => mapMinute(r))
})

/** 전 기간·전 팀 트리(구분→회의체→회의록). 실패 시 로깅 + null —
 *  빈 트리 []와 구분해 '회의록 없음'으로 위장되는 조용한 빈 화면을 방지한다.
 *  MINUTES_TREE_LIMIT(1000)은 PostgREST max_rows 하드 캡과 일치 — 서버 캡이 .limit보다 우선하므로
 *  이보다 큰 값은 성립하지 않는다. total은 집계에 사용된(표시되는) 행 수이며 실제 전체 건수가 아니다. */
export const getMinutesTree = cache(async (): Promise<
  { groups: MinutesTreeGroup[]; total: number; truncated: boolean } | null
> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('minutes').select(LIST_COLS)
    .order('minute_date', { ascending: false }).order('created_at', { ascending: false })
    .limit(MINUTES_TREE_LIMIT)
  if (error) {
    console.error('[getMinutesTree] 조회 실패:', error.message)
    return null
  }
  const rows = (data ?? []).map((r: Row) => mapMinute(r))
  return {
    groups: buildMinutesTree(rows),
    total: rows.length,
    truncated: rows.length >= MINUTES_TREE_LIMIT,
  }
})

/** 탐색기 v2 — 전 기간 리프 + 폴더 전량. 실패 시 로깅 + null(빈 결과 객체와 구분 —
 *  조용한 빈 화면 방지). 트리 조립은 클라이언트(buildFolderTree) — 팀 탭 필터를 리프에
 *  먼저 적용해야 하므로 서버 조립은 성립하지 않는다. */
export const getMinutesExplorer = cache(async (): Promise<ExplorerData | null> => {
  const sb = await createServerClient()
  const [mRes, fRes] = await Promise.all([
    sb.from('minutes').select(LIST_COLS)
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
    .select('id, minute_date, team_code, title, body_md, meeting_id, created_by, created_by_name, created_at, updated_at, meetings(project_id)')
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
  minute.meetingProjectId = ((r as Row).meetings as { project_id: string } | null)?.project_id ?? null
  return { minute, files }
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
