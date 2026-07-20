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

/**
 * 취소 회차를 부모 회의 조회에 함께 싣는 FK 임베드(0013_meetings.sql:47 의 meeting_id FK).
 * 별도 `.in()` 왕복 1회를 없앤다 — 회의 화면이 앱에서 가장 직렬 체인이 길다.
 */
const EXCEPTION_EMBED = 'meeting_exceptions(meeting_id, occurrence_date, kind)'

function toException(e: Row): MeetingException {
  return {
    meetingId: e.meeting_id as string,
    occurrenceDate: e.occurrence_date as string,
    kind: 'cancelled' as const,
  }
}

/** 임베드로 함께 온 예외들을 평탄화. */
function exceptionsFrom(rows: Row[]): MeetingException[] {
  return rows.flatMap(r => ((r.meeting_exceptions as Row[] | null) ?? []).map(toException))
}

/** 임베드가 불가했을 때만 쓰는 폴백 — 예외를 별도 왕복으로 읽는다. */
async function fetchExceptionsByIds(
  sb: ServerClient, ids: string[], tag: string,
): Promise<MeetingException[]> {
  if (!ids.length) return []
  const { data, error } = await sb
    .from('meeting_exceptions')
    .select('meeting_id, occurrence_date, kind')
    .in('meeting_id', ids)
  // 예외 조회 실패 = 취소된 회차가 되살아나 보인다(취소 표시가 사라짐).
  if (error) console.error(`[${tag}] meeting_exceptions 조회 실패(취소 회차가 표시됨):`, error.message)
  return (data ?? []).map((e: Row) => toException(e))
}

type RowsResult = { data: Row[] | null; error: { message: string } | null }

/**
 * 예외 임베드를 태워 회의를 조회하고, 임베드가 원인일 수 있는 실패면 임베드 없이 1회 재시도한다.
 * 임베드는 관계 미탐지 시 **부모 쿼리 전체를 에러로 만들기** 때문에, 재시도가 없으면
 * 회의가 하나도 없는 것처럼 보인다(정상 상태와 구별 불가).
 * `embedded=false` 로 돌아오면 호출부가 예외를 별도 조회해야 한다.
 *
 * build 가 select 문자열을 받는 콜백인 이유: 임베드 유무로 PostgREST 의 추론 행 타입이 갈려
 * 같은 변수에 재대입할 수 없다. 호출부마다 필터가 달라 빌더 자체를 넘겨받는다.
 */
async function selectMeetings(
  build: (select: string) => PromiseLike<unknown>,
  cols: string,
  tag: string,
  consequence: string,
): Promise<{ rows: Row[]; embedded: boolean }> {
  const first = await build(`${cols}, ${EXCEPTION_EMBED}`) as RowsResult
  if (!first.error) return { rows: (first.data ?? []) as Row[], embedded: true }

  console.error(`[${tag}] 예외 임베드 조회 실패, 임베드 없이 재시도:`, first.error.message)
  const retry = await build(cols) as RowsResult
  if (retry.error) console.error(`[${tag}] meetings 조회 실패 — ${consequence}:`, retry.error.message)
  return { rows: (retry.data ?? []) as Row[], embedded: false }
}

/** 프로젝트 전체 회의 시리즈 + 예외. body 제외(상세 모달에서 로드). 실패 시 빈 구조. */
export const getProjectMeetingData = cache(async (
  projectId: string,
): Promise<{ meetings: Meeting[]; exceptions: MeetingException[] }> => {
  const sb = await createServerClient()
  const COLS = 'id, project_id, title, meeting_date, start_time, end_time, location, category, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id)'

  // 예외를 임베드해 왕복 2회 → 1회.
  const { rows, embedded } = await selectMeetings(
    select => sb.from('meetings').select(select)
      .eq('project_id', projectId).order('meeting_date', { ascending: true }),
    COLS, 'getProjectMeetingData',
    "캘린더와 회의록의 '회의 연결' 드롭다운이 '회의 없음'으로 위장됨",
  )

  const meetings = rows.map((r: Row) => mapMeeting(r, attendeeIdsFrom(r)))
  const exceptions = embedded
    ? exceptionsFrom(rows)
    : await fetchExceptionsByIds(sb, meetings.map(m => m.id), 'getProjectMeetingData')
  return { meetings, exceptions }
})

