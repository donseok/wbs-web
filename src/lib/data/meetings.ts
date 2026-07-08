import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type {
  Meeting, MeetingAttendeeInfo, MeetingCategory, MeetingException, MeetingRecurrence, TeamCode,
} from '@/lib/domain/types'

type Row = Record<string, unknown>
type ServerClient = Awaited<ReturnType<typeof createServerClient>>

function mapMeeting(r: Row, attendeeIds: string[], extra: Partial<Meeting> = {}): Meeting {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    meetingDate: r.meeting_date as string,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    category: r.category as MeetingCategory,
    body: (r.body as string) ?? '',
    recurrence: r.recurrence as MeetingRecurrence,
    recurrenceUntil: (r.recurrence_until as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    attendeeIds,
    ...extra,
  }
}

function attendeeIdsFrom(r: Row): string[] {
  const raw = (r.meeting_attendees as { member_id: string }[] | null) ?? []
  return raw.map(a => a.member_id)
}

/** 프로젝트 전체 회의 시리즈 + 예외. body 제외(상세 모달에서 로드). 실패 시 빈 구조. */
export const getProjectMeetingData = cache(async (
  projectId: string,
): Promise<{ meetings: Meeting[]; exceptions: MeetingException[] }> => {
  const sb = await createServerClient()
  const { data: rows } = await sb
    .from('meetings')
    .select('id, project_id, title, meeting_date, start_time, end_time, location, category, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id)')
    .eq('project_id', projectId)
    .order('meeting_date', { ascending: true })

  const meetings = (rows ?? []).map((r: Row) => mapMeeting(r, attendeeIdsFrom(r)))
  const ids = meetings.map(m => m.id)
  let exceptions: MeetingException[] = []
  if (ids.length) {
    const { data: ex } = await sb
      .from('meeting_exceptions')
      .select('meeting_id, occurrence_date, kind')
      .in('meeting_id', ids)
    exceptions = (ex ?? []).map((e: Row) => ({
      meetingId: e.meeting_id as string,
      occurrenceDate: e.occurrence_date as string,
      kind: 'cancelled' as const,
    }))
  }
  return { meetings, exceptions }
})

/** 상세 모달 — body + 참석자 표시 정보. 없으면 null. */
export const getMeetingDetail = cache(async (
  id: string,
): Promise<{ meeting: Meeting; attendees: MeetingAttendeeInfo[] } | null> => {
  const sb = await createServerClient()
  const { data: r } = await sb
    .from('meetings')
    .select('id, project_id, title, meeting_date, start_time, end_time, location, category, body, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id)')
    .eq('id', id)
    .maybeSingle()
  if (!r) return null

  const attendeeIds = attendeeIdsFrom(r as Row)
  let attendees: MeetingAttendeeInfo[] = []
  if (attendeeIds.length) {
    const { data: mem } = await sb
      .from('project_members')
      .select('id, name, email, teams(code)')
      .in('id', attendeeIds)
    attendees = (mem ?? []).map((m: Row) => ({
      id: m.id as string,
      name: m.name as string,
      email: (m.email as string | null) ?? null,
      teamCode: ((m.teams as { code: TeamCode } | null)?.code) ?? null,
    }))
  }
  return { meeting: mapMeeting(r as Row, attendeeIds), attendees }
})

/**
 * 로그인 계정에 연결된 project_members.id 집합. 크로스 프로젝트 조회이므로
 * user_id(0019 가 도입한 auth.users FK) 와 email 매칭의 **합집합**을 낸다 —
 * 한쪽만 보면 프로젝트마다 연결 방식이 다른 사람을 놓친다.
 * (예: 사내 계정은 email 로, 개인 gmail 계정은 명시적 user_id 로 같은 멤버 행에 이어진다.)
 * 한쪽 조회가 실패해도 다른 쪽 결과로 계속 동작한다 — 마이그레이션 전 배포에 대한 내성.
 * 외부 인력 행은 user_id NULL 로 남고 로그인하지 않으므로 여기 걸리지 않는다.
 */
export async function resolveMemberIds(
  sb: ServerClient,
  user: { id: string; email?: string | null },
): Promise<string[]> {
  const email = user.email?.trim().toLowerCase() || null
  const [byUser, byEmail] = await Promise.all([
    sb.from('project_members').select('id').eq('user_id', user.id),
    email
      ? sb.from('project_members').select('id').eq('email', email)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ])

  const ids = new Set<string>()
  for (const [label, res] of [['user_id', byUser], ['email', byEmail]] as const) {
    if (res.error) {
      // 무매칭([])과 조회 실패를 호출부가 구별할 수 없으므로 최소한 로그로는 남긴다.
      console.error(`[resolveMemberIds] ${label} 조회 실패:`, res.error.message)
      continue
    }
    for (const r of (res.data ?? []) as Row[]) ids.add(r.id as string)
  }
  return [...ids]
}

/** 현재 로그인 사용자의 project_members.id 집합. 비로그인/무매칭 시 []. */
export const getMyMemberIds = cache(async (): Promise<string[]> => {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return []
  return resolveMemberIds(sb, u.user)
})

/**
 * 크로스 프로젝트 '내 회의' 범위 조회. body/location 제외(캘린더 필드만),
 * isMine(작성자==나 or 참석자에 내 member 포함) + projectName 세팅.
 * fetch 조건: 비반복은 [start,end], 반복은 meeting_date<=end AND (until IS NULL OR until>=start).
 */
export const getMyMeetings = cache(async (
  gridStartIso: string,
  gridEndIso: string,
): Promise<{ meetings: Meeting[]; exceptions: MeetingException[] }> => {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  const uid = u.user?.id ?? null
  if (!uid) return { meetings: [], exceptions: [] }

  const myMemberIds = new Set(await getMyMemberIds())

  const orClause =
    `and(recurrence.eq.none,meeting_date.gte.${gridStartIso},meeting_date.lte.${gridEndIso}),` +
    `and(recurrence.neq.none,meeting_date.lte.${gridEndIso},or(recurrence_until.is.null,recurrence_until.gte.${gridStartIso}))`

  const { data: rows } = await sb
    .from('meetings')
    .select('id, project_id, title, meeting_date, start_time, end_time, category, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id), projects(name)')
    .or(orClause)
    .order('meeting_date', { ascending: true })

  const meetings = (rows ?? []).map((r: Row) => {
    const attendeeIds = attendeeIdsFrom(r)
    const projectName = ((r.projects as { name: string } | null)?.name) ?? null
    const isMine = (r.created_by as string | null) === uid || attendeeIds.some(id => myMemberIds.has(id))
    // 목록 payload 는 body/location 미포함(상세에서 로드)
    return mapMeeting({ ...r, body: '', location: null }, attendeeIds, {
      projectName: projectName ?? undefined,
      isMine,
    })
  })

  const ids = meetings.map(m => m.id)
  let exceptions: MeetingException[] = []
  if (ids.length) {
    const { data: ex } = await sb
      .from('meeting_exceptions')
      .select('meeting_id, occurrence_date, kind')
      .in('meeting_id', ids)
    exceptions = (ex ?? []).map((e: Row) => ({
      meetingId: e.meeting_id as string,
      occurrenceDate: e.occurrence_date as string,
      kind: 'cancelled' as const,
    }))
  }
  return { meetings, exceptions }
})
