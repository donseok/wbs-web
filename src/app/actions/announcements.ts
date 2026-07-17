'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getTopAnnouncements } from '@/lib/data/announcements'
import type { AnnouncementCategory, AnnouncementSummary } from '@/lib/domain/types'
import { expandMeetings } from '@/lib/domain/meetings'
import { composeAnnouncementFromMeeting } from '@/lib/domain/announcements'
import type { MeetingCategory, MeetingRecurrence } from '@/lib/domain/types'

export interface AnnouncementInput {
  title: string
  body: string
  category: AnnouncementCategory
  isPinned: boolean
  publishFrom: string // 'YYYY-MM-DD' (KST) 게시 시작일 · 필수
  publishTo: string   // 'YYYY-MM-DD' (KST) 게시 종료일(포함) · 필수
}

export interface AnnouncementActionResult {
  ok: boolean
  error?: string
}

const CATEGORIES: AnnouncementCategory[] = ['general', 'important', 'event']
const TITLE_MAX = 200
const BODY_MAX = 20000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 오늘 'YYYY-MM-DD' (Asia/Seoul) — publish_from/to(date) 비교 기준. 앱 날짜 표기 관례. */
function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/** 'YYYY-MM-DD' 형식 + 실재하는 날짜인지 (2026-02-30 등 반려) */
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function validateInput(input: AnnouncementInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > TITLE_MAX) return `제목은 ${TITLE_MAX}자 이하여야 합니다.`
  if (input.body.length > BODY_MAX) return `본문은 ${BODY_MAX}자 이하여야 합니다.`
  if (!CATEGORIES.includes(input.category)) return '잘못된 카테고리입니다.'
  if (!input.publishFrom || !input.publishTo) return '게시 시작일과 종료일을 모두 지정하세요.'
  if (!isValidDate(input.publishFrom) || !isValidDate(input.publishTo)) return '게시 기간 날짜 형식이 올바르지 않습니다.'
  if (input.publishFrom > input.publishTo) return '게시 종료일은 시작일보다 빠를 수 없습니다.'
  return null
}

/** 공지 목록·대시보드 카드 동시 갱신 */
function revalidateAnnouncements(projectId: string) {
  revalidatePath(`/p/${projectId}/announcements`)
  revalidatePath(`/p/${projectId}/dashboard`)
}

export async function createAnnouncement(
  projectId: string,
  input: AnnouncementInput,
): Promise<AnnouncementActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  if (m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const err = validateInput(input)
  if (err) return { ok: false, error: err }

  const user = await getSession()
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('announcements')
    .insert({
      project_id: projectId,
      title: input.title.trim(),
      body: input.body,
      category: input.category,
      is_pinned: input.isPinned,
      publish_from: input.publishFrom,
      publish_to: input.publishTo,
      created_by: user?.id ?? null,
    })
    .select('created_at')
    .single()
  if (error) return { ok: false, error: error.message }
  // 작성자 본인에게 방금 쓴 공지가 '안읽음'(NEW 칩·배지)으로 잡히지 않도록 워터마크 전진
  if (user && data?.created_at) {
    await advanceSeenWatermark(projectId, user.id, data.created_at as string)
  }
  revalidateAnnouncements(projectId)
  return { ok: true }
}

