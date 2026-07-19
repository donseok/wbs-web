import type { ProjectMemberRole, TeamCode } from '@/lib/domain/types'
import {
  repositoryError,
  repositoryOk,
  type MemberRepository,
  type MemberRepositoryRecord,
} from '@/lib/repositories/types'
import { isRetryableReadError, nestedOne, type SupabaseServerClient } from './common'

type Row = Record<string, unknown>

// email은 select 절 자체에서 제외한다 — 챗봇 계약(MemberRepositoryRecord)에 이메일이 존재하지 않는다.
// user_id는 hasAccount 판정에만 쓰고 원시값을 반환 계약 밖으로 내보내지 않는다.
const MEMBER_COLUMNS = [
  'id', 'project_id', 'name', 'role', 'title', 'user_id', 'created_at', 'teams(code)',
].join(', ')

export function createSupabaseMemberRepository(client: SupabaseServerClient): MemberRepository {
  return {
    async listMembers(projectId) {
      const result = await client
        .from('project_members')
        .select(MEMBER_COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

      if (result.error) {
        return repositoryError('MEMBERS_READ_FAILED', isRetryableReadError(result.error))
      }

      const records: MemberRepositoryRecord[] = ((result.data ?? []) as unknown as Row[]).map(row => {
        const team = nestedOne(row.teams as { code?: unknown } | { code?: unknown }[] | null)
        return {
          id: row.id as string,
          projectId: row.project_id as string,
          name: row.name as string,
          teamCode: (team?.code as TeamCode | null) ?? null,
          role: (row.role as ProjectMemberRole) ?? 'contributor',
          title: (row.title as string | null) ?? null,
          hasAccount: row.user_id != null,
          createdAt: row.created_at as string,
        }
      })
      return repositoryOk(records)
    },
  }
}
