import type { AnnouncementCategory } from '@/lib/domain/types'
import {
  repositoryError,
  repositoryOk,
  type AnnouncementListSnapshot,
  type AnnouncementRepository,
  type AnnouncementRepositoryRecord,
} from '@/lib/repositories/types'
import { isRetryableReadError, type SupabaseServerClient } from './common'

type Row = Record<string, unknown>

const ANNOUNCEMENT_COLUMNS = [
  'id', 'project_id', 'title', 'body', 'category', 'is_pinned',
  'publish_from', 'publish_to', 'created_at', 'updated_at',
].join(', ')

/**
 * SELECT 전용 공지 어댑터. 읽음 워터마크(announcement_seen)는 이 어댑터에서 절대 접근하지
 * 않는다 — 챗봇 조회가 사용자의 읽음 상태를 갱신하면 안 된다.
 */
export function createSupabaseAnnouncementRepository(client: SupabaseServerClient): AnnouncementRepository {
  return {
    async listAnnouncements(projectId, limit) {
      const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 50))
      const result = await client
        .from('announcements')
        .select(ANNOUNCEMENT_COLUMNS)
        .eq('project_id', projectId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(safeLimit + 1)
      if (result.error) {
        return repositoryError('ANNOUNCEMENTS_READ_FAILED', isRetryableReadError(result.error))
      }

      const rows = (result.data ?? []) as unknown as Row[]
      // 요청 프로젝트 밖 행이 섞이면 부분 신뢰하지 않고 내용 노출 전에 실패로 끊는다.
      if (rows.some(row => row.project_id !== projectId || typeof row.id !== 'string')) {
        return repositoryError('ANNOUNCEMENTS_READ_FAILED', false)
      }

      const records: AnnouncementRepositoryRecord[] = rows.slice(0, safeLimit).map(row => ({
        id: row.id as string,
        projectId: row.project_id as string,
        title: (row.title as string) ?? '',
        body: (row.body as string) ?? '',
        category: (row.category as AnnouncementCategory) ?? 'general',
        isPinned: row.is_pinned === true,
        publishFrom: (row.publish_from as string | null) ?? null,
        publishTo: (row.publish_to as string | null) ?? null,
        createdAt: row.created_at as string,
        updatedAt: (row.updated_at as string | null) ?? null,
      }))
      const snapshot: AnnouncementListSnapshot = {
        records,
        truncated: rows.length > safeLimit,
      }
      return repositoryOk(snapshot)
    },
  }
}