/** 상세 모달 — body + 참석자 표시 정보. 없으면 null. */
export const getMeetingDetail = cache(async (
  id: string,
): Promise<{ meeting: Meeting; attendees: MeetingAttendeeInfo[] } | null> => {
  const sb = await createServerClient()
  const { data: r, error } = await sb
    .from('meetings')
    .select('id, project_id, title, meeting_date, start_time, end_time, location, category, body, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id)')
    .eq('id', id)
    .maybeSingle()

  // 조회 실패가 null 폴백을 타면 호출부(상세 모달)는 '삭제된 회의'로 오인한다 — 원인을 로그로 남긴다.
  if (error) console.error('[getMeetingDetail] 조회 실패:', error.message)
  if (!r) return null

  const attendeeIds = attendeeIdsFrom(r as Row)
  let attendees: MeetingAttendeeInfo[] = []
  if (attendeeIds.length) {
    const { data: mem, error: memErr } = await sb
      .from('project_members')
      .select('id, name, email, teams(code)')
      .in('id', attendeeIds)
    // 참석자 조회 실패 = 참석자가 지정돼 있는데도 '참석자 없음'으로 보인다.
    if (memErr) console.error('[getMeetingDetail] 참석자 조회 실패:', memErr.message)
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
  const user = u.user
  const uid = user?.id ?? null
  if (!user || !uid) return { meetings: [], exceptions: [] }

  const orClause =
    `and(recurrence.eq.none,meeting_date.gte.${gridStartIso},meeting_date.lte.${gridEndIso}),` +
    `and(recurrence.neq.none,meeting_date.lte.${gridEndIso},or(recurrence_until.is.null,recurrence_until.gte.${gridStartIso}))`

  const COLS = 'id, project_id, title, meeting_date, start_time, end_time, category, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id), projects(name)'

  // 멤버 ID 조회와 회의 조회는 서로 무관하다(멤버 ID 는 isMine 계산에만 쓰임) — 병렬로 묶고
  // 예외는 임베드로 같은 왕복에 태워 직렬 4단(getUser→멤버→회의→예외)을 2단으로 줄인다.
  // resolveMemberIds 를 직접 부른다: 예전의 getMyMemberIds() 래퍼는 자체 클라이언트로 getUser 를
  // 한 번 더 했다. 인자화한 cache() 로 바꾸면 안 된다 — React cache 는 인자의 참조 동일성으로
  // 키를 만드는데 user 객체가 호출마다 새로 만들어져 영구 미스가 된다.
  const [myMemberIdList, { rows, embedded }] = await Promise.all([
    resolveMemberIds(sb, user),
    selectMeetings(
      select => sb.from('meetings').select(select).or(orClause).order('meeting_date', { ascending: true }),
      COLS, 'getMyMeetings',
      "'내 회의' 캘린더가 '이번 달 회의 없음'으로 위장돼 사용자가 회의를 놓침",
    ),
  ])
  const myMemberIds = new Set(myMemberIdList)

  const meetings = rows.map((r: Row) => {
    const attendeeIds = attendeeIdsFrom(r)
    const projectName = ((r.projects as { name: string } | null)?.name) ?? null
    const isMine = (r.created_by as string | null) === uid || attendeeIds.some(id => myMemberIds.has(id))
    // 목록 payload 는 body/location 미포함(상세에서 로드)
    return mapMeeting({ ...r, body: '', location: null }, attendeeIds, {
      projectName: projectName ?? undefined,
      isMine,
    })
  })

  const exceptions = embedded
    ? exceptionsFrom(rows)
    : await fetchExceptionsByIds(sb, meetings.map(m => m.id), 'getMyMeetings')
  return { meetings, exceptions }
})
