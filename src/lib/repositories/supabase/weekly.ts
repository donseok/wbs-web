import {
  repositoryError,
  repositoryOk,
  type WeeklyRepository,
  type WeeklyRepositoryRow,
  type WeeklySheetSnapshot,
} from '@/lib/repositories/types'
import { isRetryableReadError, type SupabaseServerClient } from './common'

type Row = Record<string, unknown>

const REPORT_COLUMNS = 'id, project_id, week_start, title, updated_at'
const ROW_COLUMNS = [
  'id', 'report_id', 'section', 'module', 'sort_order', 'this_content', 'this_issue',
  'next_content', 'next_issue', 'updated_at',
].join(', ')

function mapRow(row: Row): WeeklyRepositoryRow {
  return {
    id: row.id as string,
    reportId: row.report_id as string,
    section: (row.section as string) ?? '',
    module: (row.module as string) ?? '',
    sortOrder: Number(row.sort_order) || 0,
    thisContent: (row.this_content as string) ?? '',
    thisIssue: (row.this_issue as string) ?? '',
    nextContent: (row.next_content as string) ?? '',
    nextIssue: (row.next_issue as string) ?? '',
    updatedAt: (row.updated_at as string | null) ?? null,
  }
}

/**
 * Unlike the UI loader, this adapter never calls ensureStandardRows and never
 * inserts missing rows. A chatbot read must have zero business-data writes.
 */
export function createSupabaseWeeklyRepository(client: SupabaseServerClient): WeeklyRepository {
  return {
    async getSheet(projectId, weekStart) {
      const reportResult = await client
        .from('weekly_reports')
        .select(REPORT_COLUMNS)
        .eq('project_id', projectId)
        .eq('week_start', weekStart)
        .maybeSingle()

      if (reportResult.error) {
        return repositoryError('WEEKLY_REPORT_READ_FAILED', isRetryableReadError(reportResult.error))
      }
      if (!reportResult.data) return repositoryOk(null)

      const reportRow = reportResult.data as Row
      const rowsResult = await client
        .from('weekly_report_rows')
        .select(ROW_COLUMNS)
        .eq('report_id', reportRow.id as string)
        .order('sort_order')

      if (rowsResult.error) {
        return repositoryError('WEEKLY_ROWS_READ_FAILED', isRetryableReadError(rowsResult.error))
      }

      const snapshot: WeeklySheetSnapshot = {
        report: {
          id: reportRow.id as string,
          projectId: reportRow.project_id as string,
          weekStart: reportRow.week_start as string,
          title: (reportRow.title as string | null) ?? '',
          updatedAt: (reportRow.updated_at as string | null) ?? null,
        },
        rows: ((rowsResult.data ?? []) as unknown as Row[]).map(mapRow),
      }
      return repositoryOk(snapshot)
    },
  }
}
