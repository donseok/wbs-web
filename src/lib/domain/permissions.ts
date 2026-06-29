import type { ComputedItem, Membership } from './types'

/**
 * 실적% 편집 권한 (순수). UI 어포던스 게이팅과 서버 재검증이 같은 규칙을 쓰도록 공유한다.
 * 규칙: activity(말단) 항목만 + PMO는 전체, 팀 편집자는 자기 팀이 담당(primary/support)인 항목만.
 * 상위(롤업) 항목과 비-activity는 항상 false (서버 updateActual도 level!=='activity' 거부).
 */
export function canEditActual(item: ComputedItem, membership: Membership | null): boolean {
  if (item.level !== 'activity') return false
  if (item.children.length > 0) return false
  if (!membership) return false
  if (membership.role === 'pmo_admin') return true
  return item.owners.some(o => o.team === membership.teamCode)
}

/** 가중치 편집 권한 — 구조/롤업 영향이라 PMO만. */
export function canEditWeight(membership: Membership | null): boolean {
  return membership?.role === 'pmo_admin'
}
