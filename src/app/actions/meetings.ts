'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getMyMeetings } from '@/lib/data/meetings'
import { expandMeetings } from '@/lib/domain/meetings'
import type { Meeting, MeetingCategory, MeetingException, MeetingRecurrence } from '@/lib/domain/types'

export interface MeetingInput {
  title: string
  meetingDate: string           // 'YYYY-MM-DD'
  startTime: string | null      // 'HH:MM' | null(종일)
  endTime: string | null
  location: string | null
  category: MeetingCategory
  body: string
  recurrence: MeetingRecurrence
  recurrenceUntil: string | null
  attendeeIds: string[]
}

export interface MeetingActionResult {
  ok: boolean
  error?: string
  id?: string
}

const CATEGORIES: MeetingCategory[] = ['general', 'routine', 'kickoff', 'review', 'report', 'external']
const RECURRENCES: MeetingRecurrence[] = ['none', 'daily', 'weekly', 'biweekly', 'monthly']
const TITLE_MAX = 200
const BODY_MAX = 20000
const LOCATION_MAX = 200
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validate(input: MeetingInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > TITLE_MAX) return `제목은 ${TITLE_MAX}자 이하여야 합니다.`
  if (!DATE_RE.test(input.meetingDate)) return '날짜 형식이 올바르지 않습니다.'
  if (input.startTime !== null && !TIME_RE.test(input.startTime)) return '시작 시각 형식이 올바르지 않습니다.'
  if (input.endTime !== null && !TIME_RE.test(input.endTime)) return '종료 시각 형식이 올바르지 않습니다.'
  if (input.endTime !== null && input.startTime === null) return '종료 시각만 입력할 수 없습니다.'
  if (input.startTime && input.endTime && input.endTime <= input.startTime) return '종료 시각은 시작 시각보다 뒤여야 합니다.'
  if (input.body.length > BODY_MAX) return `회의록은 ${BODY_MAX}자 이하여야 합니다.`
  if (input.location && input.location.length > LOCATION_MAX) return `장소는 ${LOCATION_MAX}자 이하여야 합니다.`
  if (!CATEGORIES.includes(input.category)) return '잘못된 카테고리입니다.'
  if (!RECURRENCES.includes(input.recurrence)) return '잘못된 반복 옵션입니다.'
  if (input.recurrence === 'none' && input.recurrenceUntil !== null) return '반복 없음에는 종료일을 둘 수 없습니다.'
  if (input.recurrence !== 'none') {
    if (!input.recurrenceUntil || !DATE_RE.test(input.recurrenceUntil)) return '반복 종료일을 입력하세요.'
    if (input.recurrenceUntil < input.meetingDate) return '반복 종료일은 시작일 이후여야 합니다.'
  }
  return null
}

function toRow(input: MeetingInput) {
  return {
    title: input.title.trim(),
    meeting_date: input.meetingDate,
    start_time: input.startTime,
    end_time: input.endTime,
    location: input.location?.trim() || null,
    category: input.category,
    body: input.body,
    recurrence: input.recurrence,
    recurrence_until: input.recurrence === 'none' ? null : input.recurrenceUntil,
  }
}

function revalidateMeetings(projectId: string) {
  revalidatePath(`/p/${projectId}/meetings`)
  revalidatePath('/meetings')
}

/** 참석자 전체 교체(시리즈 단위). 소유권은 부모 RLS 가 강제. */
async function replaceAttendees(sb: Awaited<ReturnType<typeof createServerClient>>, meetingId: string, projectId: string, memberIds: string[]): Promise<string | null> {
  await sb.from('meeting_attendees').delete().eq('meeting_id', meetingId)
  const unique = [...new Set(memberIds)]
  if (unique.length === 0) return null
  // 다른 프로젝트 멤버 혼입 방지 — meeting 의 project_id 에 속한 member 만 허용
  const { data: valid } = await sb
    .from('project_members')
    .select('id')
    .eq('project_id', projectId)
    .in('id', unique)
  const validIds = (valid ?? []).map((r: { id: string }) => r.id)
  if (validIds.length === 0) return null
  const { error } = await sb.from('meeting_attendees').insert(validIds.map(id => ({ meeting_id: meetingId, member_id: id })))
  return error ? error.message : null
}