export async function updateAnnouncement(
  id: string,
  input: AnnouncementInput,
): Promise<AnnouncementActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  if (m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const err = validateInput(input)
  if (err) return { ok: false, error: err }

  const sb = await createServerClient()
  const { data, error } = await sb
    .from('announcements')
    .update({
      title: input.title.trim(),
      body: input.body,
      category: input.category,
      is_pinned: input.isPinned,
      publish_from: input.publishFrom,
      publish_to: input.publishTo,
      updated_at: new Date().toISOString(), // updated_at 트리거 없음 — 수동 갱신(wbs.ts 관례)
    })
    .eq('id', id)
    .select('project_id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (data?.project_id) revalidateAnnouncements(data.project_id as string)
  return { ok: true }
}

export async function deleteAnnouncement(id: string): Promise<AnnouncementActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  if (m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const sb = await createServerClient()
  const { data, error } = await sb
    .from('announcements')
    .delete()
    .eq('id', id)
    .select('project_id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (data?.project_id) revalidateAnnouncements(data.project_id as string)
  return { ok: true }
}

/**
 * 워터마크 전진 — 뒤로 가지 않는다(greatest). 오래된 탭의 늦은 호출이나 중복 방문이
 * 이미 앞선 워터마크를 되돌리지 않도록 기존 값과 비교 후 더 클 때만 기록한다.
 * (읽기→쓰기 2단계라 극단적 동시 호출에서 작은 값이 이길 수 있으나, 그 경우
 * 일부 공지가 다시 '안읽음'으로 보일 뿐 — 안전한 방향으로 실패한다.)
 */
async function advanceSeenWatermark(
  projectId: string,
  userId: string,
  seenAt: string,
): Promise<AnnouncementActionResult> {
  const sb = await createServerClient()
  const { data: existing } = await sb
    .from('announcement_seen')
    .select('last_seen_at')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .maybeSingle()
  const current = existing?.last_seen_at as string | undefined
  if (current && Date.parse(current) >= Date.parse(seenAt)) return { ok: true }
  const { error } = await sb.from('announcement_seen').upsert(
    { user_id: userId, project_id: projectId, last_seen_at: seenAt },
    { onConflict: 'user_id,project_id' },
  )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * 공지 확인 처리 — 렌더 시점에 실제로 보인 마지막 공지 시각(seenAt)까지만 읽음 처리.
 * 액션 실행 시각이 아니라 스냅샷 기준이라, 렌더~호출 사이에 도착한 공지는
 * 안읽음으로 남는다. 게스트 포함 모든 인증 사용자.
 */
export async function markAnnouncementsSeen(
  projectId: string,
  seenAt: string,
): Promise<AnnouncementActionResult> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const ts = Date.parse(seenAt)
  if (Number.isNaN(ts)) return { ok: false, error: '잘못된 시각입니다.' }
  // 미래 시각 방지(클라이언트 값 신뢰 금지) — now 로 클램프
  const clamped = new Date(Math.min(ts, Date.now())).toISOString()
  return advanceSeenWatermark(projectId, user.id, clamped)
}

/** 헤더 티커용 상위 공지(고정 우선 → 최신순 5건) — 세션 확인 후 경량 조회에 위임. */
export async function getHeaderAnnouncements(projectId: string): Promise<AnnouncementSummary[]> {
  const user = await getSession()
  if (!user) return []
  return getTopAnnouncements(projectId)
}

/**
 * 사이드바 배지용 안읽음 공지 수 — 워터마크 이후 생성된 "오늘 게시중" 공지 count.
 * 게시기간 필터가 없으면 만료 공지가 영구 안읽음으로 남는다(일반 사용자는 만료 공지를
 * 목록에서 볼 수 없어 워터마크가 그것을 넘지 못함). getTopAnnouncements와 같은 조건.
 */
export async function getUnreadAnnouncementCount(projectId: string): Promise<number> {
  const user = await getSession()
  if (!user) return 0
  const sb = await createServerClient()
  const { data: seen } = await sb
    .from('announcement_seen')
    .select('last_seen_at')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .maybeSingle()

  const today = seoulToday()
  // 게시중만: (from is null 또는 from<=today) AND (to is null 또는 to>=today).
  // .or() 는 서로 AND 결합 — 각 경계를 별도 .or() 로 건다.
  let query = sb
    .from('announcements')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .or(`publish_from.is.null,publish_from.lte.${today}`)
    .or(`publish_to.is.null,publish_to.gte.${today}`)
  if (seen?.last_seen_at) query = query.gt('created_at', seen.last_seen_at as string)
  const { count } = await query
  return count ?? 0
}

/**
 * 회의 1회차를 바탕으로 공지사항 1건을 생성한다(원클릭 등록). 회의는 그대로 둔다.
 * pmo_admin 전용. occurrenceDate 가 실제 규칙상 회차인지 서버에서 재검증하고
 * (클라이언트 값 불신), 본문은 composeAnnouncementFromMeeting 으로 조합한다.
 */
export async function createAnnouncementFromMeeting(
  meetingId: string,
  occurrenceDate: string,
): Promise<AnnouncementActionResult> {
  const m = await getMembership()
  if (!m || m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  if (!DATE_RE.test(occurrenceDate)) return { ok: false, error: '잘못된 날짜입니다.' }

  const user = await getSession()
  const sb = await createServerClient()
  const { data: r } = await sb
    .from('meetings')
    .select('project_id, title, body, meeting_date, start_time, end_time, location, category, recurrence, recurrence_until')
    .eq('id', meetingId)
    .maybeSingle()
  if (!r) return { ok: false, error: '회의를 찾을 수 없습니다.' }

  // 회차 검증 — 비반복/반복 모두 expandMeetings 로 동일하게 처리(해당 날짜만 전개).
  const meeting = {
    id: meetingId, projectId: r.project_id as string, title: r.title as string,
    meetingDate: r.meeting_date as string, startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null, location: (r.location as string | null) ?? null,
    category: r.category as MeetingCategory, body: '', recurrence: r.recurrence as MeetingRecurrence,
    recurrenceUntil: (r.recurrence_until as string | null) ?? null, createdBy: null,
    createdByName: null, createdAt: '', updatedAt: '', attendeeIds: [],
  }
  const occ = expandMeetings([meeting], [], occurrenceDate, occurrenceDate)
  if (!occ.some(o => o.occurrenceDate === occurrenceDate)) {
    return { ok: false, error: '해당 날짜는 이 회의의 회차가 아닙니다.' }
  }

  const input = composeAnnouncementFromMeeting({
    title: r.title as string,
    occurrenceDate,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    body: (r.body as string | null) ?? '',
  }, seoulToday())

  const projectId = r.project_id as string
  const { data, error } = await sb
    .from('announcements')
    .insert({
      project_id: projectId,
      title: input.title,
      body: input.body,
      category: input.category,
      is_pinned: input.isPinned,
      publish_from: input.publishFrom,
      publish_to: input.publishTo,
      created_by: user?.id ?? null,
    })
    .select('created_at')
    .single()
  if (error) return { ok: false, error: error.message }
  if (user && data?.created_at) {
    await advanceSeenWatermark(projectId, user.id, data.created_at as string)
  }
  revalidateAnnouncements(projectId)
  return { ok: true }
}
