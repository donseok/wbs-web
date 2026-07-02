'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import type { AnnouncementCategory } from '@/lib/domain/types'

export interface AnnouncementInput {
  title: string
  body: string
  category: AnnouncementCategory
  isPinned: boolean
}

export interface AnnouncementActionResult {
  ok: boolean
  error?: string
}

const CATEGORIES: AnnouncementCategory[] = ['general', 'important', 'event']
const TITLE_MAX = 200
const BODY_MAX = 20000

function validateInput(input: AnnouncementInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > TITLE_MAX) return `제목은 ${TITLE_MAX}자 이하여야 합니다.`
  if (input.body.length > BODY_MAX) return `본문은 ${BODY_MAX}자 이하여야 합니다.`
  if (!CATEGORIES.includes(input.category)) return '잘못된 카테고리입니다.'
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

/** 사이드바 배지용 안읽음 공지 수 — 워터마크 이후 생성된 공지 count. */
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

  let query = sb
    .from('announcements')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
  if (seen?.last_seen_at) query = query.gt('created_at', seen.last_seen_at as string)
  const { count } = await query
  return count ?? 0
}
