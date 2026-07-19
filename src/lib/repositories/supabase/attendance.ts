import type { AttendanceType, TeamCode } from '@/lib/domain/types'
import {
  repositoryError,
  repositoryOk,
  type AttendanceRepository,
  type AttendanceRepositoryRecord,
} from '@/lib/repositories/types'
import { isRetryableReadError, nestedOne, type SupabaseServerClient } from './common'

type Row = Record<string, unknown>

const ATTENDANCE_COLUMNS = ['id', 'project_id', 'member_id', 'date', 'type'].join(', ')
const MEMBER_COLUMNS = ['id', 'project_id', 'name', 'teams(code)'].join(', ')

/** note is intentionally not selected: Phase 1 exposes attendance facts, not sensitive notes. */
export function createSupabaseAttendanceRepository(client: SupabaseServerClient): AttendanceRepository {
  return {
    async listRecords(projectId, from, to) {
      const result = await client
        .from('attendance_records')
        .select(ATTENDANCE_COLUMNS)
        .eq('project_id', projectId)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })

      if (result.error) {
        return repositoryError('ATTENDANCE_READ_FAILED', isRetryableReadError(result.error))
      }

      const rows = (result.data ?? []) as unknown as Row[]
      if (rows.some(row => row.project_id !== projectId || typeof row.member_id !== 'string')) {
        return repositoryError('ATTENDANCE_MEMBER_SCOPE_INVALID', false)
      }

      const memberIds = [...new Set(rows.map(row => row.member_id as string))]
      if (memberIds.length === 0) return repositoryOk([])

      // Do not rely on PostgREST's implicit relationship selection here. Migration 0032 adds a
      // composite attendance→member FK alongside the legacy member_id FK, which makes an
      // unqualified embedded relationship ambiguous. The explicit project predicate also keeps
      // a corrupt cross-project member reference fail-closed before its name crosses this boundary.
      const memberResult = await client
        .from('project_members')
        .select(MEMBER_COLUMNS)
        .eq('project_id', projectId)
        .in('id', memberIds)
      if (memberResult.error) {
        return repositoryError('ATTENDANCE_READ_FAILED', isRetryableReadError(memberResult.error))
      }

      const memberRows = (memberResult.data ?? []) as unknown as Row[]
      const members = new Map(memberRows.flatMap(member =>
        typeof member.id === 'string' && member.project_id === projectId
          ? [[member.id, member] as const]
          : [],
      ))
      if (memberRows.length !== members.size || memberIds.some(id => !members.has(id))) {
        return repositoryError('ATTENDANCE_MEMBER_SCOPE_INVALID', false)
      }

      const records: AttendanceRepositoryRecord[] = rows.map(row => {
        const member = members.get(row.member_id as string)
        const team = nestedOne(member?.teams as { code?: unknown } | { code?: unknown }[] | null)
        return {
          id: row.id as string,
          projectId: row.project_id as string,
          memberId: row.member_id as string,
          memberName: (member?.name as string) ?? '',
          teamCode: (team?.code as TeamCode | null) ?? null,
          date: row.date as string,
          type: row.type as AttendanceType,
        }
      })
      return repositoryOk(records)
    },
  }
}
