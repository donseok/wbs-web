// 좌석표(/agents) 접근 — 슈퍼유저 또는 관리자인 프로젝트가 1개 이상. usageAccess 와 같은 자리(페이지·사이드바가 함께 쓴다).
import { adminProjectIds, isAnyProjectAdmin, type Actor } from '@/lib/domain/authz'

export function canViewAgents(actor: Actor | null): boolean {
  return isAnyProjectAdmin(actor)
}

/** 층(프로젝트) 목록. null = 전체(슈퍼유저). 관리자는 관리자인 프로젝트만. */
export function seatmapProjectIds(actor: Actor | null): string[] | null {
  if (!actor) return []
  if (actor.isSuperuser) return null
  return adminProjectIds(actor)
}
