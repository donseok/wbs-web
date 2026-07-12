import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { InsightKind, Minute, MinuteFile, MinuteHighlight, MinuteInsight, TeamCode } from '@/lib/domain/types'
import { ilikeOrPattern } from '@/lib/domain/minutes'

type Row = Record<string, unknown>

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
  const { data } = await q
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
  const { data } = await q
  return (data ?? []).map((r: Row) => mapMinute(r))
})

/** 뷰어 상세 — body_md + 파일 목록(서명 URL 없이 메타만). 없으면 null. */
export const getMinuteDetail = cache(async (
  id: string,
): Promise<{ minute: Minute; files: MinuteFile[] } | null> => {
  const sb = await createServerClient()
  const { data: r } = await sb.from('minutes')
    .select('id, minute_date, team_code, title, body_md, meeting_id, created_by, created_by_name, created_at, updated_at, meetings(project_id)')
    .eq('id', id).maybeSingle()
  if (!r) return null
  const { data: fs } = await sb.from('minute_files')
    .select('id, minute_id, role, file_name, file_path, size, mime, created_at')
    .eq('minute_id', id).order('created_at', { ascending: true })
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
  const [{ data: hs }, { data: ins }] = await Promise.all([
    sb.from('minute_highlights')
      .select('id, minute_id, block_index, block_hash, created_by, created_by_name, created_at')
      .eq('minute_id', id).order('created_at', { ascending: true }),
    sb.from('minute_insights')
      .select('id, minute_id, body_hash, kind, label, block_index, block_hash')
      .eq('minute_id', id),
  ])
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
    insights: (ins ?? []).map((r: Row) => ({
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
