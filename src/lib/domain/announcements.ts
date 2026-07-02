import type { Announcement, AnnouncementCategory } from '@/lib/domain/types'

/**
 * 카테고리 메타 — 라벨은 dict 키(표시 지점에서 t()로 해석), 색상은 상태 팔레트
 * 재사용으로 라이트·다크 자동 대응. (ATTENDANCE_META/roleMeta 관례)
 */
export const ANNOUNCEMENT_META: Record<
  AnnouncementCategory,
  { labelKey: `ann.cat.${AnnouncementCategory}`; chip: string; dot: string }
> = {
  general:   { labelKey: 'ann.cat.general',   chip: 'bg-brand-weak text-brand',       dot: 'bg-brand' },
  important: { labelKey: 'ann.cat.important', chip: 'bg-delayed-weak text-delayed',   dot: 'bg-delayed' },
  event:     { labelKey: 'ann.cat.event',     chip: 'bg-progress-weak text-progress', dot: 'bg-progress' },
}

/** 카테고리 표시 순서 (필터 탭/폼 셀렉트용) */
export const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = ['general', 'important', 'event']

/** 고정 우선 → 최신순. 원본을 변형하지 않는다. */
export function sortAnnouncements(items: Announcement[]): Announcement[] {
  return [...items].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    return Date.parse(b.createdAt) - Date.parse(a.createdAt)
  })
}

/** 워터마크(마지막으로 목록을 본 시각) 이후 생성된 공지인가. null 워터마크 = 전부 안읽음. */
export function isUnread(a: Announcement, lastSeenAt: string | null): boolean {
  if (lastSeenAt === null) return true
  return Date.parse(a.createdAt) > Date.parse(lastSeenAt)
}

export function countUnread(items: Announcement[], lastSeenAt: string | null): number {
  return items.filter((a) => isUnread(a, lastSeenAt)).length
}

const DAY = 86_400_000

/** KPI 집계 — recent7d는 todayIso('YYYY-MM-DD') 포함 직전 7일(UTC 자정 기준). */
export function summarizeAnnouncements(
  items: Announcement[],
  todayIso: string,
): { total: number; pinned: number; recent7d: number } {
  const cutoff = Date.parse(`${todayIso}T00:00:00Z`) - 6 * DAY
  let pinned = 0
  let recent7d = 0
  for (const a of items) {
    if (a.isPinned) pinned++
    if (Date.parse(a.createdAt) >= cutoff) recent7d++
  }
  return { total: items.length, pinned, recent7d }
}
