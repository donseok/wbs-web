import { meetingHref, myMeetingHref } from '@/lib/ai/chat/deep-links'
import { expandMeetings, sortOccurrences, summarizeMeetings } from '@/lib/domain/meetings'
import type { MeetingCategory, MeetingRecurrence, TeamCode } from '@/lib/domain/types'
import type {
  MeetingRepository,
  MyMeetingRelation,
  MyMeetingRepository,
} from '@/lib/repositories/types'
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
  shortExcerpt,
  todayInSeoul,
  validDateRange,
} from './common'
import type { BotSource, ReadOnlyBotTool, ToolExecutionContext, ToolExecutionResult } from './types'

const MEETINGS_CAPABILITY = 'meetings:read' as const
const MAX_MEETING_BODY = 12_000

export interface MeetingOccurrenceToolRecord {
  occurrenceId: string
  seriesId: string
  projectId: string
  occurrenceDate: string
  title: string
  startTime: string | null
  endTime: string | null
  location: string | null
  category: MeetingCategory
  isRecurring: boolean
  attendeeCount: number
}

export interface MeetingDetailToolRecord {
  id: string
  projectId: string
  title: string
  meetingDate: string
  occurrenceDate: string | null
  startTime: string | null
  endTime: string | null
  location: string | null
  category: MeetingCategory
  recurrence: MeetingRecurrence
  recurrenceUntil: string | null
  body: string
  createdByName: string | null
  updatedAt: string
  attendees: Array<{ id: string; name: string; teamCode: TeamCode | null }>
}

export interface MyMeetingOccurrenceToolRecord extends MeetingOccurrenceToolRecord {
  projectName: string | null
  mineBy: MyMeetingRelation
}

function meetingRowsStayInScope(
  projectIds: ReadonlySet<string>,
  meetings: ReadonlyArray<{ id: string; projectId: string }>,
  exceptions: ReadonlyArray<{ meetingId: string }>,
): boolean {
  const meetingIds = new Set(meetings.map(meeting => meeting.id))
  return meetings.every(meeting => projectIds.has(meeting.projectId))
    && exceptions.every(exception => meetingIds.has(exception.meetingId))
}

function meetingSource(
  projectId: string,
  entityId: string,
  title: string,
  updatedAt: string | null,
  occurrenceDate?: string,
  excerpt?: string,
): BotSource {
  return {
    id: occurrenceDate ? `meeting:${entityId}:${occurrenceDate}` : `meeting:${entityId}`,
    domain: 'meetings',
    entityType: occurrenceDate ? 'meeting_occurrence' : 'meeting',
    entityId,
    projectId,
    title,
    href: meetingHref(projectId, entityId, occurrenceDate),
    updatedAt,
    ...(occurrenceDate ? { qualifier: { occurrenceDate } } : {}),
    ...(excerpt ? { excerpt } : {}),
  }
}

export function createListMeetingsTool(
  repository: MeetingRepository,
): ReadOnlyBotTool<MeetingOccurrenceToolRecord> {
  return {
    name: 'list_meetings',
    requiredCapability: MEETINGS_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const from = isIsoDate(args.from) ? args.from : null
      const to = isIsoDate(args.to) ? args.to : null
      const query = readOptionalString(args.query)
      const category = readOptionalString(args.category, 30)
      const limit = readLimit(args.limit)
      if (!projectId || !from || !to || query === null || category === null || limit === null) {
        return invalidArgument()
      }
      if (!validDateRange(from, to)) return invalidArgument('회의 조회 기간이 올바르지 않습니다.')
      if (category && !(['general', 'routine', 'kickoff', 'review', 'report', 'external'] as string[]).includes(category)) {
        return invalidArgument('알 수 없는 회의 분류입니다.')
      }
      const denied = checkProjectAccess(context, projectId, MEETINGS_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.listProjectMeetings(projectId, from, to)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!meetingRowsStayInScope(
        new Set([projectId]), repoResult.data.meetings, repoResult.data.exceptions,
      )) return repositoryScopeViolation()
      const updatedAtById = new Map(repoResult.data.meetings.map(meeting => [meeting.id, meeting.updatedAt]))
      const needle = query?.toLocaleLowerCase('ko-KR')
      const all = sortOccurrences(expandMeetings(repoResult.data.meetings, repoResult.data.exceptions, from, to))
        .filter(occurrence => {
          if (category && occurrence.category !== category) return false
          if (!needle) return true
          return [occurrence.title, occurrence.location]
            .filter(Boolean)
            .some(value => String(value).toLocaleLowerCase('ko-KR').includes(needle))
        })
      const records: MeetingOccurrenceToolRecord[] = all.slice(0, limit)
      const truncated = all.length > records.length
      const summary = summarizeMeetings(all, todayInSeoul(context.now))
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            totalMatched: all.length,
            returned: records.length,
            today: summary.today,
            upcoming7d: summary.upcoming7d,
            rangeFrom: from,
            rangeTo: to,
          },
          records,
          sources: records.map(record => meetingSource(
            projectId,
            record.seriesId,
            record.title,
            updatedAtById.get(record.seriesId) ?? null,
            record.occurrenceDate,
            shortExcerpt(record.location),
          )),
          asOf: context.now,
          truncated,
          warnings: truncated ? [`회의 ${all.length}건 중 ${records.length}건만 반환했습니다.`] : [],
        },
      }
    },
  }
}

