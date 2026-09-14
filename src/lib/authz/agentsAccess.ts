// 좌석표(/agents) 접근 — 슈퍼유저 또는 역할(member/admin)이 있는 프로젝트가 1개 이상. usageAccess 와 같은 자리(페이지·사이드바가 함께 쓴다).
// (2026-09-14 사용자 결정) 기본 범위가 '내 작업'이 되면서 관리자 전용에서 멤버까지 연다. 역할이 없는 조회 전용 계정은 여전히 못 본다.
import { hasAnyProjectRole, type Actor } from '@/lib/domain/authz'

export function canViewAgents(actor: Actor | null): boolean {
  return hasAnyProjectRole(actor)
}

/** 층(프로젝트) 목록. null = 전체(슈퍼유저). 그 외는 역할이 있는 프로젝트(member/admin)만 — 멤버가 보는 화면(WBS·칸반)과 같은 범위. */
export function seatmapProjectIds(actor: Actor | null): string[] | null {
  if (!actor) return []
  if (actor.isSuperuser) return null
  return [...actor.projectRoles.keys()]
}