export async function createMeeting(projectId: string, input: MeetingInput): Promise<MeetingActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const err = validate(input)
  if (err) return { ok: false, error: err }

  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('meetings')
    .insert({
      ...toRow(input),
      project_id: projectId,
      created_by: user.id,
      created_by_name: (user.user_metadata?.name as string | undefined) ?? user.email ?? null,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  const meetingId = data.id as string
  const attErr = await replaceAttendees(sb, meetingId, projectId, input.attendeeIds)
  if (attErr) return { ok: false, error: attErr }
  revalidateMeetings(projectId)
  return { ok: true, id: meetingId }
}

export async function updateMeeting(id: string, input: MeetingInput): Promise<MeetingActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const err = validate(input)
  if (err) return { ok: false, error: err }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  // 소유권 선검증(RLS 와 동일 — 0-row 무음 성공 방지) + 규칙 변경 감지
  const { data: cur } = await sb
    .from('meetings')
    .select('project_id, created_by, meeting_date, recurrence, recurrence_until')
    .eq('id', id)
    .maybeSingle()
  if (!cur) return { ok: false, error: '회의를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const projectId = cur.project_id as string

  const { error } = await sb
    .from('meetings')
    .update({ ...toRow(input), updated_at: new Date().toISOString() }) // created_by 는 SET 하지 않음(불변)
    .eq('id', id)
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  // 시작일/반복규칙/종료일이 바뀌면 취소 예외가 어긋나므로 전부 삭제(정직한 v1 의미)
  const ruleChanged =
    (cur.meeting_date as string) !== input.meetingDate ||
    (cur.recurrence as string) !== input.recurrence ||
    ((cur.recurrence_until as string | null) ?? null) !== input.recurrenceUntil
  if (ruleChanged) await sb.from('meeting_exceptions').delete().eq('meeting_id', id)

  const attErr = await replaceAttendees(sb, id, projectId, input.attendeeIds)
  if (attErr) return { ok: false, error: attErr }
  revalidateMeetings(projectId)
  return { ok: true, id }
}

export async function deleteMeeting(id: string): Promise<MeetingActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: cur } = await sb.from('meetings').select('project_id, created_by').eq('id', id).maybeSingle()
  if (!cur) return { ok: false, error: '회의를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const { error } = await sb.from('meetings').delete().eq('id', id).select('id').single()
  if (error) return { ok: false, error: error.message }
  revalidateMeetings(cur.project_id as string)
  return { ok: true }
}

export async function setMeetingAttendees(meetingId: string, memberIds: string[]): Promise<MeetingActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: cur } = await sb.from('meetings').select('project_id, created_by').eq('id', meetingId).maybeSingle()
  if (!cur) return { ok: false, error: '회의를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const attErr = await replaceAttendees(sb, meetingId, cur.project_id as string, memberIds)
  if (attErr) return { ok: false, error: attErr }
  revalidateMeetings(cur.project_id as string)
  return { ok: true }
}

/** occurrenceDate 가 실제 규칙상 회차인지 검증 후 취소 예외행 insert. */
export async function cancelOccurrence(meetingId: string, occurrenceDate: string): Promise<MeetingActionResult> {
  const gate = await occurrenceGate(meetingId, occurrenceDate)
  if (!gate.ok) return gate
  const sb = gate.sb
  const { error } = await sb
    .from('meeting_exceptions')
    .upsert({ meeting_id: meetingId, occurrence_date: occurrenceDate, kind: 'cancelled' }, { onConflict: 'meeting_id,occurrence_date' })
  if (error) return { ok: false, error: error.message }
  revalidateMeetings(gate.projectId)
  return { ok: true }
}

export async function restoreOccurrence(meetingId: string, occurrenceDate: string): Promise<MeetingActionResult> {
  const gate = await occurrenceGate(meetingId, occurrenceDate)
  if (!gate.ok) return gate
  const { error } = await gate.sb.from('meeting_exceptions').delete().eq('meeting_id', meetingId).eq('occurrence_date', occurrenceDate)
  if (error) return { ok: false, error: error.message }
  revalidateMeetings(gate.projectId)
  return { ok: true }
}

type Gate = { ok: true; sb: Awaited<ReturnType<typeof createServerClient>>; projectId: string } | { ok: false; error: string }
async function occurrenceGate(meetingId: string, occurrenceDate: string): Promise<Gate> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (!DATE_RE.test(occurrenceDate)) return { ok: false, error: '잘못된 날짜입니다.' }
  const sb = await createServerClient()
  const { data: r } = await sb
    .from('meetings')
    .select('project_id, created_by, title, meeting_date, start_time, end_time, location, category, recurrence, recurrence_until, created_by_name, created_at, updated_at')
    .eq('id', meetingId)
    .maybeSingle()
  if (!r) return { ok: false, error: '회의를 찾을 수 없습니다.' }
  const isOwner = (r.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  if (r.recurrence === 'none') return { ok: false, error: '반복 회의만 회차를 취소할 수 있습니다.' }
  // 규칙상 실제 회차인지 검증 — 해당 날짜만 전개해 매칭
  const meeting = {
    id: meetingId, projectId: r.project_id as string, title: r.title as string,
    meetingDate: r.meeting_date as string, startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null, location: (r.location as string | null) ?? null,
    category: r.category as MeetingCategory, body: '', recurrence: r.recurrence as MeetingRecurrence,
    recurrenceUntil: (r.recurrence_until as string | null) ?? null, createdBy: r.created_by as string | null,
    createdByName: (r.created_by_name as string | null) ?? null, createdAt: r.created_at as string,
    updatedAt: r.updated_at as string, attendeeIds: [],
  } satisfies Meeting
  const occ = expandMeetings([meeting], [], occurrenceDate, occurrenceDate)
  if (!occ.some(o => o.occurrenceDate === occurrenceDate)) return { ok: false, error: '해당 날짜는 이 회의의 회차가 아닙니다.' }
  return { ok: true, sb, projectId: r.project_id as string }
}

/** 클라이언트(내 회의 뷰)에서 월 이동 시 호출하는 얇은 래퍼. */
export async function fetchMyMeetings(
  gridStartIso: string,
  gridEndIso: string,
): Promise<{ meetings: Meeting[]; exceptions: MeetingException[] }> {
  const user = await getSession()
  if (!user) return { meetings: [], exceptions: [] }
  return getMyMeetings(gridStartIso, gridEndIso)
}