export function createGetMeetingDetailTool(
  repository: MeetingRepository,
): ReadOnlyBotTool<MeetingDetailToolRecord> {
  return {
    name: 'get_meeting_detail',
    requiredCapability: MEETINGS_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const meetingId = readRequiredString(args.meetingId)
      const occurrenceDate = args.occurrenceDate === undefined
        ? undefined
        : isIsoDate(args.occurrenceDate) ? args.occurrenceDate : null
      if (!projectId || !meetingId || occurrenceDate === null) return invalidArgument()
      const denied = checkProjectAccess(context, projectId, MEETINGS_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.getMeetingDetail(projectId, meetingId)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!repoResult.data) return emptyMeetingDetail(context)
      const meeting = repoResult.data.meeting
      if (
        meeting.id !== meetingId
        || !meetingRowsStayInScope(
          new Set([projectId]), [meeting], repoResult.data.exceptions,
        )
        || repoResult.data.attendees.some(attendee =>
          !meeting.attendeeIds.includes(attendee.id)
        )
      ) return repositoryScopeViolation()
      if (occurrenceDate) {
        const occurrence = expandMeetings(
          [repoResult.data.meeting], repoResult.data.exceptions, occurrenceDate, occurrenceDate,
        )
        if (!occurrence.length) return emptyMeetingDetail(context)
      }

      const bodyTruncated = meeting.body.length > MAX_MEETING_BODY
      const body = bodyTruncated ? meeting.body.slice(0, MAX_MEETING_BODY) : meeting.body
      const record: MeetingDetailToolRecord = {
        id: meeting.id,
        projectId,
        title: meeting.title,
        meetingDate: meeting.meetingDate,
        occurrenceDate: occurrenceDate ?? null,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        location: meeting.location,
        category: meeting.category,
        recurrence: meeting.recurrence,
        recurrenceUntil: meeting.recurrenceUntil,
        body,
        createdByName: meeting.createdByName,
        updatedAt: meeting.updatedAt,
        attendees: repoResult.data.attendees,
      }
      return {
        ok: true,
        result: {
          status: bodyTruncated ? 'partial' : 'ok',
          facts: {
            meetingFound: true,
            attendeeCount: record.attendees.length,
            bodyTruncated,
          },
          records: [record],
          sources: [meetingSource(
            projectId, meeting.id, meeting.title, meeting.updatedAt, occurrenceDate,
            shortExcerpt(body),
          )],
          asOf: context.now,
          truncated: bodyTruncated,
          warnings: bodyTruncated ? ['회의 본문이 길어 앞부분만 반환했습니다.'] : [],
        },
      }
    },
  }
}

function emptyMeetingDetail(
  context: ToolExecutionContext,
): ToolExecutionResult<MeetingDetailToolRecord> {
  return {
    ok: true,
    result: {
      status: 'ok', facts: { meetingFound: false }, records: [], sources: [],
      asOf: context.now, truncated: false, warnings: [],
    },
  }
}

