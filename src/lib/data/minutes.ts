import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type {
  InsightKind, Minute, MinuteCommitment, MinuteCommitmentReviewStatus,
  MinuteFile, MinuteHighlight, MinuteInsight, TeamCode,
} from '@/lib/domain/types'
import { ilikeOrPattern } from '@/lib/domain/minutes'
import type { MinuteSignal } from '@/components/dashboard/MinuteSignals'

type Row = Record<string, unknown>

/** 인사이트 조회 컬럼 — 다른 테이블을 임베드하지 않는다.
 *  임베드로 묶으면 그 테이블/관계가 어긋난 순간 PostgREST가 쿼리 전체를 거절해 인사이트가 통째로 사라진다(2026-07 실제 사고). */
const INSIGHT_COLS = 'id, minute_id, body_hash, kind, label, block_index, block_hash'
const COMMITMENT_COLS =
  'id, minute_id, body_hash, context_hash, source_revision, commitment_hash, commitment_text, source_quote, block_index, block_hash, owner_name, owner_team, owner_unassigned, due_text, due_date, due_undecided, review_status, reviewed_by, reviewed_by_name, reviewed_at, created_at, updated_at'

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
  'id, minute_date, team_code, title, meeting_id, created_by, created_by_name, created_at, updated_at, minute_files(count)'

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
    ...(r.commitment_revision !== undefined
      ? { commitmentRevision: Number(r.commitment_revision) }
      : {}),
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

/** 뷰어 상세 — body_md + 파일 목록(서명 URL 없이 메타만). 없으면 null. */
export const getMinuteDetail = cache(async (
  id: string,
): Promise<{ minute: Minute; files: MinuteFile[] } | null> => {
  const sb = await createServerClient()
  const { data: r, error } = await sb.from('minutes')
    .select('id, minute_date, team_code, title, body_md, commitment_revision, meeting_id, created_by, created_by_name, created_at, updated_at, meetings(project_id)')
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

/** 구조화 약속 + 사람의 검토 이력. 외부 공유 화면에는 호출하지 않는다. */
export const getMinuteCommitments = cache(async (id: string): Promise<MinuteCommitment[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('minute_commitments')
    .select(COMMITMENT_COLS)
    .eq('minute_id', id)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[getMinuteCommitments] 조회 실패:', error.message)
    return []
  }
  return ((data ?? []) as Row[]).map((r): MinuteCommitment => ({
    id: r.id as string,
    minuteId: r.minute_id as string,
    bodyHash: r.body_hash as string,
    contextHash: r.context_hash as string,
    sourceRevision: Number(r.source_revision),
    commitmentHash: r.commitment_hash as string,
    commitmentText: r.commitment_text as string,
    sourceQuote: r.source_quote as string,
    blockIndex: r.block_index as number,
    blockHash: r.block_hash as string,
    ownerName: (r.owner_name as string | null) ?? null,
    ownerTeam: (r.owner_team as TeamCode | null) ?? null,
    ownerUnassigned: !!r.owner_unassigned,
    dueText: (r.due_text as string | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null,
    dueUndecided: !!r.due_undecided,
    reviewStatus: r.review_status as MinuteCommitmentReviewStatus,
    reviewedBy: (r.reviewed_by as string | null) ?? null,
    reviewedByName: (r.reviewed_by_name as string | null) ?? null,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }))
})
