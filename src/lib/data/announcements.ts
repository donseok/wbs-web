import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { Announcement, AnnouncementCategory, AnnouncementSummary } from '@/lib/domain/types'

/** 프로젝트 공지 목록 — 고정 우선 → 최신순. 실패 시 [] (읽기 계층 관례). */
export const getAnnouncements = cache(async (projectId: string): Promise<Announcement[]> => {
  const sb = await createServerClient()
  const { data } = await sb
    .from('announcements')
    .select('id, project_id, title, body, category, is_pinned, created_at, updated_at')
    .eq('project_id', projectId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    body: (r.body as string) ?? '',
    category: r.category as AnnouncementCategory,
    isPinned: (r.is_pinned as boolean) ?? false,
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
  const { data } = await sb
    .from('announcements')
    .select('id, title, category, is_pinned')
    .eq('project_id', projectId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

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
  const { data } = await sb
    .from('announcement_seen')
    .select('last_seen_at')
    .eq('user_id', u.user.id)
    .eq('project_id', projectId)
    .maybeSingle()
  return (data?.last_seen_at as string | undefined) ?? null
})
