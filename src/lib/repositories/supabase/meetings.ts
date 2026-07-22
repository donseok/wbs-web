import { compareKoreanName } from '@/lib/domain/nameSort'
import type {
  Meeting,
  MeetingCategory,
  MeetingException,
  MeetingRecurrence,
  TeamCode,
} from '@/lib/domain/types'
import {
  repositoryError,
  repositoryOk,
  type MeetingBotRepository,
  type MeetingDetailSnapshot,
  type MyMeetingRepositoryRecord,
  type MyMeetingSnapshot,
  type ProjectMeetingSnapshot,
  type SafeMeetingAttendee,
} from '@/lib/repositories/types'
import { isRetryableReadError, nestedOne, type SupabaseServerClient } from './common'

type Row = Record<string, unknown>

const LIST_COLUMNS = [
  'id', 'project_id', 'title', 'meeting_date', 'start_time', 'end_time', 'location', 'category',
  'recurrence', 'recurrence_until', 'created_by', 'created_by_name', 'created_at', 'updated_at',
  'meeting_attendees(member_id)',
].join(', ')
const DETAIL_COLUMNS = `${LIST_COLUMNS}, body`
const MY_LIST_COLUMNS = `${LIST_COLUMNS}, projects(name)`

function attendeeIdsFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const id = (value as Row).member_id
    return typeof id === 'string' ? [id] : []
  })
}

