import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { Announcement, AnnouncementCategory, AnnouncementSummary } from '@/lib/domain/types'

/** 오늘 'YYYY-MM-DD' (Asia/Seoul) — publish_from/to(date) 비교 기준. 앱 날짜 표기 관례. */
function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/** 프로젝트 공지 목록 — 고정 우선 → 최신순. 실패 시 [] (읽기 계층 관례). */
export const getAnnouncements = cache(async (projectId: string): Promise<Announcement[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('announcements')
    .select('id, project_id, title, body, category, is_pinned, publish_from, publish_to, created_at, updated_at')
    .eq('project_id', projectId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) console.error('[getAnnouncements] 조회 실패:', error.message)

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    body: (r.body as string) ?? '',
    category: r.category as AnnouncementCategory,
    isPinned: (r.is_pinned as boolean) ?? false,
    publishFrom: (r.publish_from as string | null) ?? null,
    publishTo: (r.publish_to as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }))
})

/**
 * 헤더 티커용 상위 공지 — 고정 우선 → 최신순 limit건, 표시 컬럼만(body 제외).
 * getAnnouncements와 정렬 기준이 같고 DB에서 limit까지 끝낸다. 실패 시 [].
 */
export const getTopAnnouncements = cache(async (projectId: string, limit = 5): Promise<AnnouncementSummary[]> => {
  const sb = await createServerClient()
  const today = seoulToday()
  // 게시중만: (from is null 또는 from<=today) AND (to is null 또는 to>=today).
  // .or() 는 서로 AND 결합 — 각 경계를 별도 .or() 로 건다.
  const { data, error } = await sb
    .from('announcements')
    .select('id, title, category, is_pinned')
    .eq('project_id', projectId)
    .or(`publish_from.is.null,publish_from.lte.${today}`)
    .or(`publish_to.is.null,publish_to.gte.${today}`)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) console.error('[getTopAnnouncements] 조회 실패:', error.message)

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    title: r.title as string,
    category: r.category as AnnouncementCategory,
    isPinned: (r.is_pinned as boolean) ?? false,
  }))
})

/** 현재 사용자의 읽음 워터마크(마지막으로 공지 목록을 본 시각). 없으면 null. */
export const getAnnouncementSeenAt = cache(async (projectId: string): Promise<string | null> => {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return null
  const { data, error } = await sb
    .from('announcement_seen')
    .select('last_seen_at')
    .eq('user_id', u.user.id)
    .eq('project_id', projectId)
    .maybeSingle()

  // 조회 실패는 '워터마크 없음(=한 번도 안 봄)'과 구별되지 않아 **모든 공지가 NEW로 부풀어** 배지가 거짓말을 한다.
  // 여기서 throw 하면 공지 페이지 자체가 뜨지 않으므로(읽는 것보다 나쁨) 폴백은 유지하고 원인만 로그로 남긴다.
  if (error) console.error('[getAnnouncementSeenAt] 읽음 워터마크 조회 실패(공지가 모두 NEW로 표시됨):', error.message)

  return (data?.last_seen_at as string | undefined) ?? null
})
