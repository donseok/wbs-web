import { ilikeOrPattern } from '@/lib/domain/minutes'
import type { TeamCode } from '@/lib/domain/types'
import {
  repositoryError,
  repositoryOk,
  type MinuteDetailSnapshot,
  type MinuteFileMetadataRecord,
  type MinuteInsightRecord,
  type MinuteRepositoryRecord,
  type MinuteSearchSnapshot,
  type MinutesRepository,
} from '@/lib/repositories/types'
import { isRetryableReadError, nestedOne, type SupabaseServerClient } from './common'

type Row = Record<string, unknown>

/** created_by(원시 auth ID)는 계약에 없으므로 select 자체에서 제외한다. */
const MINUTE_COLUMNS = [
  'id', 'minute_date', 'team_code', 'title', 'meeting_id',
  'created_by_name', 'created_at', 'updated_at',
].join(', ')

/** 인사이트는 다른 테이블을 임베드하지 않는다 — 관계가 어긋나는 순간 쿼리 전체가 거절돼 인사이트가 통째로 사라진다(2026-07 실제 사고). */
const INSIGHT_COLUMNS = 'kind, label, block_index'

/** file_path(Storage 경로)·signed URL 관련 컬럼은 select 자체에서 제외한다. */
const FILE_COLUMNS = 'file_name, size, mime, created_at'

function mapMinute(row: Row): MinuteRepositoryRecord {
  const meeting = nestedOne(row.meetings as { project_id?: unknown } | { project_id?: unknown }[] | null)
  return {
    id: row.id as string,
    minuteDate: row.minute_date as string,
    teamCode: row.team_code as TeamCode,
    title: row.title as string,
    meetingId: (row.meeting_id as string | null) ?? null,
    meetingProjectId: typeof meeting?.project_id === 'string' ? meeting.project_id : null,
    createdByName: (row.created_by_name as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string | null) ?? null,
  }
}

export function createSupabaseMinutesRepository(client: SupabaseServerClient): MinutesRepository {
  return {
    async searchMinutes({ query, team, projectId, from, to, limit }) {
      // 프로젝트 필터는 meeting 역참조가 있어야 성립 — inner 조인이라 회의 미연결 회의록은 제외된다.
      const relation = projectId ? 'meetings!inner(project_id)' : 'meetings(project_id)'
      let request = client
        .from('minutes')
        .select(`${MINUTE_COLUMNS}, ${relation}`)
      if (query) {
        const pattern = ilikeOrPattern(query)
        request = request.or(`title.ilike.${pattern},body_md.ilike.${pattern}`)
      }
      if (team) request = request.eq('team_code', team)
      if (projectId) request = request.eq('meetings.project_id', projectId)
      if (from) request = request.gte('minute_date', from)
      if (to) request = request.lte('minute_date', to)
      const result = await request
        .order('minute_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit + 1)

      if (result.error) {
        return repositoryError('MINUTES_READ_FAILED', isRetryableReadError(result.error))
      }
      const rows = (result.data ?? []) as unknown as Row[]
      const snapshot: MinuteSearchSnapshot = {
        records: rows.slice(0, limit).map(mapMinute),
        truncated: rows.length > limit,
      }
      return repositoryOk(snapshot)
    },

    async getMinuteDetail(minuteId) {
      const minuteResult = await client
        .from('minutes')
        .select(`${MINUTE_COLUMNS}, body_md, meetings(project_id)`)
        .eq('id', minuteId)
        .maybeSingle()
      if (minuteResult.error) {
        return repositoryError('MINUTE_DETAIL_READ_FAILED', isRetryableReadError(minuteResult.error))
      }
      if (!minuteResult.data) return repositoryOk(null)
      const row = minuteResult.data as unknown as Row

      const [insightsResult, filesResult] = await Promise.all([
        client
          .from('minute_insights')
          .select(INSIGHT_COLUMNS)
          .eq('minute_id', minuteId)
          .order('block_index', { ascending: true }),
        client
          .from('minute_files')
          .select(FILE_COLUMNS)
          .eq('minute_id', minuteId)
          .order('created_at', { ascending: true }),
      ])
      // 부속 조회 실패를 빈 목록으로 위장하지 않는다 — '인사이트/파일 없음'과 '조회 실패'는 다른 상태다.
      if (insightsResult.error) {
        return repositoryError('MINUTE_INSIGHTS_READ_FAILED', isRetryableReadError(insightsResult.error))
      }
      if (filesResult.error) {
        return repositoryError('MINUTE_FILES_READ_FAILED', isRetryableReadError(filesResult.error))
      }

      const insights: MinuteInsightRecord[] = ((insightsResult.data ?? []) as Row[]).map(record => ({
        kind: record.kind as string,
        label: record.label as string,
        blockIndex: record.block_index as number,
      }))
      const files: MinuteFileMetadataRecord[] = ((filesResult.data ?? []) as Row[]).map(record => ({
        fileName: record.file_name as string,
        size: (record.size as number | null) ?? null,
        mime: (record.mime as string | null) ?? null,
        createdAt: record.created_at as string,
      }))
      const snapshot: MinuteDetailSnapshot = {
        minute: { ...mapMinute(row), bodyMd: (row.body_md as string) ?? '' },
        insights,
        files,
      }
      return repositoryOk(snapshot)
    },
  }
}