function mapMeeting(row: Row, includeBody: boolean): Meeting {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    title: row.title as string,
    meetingDate: row.meeting_date as string,
    startTime: (row.start_time as string | null) ?? null,
    endTime: (row.end_time as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    category: row.category as MeetingCategory,
    body: includeBody ? (row.body as string) ?? '' : '',
    recurrence: row.recurrence as MeetingRecurrence,
    recurrenceUntil: (row.recurrence_until as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdByName: (row.created_by_name as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    attendeeIds: attendeeIdsFrom(row.meeting_attendees),
  }
}

function mapExceptions(rows: Row[]): MeetingException[] {
  return rows.map(row => ({
    meetingId: row.meeting_id as string,
    occurrenceDate: row.occurrence_date as string,
    kind: 'cancelled',
  }))
}

export function createSupabaseMeetingRepository(client: SupabaseServerClient): MeetingBotRepository {
  return {
    async listProjectMeetings(projectId, from, to) {
      const range =
        `and(recurrence.eq.none,meeting_date.gte.${from},meeting_date.lte.${to}),` +
        `and(recurrence.neq.none,meeting_date.lte.${to},or(recurrence_until.is.null,recurrence_until.gte.${from}))`
      const meetingsResult = await client
        .from('meetings')
        .select(LIST_COLUMNS)
        .eq('project_id', projectId)
        .or(range)
        .order('meeting_date', { ascending: true })

      if (meetingsResult.error) {
        return repositoryError('MEETINGS_READ_FAILED', isRetryableReadError(meetingsResult.error))
      }
      const meetings = ((meetingsResult.data ?? []) as unknown as Row[]).map(row => mapMeeting(row, false))
      if (!meetings.length) return repositoryOk({ meetings: [], exceptions: [] })

      const exceptionsResult = await client
        .from('meeting_exceptions')
        .select('meeting_id, occurrence_date, kind')
        .in('meeting_id', meetings.map(meeting => meeting.id))

      if (exceptionsResult.error) {
        return repositoryError(
          'MEETING_EXCEPTIONS_READ_FAILED',
          isRetryableReadError(exceptionsResult.error),
        )
      }
      const snapshot: ProjectMeetingSnapshot = {
        meetings,
        exceptions: mapExceptions((exceptionsResult.data ?? []) as Row[]),
      }
      return repositoryOk(snapshot)
    },

    async getMeetingDetail(projectId, meetingId) {
      const meetingResult = await client
        .from('meetings')
        .select(DETAIL_COLUMNS)
        .eq('project_id', projectId)
        .eq('id', meetingId)
        .maybeSingle()

      if (meetingResult.error) {
        return repositoryError('MEETING_DETAIL_READ_FAILED', isRetryableReadError(meetingResult.error))
      }
      if (!meetingResult.data) return repositoryOk(null)

      const meeting = mapMeeting(meetingResult.data as unknown as Row, true)
      const [attendeesResult, exceptionsResult] = await Promise.all([
        meeting.attendeeIds.length
          ? client
              .from('project_members')
              .select('id, name, teams(code)')
              .eq('project_id', projectId)
              .in('id', meeting.attendeeIds)
          : Promise.resolve({ data: [] as Row[], error: null }),
        client
          .from('meeting_exceptions')
          .select('meeting_id, occurrence_date, kind')
          .eq('meeting_id', meetingId),
      ])

      if (attendeesResult.error) {
        return repositoryError(
          'MEETING_ATTENDEES_READ_FAILED',
          isRetryableReadError(attendeesResult.error),
        )
      }
      if (exceptionsResult.error) {
        return repositoryError(
          'MEETING_EXCEPTIONS_READ_FAILED',
          isRetryableReadError(exceptionsResult.error),
        )
      }

      // `.in()` 은 순서 보장이 없다 — 챗봇이 읽어주는 참석자 명단도 화면과 같은 가나다순으로 고정한다.
      // id tiebreak — `.in()` 은 기준 순서가 없어 동명이인의 앞뒤가 요청마다 달라진다.
      const attendeeRows = [...((attendeesResult.data ?? []) as Row[])].sort((x, y) =>
        compareKoreanName(x.name as string, y.name as string)
        || (x.id as string).localeCompare(y.id as string),
      )
      const attendees: SafeMeetingAttendee[] = attendeeRows.map(row => {
        const team = nestedOne(row.teams as { code?: unknown } | { code?: unknown }[] | null)
        return {
          id: row.id as string,
          name: row.name as string,
          teamCode: (team?.code as TeamCode | null) ?? null,
        }
      })
      const snapshot: MeetingDetailSnapshot = {
        meeting,
        attendees,
        exceptions: mapExceptions((exceptionsResult.data ?? []) as Row[]),
      }
      return repositoryOk(snapshot)
    },

    async listMyMeetings(userId, allowedProjectIds, from, to) {
      const projectIds = [...new Set(allowedProjectIds.filter(Boolean))]
      if (!projectIds.length) return repositoryOk({ meetings: [], exceptions: [] })

      // user_id is the authoritative auth.users FK. Email is deliberately not
      // selected or used by the chatbot repository.
      const memberLinksResult = await client
        .from('project_members')
        .select('id, project_id')
        .eq('user_id', userId)
        .in('project_id', projectIds)
      if (memberLinksResult.error) {
        return repositoryError(
          'MY_MEETING_MEMBER_LINKS_READ_FAILED',
          isRetryableReadError(memberLinksResult.error),
        )
      }

      const memberProjectById = new Map<string, string>()
      for (const row of (memberLinksResult.data ?? []) as unknown as Row[]) {
        if (typeof row.id === 'string' && typeof row.project_id === 'string') {
          memberProjectById.set(row.id, row.project_id)
        }
      }

      const range =
        `and(recurrence.eq.none,meeting_date.gte.${from},meeting_date.lte.${to}),` +
        `and(recurrence.neq.none,meeting_date.lte.${to},or(recurrence_until.is.null,recurrence_until.gte.${from}))`
      const meetingsResult = await client
        .from('meetings')
        .select(MY_LIST_COLUMNS)
        .in('project_id', projectIds)
        .or(range)
        .order('meeting_date', { ascending: true })
      if (meetingsResult.error) {
        return repositoryError('MY_MEETINGS_READ_FAILED', isRetryableReadError(meetingsResult.error))
      }

      const allowedProjects = new Set(projectIds)
      const meetings: MyMeetingRepositoryRecord[] = []
      for (const row of (meetingsResult.data ?? []) as unknown as Row[]) {
        const meeting = mapMeeting(row, false)
        // Defence in depth: a repository response can never widen the caller's
        // project allowlist, even if a future query loses its .in() predicate.
        if (!allowedProjects.has(meeting.projectId)) continue
        const isCreator = meeting.createdBy === userId
        // meeting_attendees does not have a project_id column. Validate the
        // linked member belongs to the same project as the meeting before it
        // establishes the "mine" relationship.
        const isAttendee = meeting.attendeeIds.some(memberId =>
          memberProjectById.get(memberId) === meeting.projectId,
        )
        if (!isCreator && !isAttendee) continue
        const project = nestedOne(row.projects as { name?: unknown } | { name?: unknown }[] | null)
        meetings.push({
          ...meeting,
          projectName: typeof project?.name === 'string' ? project.name : undefined,
          isMine: true,
          mineBy: isCreator && isAttendee
            ? 'creator_and_attendee'
            : isCreator ? 'creator' : 'attendee',
        })
      }

      if (!meetings.length) return repositoryOk({ meetings: [], exceptions: [] })
      const exceptionsResult = await client
        .from('meeting_exceptions')
        .select('meeting_id, occurrence_date, kind')
        .in('meeting_id', meetings.map(meeting => meeting.id))
      if (exceptionsResult.error) {
        return repositoryError(
          'MY_MEETING_EXCEPTIONS_READ_FAILED',
          isRetryableReadError(exceptionsResult.error),
        )
      }
      const snapshot: MyMeetingSnapshot = {
        meetings,
        exceptions: mapExceptions((exceptionsResult.data ?? []) as unknown as Row[]),
      }
      return repositoryOk(snapshot)
    },
  }
}