export function createListMyMeetingsTool(
  repository: MyMeetingRepository,
): ReadOnlyBotTool<MyMeetingOccurrenceToolRecord> {
  return {
    name: 'list_my_meetings',
    requiredCapability: MEETINGS_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readOptionalString(args.projectId)
      const from = isIsoDate(args.from) ? args.from : null
      const to = isIsoDate(args.to) ? args.to : null
      const query = readOptionalString(args.query)
      const category = readOptionalString(args.category, 30)
      const limit = readLimit(args.limit)
      if (
        projectId === null || !from || !to || query === null
        || category === null || limit === null
      ) return invalidArgument()
      if (!validDateRange(from, to)) return invalidArgument('회의 조회 기간이 올바르지 않습니다.')
      if (
        category
        && !(['general', 'routine', 'kickoff', 'review', 'report', 'external'] as string[]).includes(category)
      ) return invalidArgument('알 수 없는 회의 분류입니다.')

      if (projectId) {
        const denied = checkProjectAccess(context, projectId, MEETINGS_CAPABILITY)
        if (denied) return denied
      } else if (
        !context.userId
        || !context.capabilities.includes(MEETINGS_CAPABILITY)
        || !context.allowedProjectIds.length
      ) {
        return {
          ok: false,
          error: {
            code: 'ACCESS_DENIED',
            message: '내 회의를 조회할 프로젝트 범위가 없습니다.',
            retryable: false,
          },
        }
      }

      const projectIds = projectId ? [projectId] : [...new Set(context.allowedProjectIds)]
      const repoResult = await repository.listMyMeetings(context.userId, projectIds, from, to)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      const allowed = new Set(projectIds)
      // Treat a violated repository contract as a data-source failure rather
      // than returning even one cross-project or non-personal meeting.
      if (repoResult.data.meetings.some(meeting =>
        !allowed.has(meeting.projectId)
        || meeting.isMine !== true
        || !(['creator', 'attendee', 'creator_and_attendee'] as string[]).includes(meeting.mineBy)
      )) {
        return {
          ok: false,
          error: {
            code: 'DATA_SOURCE_ERROR',
            message: '내 회의 범위를 안전하게 검증하지 못했습니다.',
            retryable: false,
          },
        }
      }
      if (!meetingRowsStayInScope(
        allowed, repoResult.data.meetings, repoResult.data.exceptions,
      )) return repositoryScopeViolation()

      const byId = new Map(repoResult.data.meetings.map(meeting => [meeting.id, meeting]))
      const needle = query?.toLocaleLowerCase('ko-KR')
      const all = sortOccurrences(expandMeetings(
        repoResult.data.meetings,
        repoResult.data.exceptions,
        from,
        to,
      )).filter(occurrence => {
        if (category && occurrence.category !== category) return false
        if (!needle) return true
        const meeting = byId.get(occurrence.seriesId)
        return [occurrence.title, occurrence.location, meeting?.projectName]
          .filter((value): value is string => typeof value === 'string')
          .some(value => value.toLocaleLowerCase('ko-KR').includes(needle))
      })
      const records: MyMeetingOccurrenceToolRecord[] = all.slice(0, limit).flatMap(occurrence => {
        const meeting = byId.get(occurrence.seriesId)
        if (!meeting) return []
        return [{
          occurrenceId: occurrence.occurrenceId,
          seriesId: occurrence.seriesId,
          projectId: occurrence.projectId,
          occurrenceDate: occurrence.occurrenceDate,
          title: occurrence.title,
          startTime: occurrence.startTime,
          endTime: occurrence.endTime,
          location: occurrence.location,
          category: occurrence.category,
          isRecurring: occurrence.isRecurring,
          attendeeCount: occurrence.attendeeCount,
          projectName: meeting.projectName ?? null,
          mineBy: meeting.mineBy,
        }]
      })
      const truncated = all.length > records.length
      const summary = summarizeMeetings(all, todayInSeoul(context.now))
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            totalMatched: all.length,
            returned: records.length,
            today: summary.today,
            upcoming7d: summary.upcoming7d,
            projectCount: new Set(all.map(occurrence => occurrence.projectId)).size,
            rangeFrom: from,
            rangeTo: to,
          },
          records,
          sources: records.map(record => {
            const meeting = byId.get(record.seriesId)!
            return {
              id: `my-meeting:${record.seriesId}:${record.occurrenceDate}`,
              domain: 'meetings',
              entityType: 'meeting_occurrence',
              entityId: record.seriesId,
              projectId: record.projectId,
              title: record.projectName
                ? `${record.projectName} · ${record.title}`
                : record.title,
              href: myMeetingHref(record.seriesId, record.occurrenceDate),
              updatedAt: meeting.updatedAt,
              qualifier: { occurrenceDate: record.occurrenceDate },
              excerpt: shortExcerpt(record.location, record.mineBy),
            }
          }),
          asOf: context.now,
          truncated,
          warnings: truncated ? [`내 회의 ${all.length}건 중 ${records.length}건만 반환했습니다.`] : [],
        },
      }
    },
  }
}
