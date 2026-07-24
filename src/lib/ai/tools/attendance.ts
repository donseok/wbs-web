import { attendanceHref } from '@/lib/ai/chat/deep-links'
import { summarize } from '@/lib/domain/attendance'
import { compareKoreanName } from '@/lib/domain/nameSort'
import type { AttendanceRecord, AttendanceType, TeamCode } from '@/lib/domain/types'
import type { AttendanceRepository } from '@/lib/repositories/types'
import {
  checkProjectAccess,
  invalidArgument,
  isIsoDate,
  isRecord,
  readLimit,
  readOptionalString,
  readRequiredString,
  repositoryFailure,
  repositoryScopeViolation,
  validDateRange,
} from './common'
import type { BotSource, ReadOnlyBotTool } from './types'
import { activeTeamCodesSync, isRegisteredTeamCode } from '@/lib/teams/master'

const ATTENDANCE_CAPABILITY = 'attendance:read' as const
const ATTENDANCE_TYPES = new Set<AttendanceType>([
  'work', 'remote', 'annual', 'half', 'quarter', 'sick', 'trip', 'official', 'absent',
])

export interface AttendanceToolRecord {
  id: string
  projectId: string
  memberId: string
  memberName: string
  teamCode: TeamCode | null
  date: string
  type: AttendanceType
}

function parseTypes(value: unknown): AttendanceType[] | null | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length > ATTENDANCE_TYPES.size) return null
  const types = value.filter((item): item is AttendanceType =>
    typeof item === 'string' && ATTENDANCE_TYPES.has(item as AttendanceType),
  )
  return types.length === value.length ? [...new Set(types)] : null
}

export function createGetAttendanceTool(
  repository: AttendanceRepository,
): ReadOnlyBotTool<AttendanceToolRecord> {
  return {
    name: 'get_attendance',
    requiredCapability: ATTENDANCE_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const from = isIsoDate(args.from) ? args.from : null
      const to = isIsoDate(args.to) ? args.to : null
      const team = readOptionalString(args.team, 30)
      const memberId = readOptionalString(args.memberId)
      const types = parseTypes(args.types)
      const limit = readLimit(args.limit)
      if (!projectId || !from || !to || team === null || memberId === null || types === null || limit === null) {
        return invalidArgument()
      }
      if (!validDateRange(from, to)) return invalidArgument('근태 조회 기간이 올바르지 않습니다.')
      if (team && !activeTeamCodesSync().includes(team)) {
        return invalidArgument('알 수 없는 담당팀입니다.')
      }
      const denied = checkProjectAccess(context, projectId, ATTENDANCE_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.listRecords(projectId, from, to)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (repoResult.data.some(record => record.projectId !== projectId)) {
        return repositoryScopeViolation()
      }
      const matched = repoResult.data.filter(record => {
        if (team && record.teamCode !== team) return false
        if (memberId && record.memberId !== memberId) return false
        if (types && !types.includes(record.type)) return false
        return true
      })
      // 리포지토리는 날짜순만 보장한다 — 같은 날짜 안의 이름 순서는 미정.
      // limit 로 자르기 전에 이름 가나다순으로 고정해야 '앞쪽 N건'이 매번 같은 답이 된다.
      const ordered = [...matched].sort((a, b) =>
        a.date.localeCompare(b.date) || compareKoreanName(a.memberName, b.memberName))
      const records: AttendanceToolRecord[] = ordered.slice(0, limit)
      const summaryInput: AttendanceRecord[] = matched.map(record => ({
        id: record.id,
        projectId: record.projectId,
        memberId: record.memberId,
        date: record.date,
        type: record.type,
        note: null,
      }))
      const counts = summarize(summaryInput)
      // 출처는 조회 조건을 그대로 복원한다. 복수 type 조회는 화면 필터로 재현할 수 없어 생략.
      const href = attendanceHref(projectId, {
        from,
        to,
        team: team || undefined,
        type: types && types.length === 1 ? types[0] : undefined,
      })
      const sources: BotSource[] = records.map(record => ({
        id: `attendance:${record.id}`,
        domain: 'attendance',
        entityType: 'attendance_record',
        entityId: record.id,
        projectId,
        title: `${record.date} ${record.memberName} · ${record.type}`,
        href,
        updatedAt: null,
      }))
      const truncated = matched.length > records.length
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            totalMatched: matched.length,
            returned: records.length,
            memberCount: new Set(matched.map(record => record.memberId)).size,
            leave: counts.leave,
            trip: counts.trip,
            remote: counts.remote,
            rangeFrom: from,
            rangeTo: to,
          },
          records,
          sources,
          asOf: context.now,
          truncated,
          warnings: truncated ? [`근태 기록 ${matched.length}건 중 ${records.length}건만 반환했습니다.`] : [],
        },
      }
    },
  }
}
