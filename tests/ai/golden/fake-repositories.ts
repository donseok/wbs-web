// fixtures 기반 in-memory CoreBotRepositories 구현. 실제 DB·네트워크 접근 없음.
// createFakeRepositories({ fail })로 특정 RepositoryErrorCode 를 강제 반환해 조회 실패를 주입한다.
// 읽기 전용 계약 그대로 — 쓰기 메서드는 없다. 반환 데이터는 structuredClone 으로 픽스처와 격리한다.
import {
  repositoryError,
  repositoryOk,
  type AttendanceRepositoryRecord,
  type CoreBotRepositories,
  type MinuteRepositoryRecord,
  type RepositoryErrorCode,
  type RepositoryResult,
} from '@/lib/repositories/types'
import type { TeamCode } from '@/lib/domain/types'
import {
  ANNOUNCEMENTS,
  ATTENDANCE,
  MEETING_DETAILS,
  MEMBERS,
  MINUTES_ARCHIVE,
  MINUTE_DETAILS,
  MY_MEETINGS,
  PROJECT_MEETINGS,
  SETTINGS,
  WBS_ATTACHMENTS,
  WBS_CHANGE_LOGS,
  WBS_SNAPSHOTS,
  WEEKLY_SNAPSHOTS,
} from './fixtures'

export interface FakeRepositoryOptions {
  /** 지정한 에러 코드를 관련 메서드가 강제 반환한다(조회 실패 주입). */
  fail?: readonly RepositoryErrorCode[]
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function createFakeRepositories(options: FakeRepositoryOptions = {}): CoreBotRepositories {
  const failing = new Set<RepositoryErrorCode>(options.fail ?? [])
  const guard = <T>(code: RepositoryErrorCode, retryable: boolean, produce: () => RepositoryResult<T>): RepositoryResult<T> =>
    failing.has(code) ? repositoryError<T>(code, retryable) : produce()

  return {
    wbs: {
      async getProjectSnapshot(projectId) {
        return guard('WBS_PROJECT_READ_FAILED', true, () => {
          const snapshot = WBS_SNAPSHOTS[projectId]
          return repositoryOk(snapshot ? clone(snapshot) : null)
        })
      },
      async getChangeLog(_projectId, itemId, limit) {
        return guard('WBS_CHANGE_LOG_READ_FAILED', true, () => {
          const snapshot = WBS_CHANGE_LOGS[itemId]
          if (!snapshot) return repositoryOk(null)
          const entries = snapshot.entries.slice(0, limit)
          return repositoryOk(clone({
            ...snapshot,
            entries,
            truncated: snapshot.truncated || snapshot.entries.length > limit,
          }))
        })
      },
      async listAttachmentMetadata(_projectId, itemId, limit) {
        return guard('WBS_ATTACHMENTS_READ_FAILED', true, () => {
          const snapshot = WBS_ATTACHMENTS[itemId]
          if (!snapshot) return repositoryOk(null)
          const attachments = snapshot.attachments.slice(0, limit)
          return repositoryOk(clone({
            ...snapshot,
            attachments,
            truncated: snapshot.truncated || snapshot.attachments.length > limit,
          }))
        })
      },
    },
    weekly: {
      async getSheet(projectId, weekStart) {
        return guard('WEEKLY_REPORT_READ_FAILED', true, () => {
          const snapshot = WEEKLY_SNAPSHOTS[`${projectId}:${weekStart}`]
          return repositoryOk(snapshot ? clone(snapshot) : null)
        })
      },
    },
    meetings: {
      async listProjectMeetings(projectId) {
        // 범위 필터는 도구 계층의 expandMeetings 가 담당한다 — 픽스처는 시리즈 전체를 반환한다.
        return guard('MEETINGS_READ_FAILED', true, () => {
          const snapshot = PROJECT_MEETINGS[projectId] ?? { meetings: [], exceptions: [] }
          return repositoryOk(clone(snapshot))
        })
      },
      async getMeetingDetail(projectId, meetingId) {
        return guard('MEETING_DETAIL_READ_FAILED', true, () => {
          const detail = MEETING_DETAILS[`${projectId}:${meetingId}`]
          return repositoryOk(detail ? clone(detail) : null)
        })
      },
      async listMyMeetings(userId, allowedProjectIds) {
        // userId 는 인터페이스 시그니처 유지를 위해 받되, 픽스처는 이미 '내 회의'로 표식된 데이터만 담는다.
        return guard('MY_MEETINGS_READ_FAILED', true, () => {
          const allowed = new Set(allowedProjectIds)
          const meetings = MY_MEETINGS.meetings.filter(meeting => allowed.has(meeting.projectId))
          const meetingIds = new Set(meetings.map(meeting => meeting.id))
          return repositoryOk(clone({
            meetings,
            exceptions: MY_MEETINGS.exceptions.filter(exception => meetingIds.has(exception.meetingId)),
          }))
        })
      },
    },
    attendance: {
      async listRecords(projectId, from, to) {
        return guard('ATTENDANCE_READ_FAILED', true, () => {
          const records: AttendanceRepositoryRecord[] = (ATTENDANCE[projectId] ?? [])
            .filter(record => record.date >= from && record.date <= to)
          return repositoryOk(clone(records))
        })
      },
    },
    announcements: {
      async listAnnouncements(projectId, limit) {
        return guard('ANNOUNCEMENTS_READ_FAILED', true, () => {
          const ordered = [...(ANNOUNCEMENTS[projectId] ?? [])].sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
            return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
          })
          return repositoryOk(clone({
            records: ordered.slice(0, limit),
            truncated: ordered.length > limit,
          }))
        })
      },
    },
    minutes: {
      async searchMinutes(input) {
        return guard('MINUTES_READ_FAILED', true, () => {
          const needle = input.query?.toLowerCase() ?? null
          const matched: MinuteRepositoryRecord[] = MINUTES_ARCHIVE.filter(record => {
            if (input.projectId && record.meetingProjectId !== input.projectId) return false
            if (input.team && record.teamCode !== (input.team as TeamCode)) return false
            if (input.from && record.minuteDate < input.from) return false
            if (input.to && record.minuteDate > input.to) return false
            if (needle && !record.title.toLowerCase().includes(needle)) return false
            return true
          }).sort((a, b) => (a.minuteDate < b.minuteDate ? 1 : a.minuteDate > b.minuteDate ? -1 : 0))
          return repositoryOk(clone({
            records: matched.slice(0, input.limit),
            truncated: matched.length > input.limit,
          }))
        })
      },
      async getMinuteDetail(minuteId) {
        return guard('MINUTE_DETAIL_READ_FAILED', true, () => {
          const detail = MINUTE_DETAILS[minuteId]
          return repositoryOk(detail ? clone(detail) : null)
        })
      },
    },
    members: {
      async listMembers(projectId) {
        return guard('MEMBERS_READ_FAILED', true, () =>
          repositoryOk(clone(MEMBERS[projectId] ?? [])),
        )
      },
    },
    settings: {
      async getSafeSettings(projectId) {
        return guard('PROJECT_SETTINGS_READ_FAILED', true, () => {
          const snapshot = SETTINGS[projectId]
          return repositoryOk(snapshot ? clone(snapshot) : null)
        })
      },
    },
  }
}
