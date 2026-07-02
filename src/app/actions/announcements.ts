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
  const { error } = await sb.from('announcements').insert({
    project_id: projectId,
    title: input.title.trim(),
    body: input.body,
    category: input.category,
    is_pinned: input.isPinned,
    created_by: user?.id ?? null,
  })
  if (error) return { ok: false, error: error.message }
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

/** 공지 목록 확인 처리(워터마크 upsert) — 게스트 포함 모든 인증 사용자. */
export async function markAnnouncementsSeen(projectId: string): Promise<AnnouncementActionResult> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { error } = await sb.from('announcement_seen').upsert(
    { user_id: user.id, project_id: projectId, last_seen_at: new Date().toISOString() },
    { onConflict: 'user_id,project_id' },
  )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
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
