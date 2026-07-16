import type { ComputedItem, Membership } from './types'

/**
 * 실적% 편집 권한 (순수). UI 어포던스 게이팅과 서버 재검증이 같은 규칙을 쓰도록 공유한다.
 * 규칙: 말단(자식 없는) 항목만 + PMO는 전체, 팀 편집자는 자기 팀이 담당(primary/support)인 항목만.
 *
 * 말단 판정 기준은 level 이 아니라 자식 유무다 — 롤업(computeNode)이 children.length===0 인
 * 노드의 actualPct 를 그대로 rolledActualPct 로 쓰기 때문. level==='activity' 로 게이팅하면
 * 자식 없는 Task(예: "1-3. 프로젝트 착수 보고회")가 롤업엔 0% 로 반영되는데 입력은 막히는
 * 모순이 생긴다. 상위(롤업) 항목은 항상 false — 서버 updateActual 도 자식이 있으면 거부한다.
 */
export function canEditActual(item: ComputedItem, membership: Membership | null): boolean {
  if (item.children.length > 0) return false
  if (!membership) return false
  if (membership.role === 'pmo_admin') return true
  return item.owners.some(o => o.team === membership.teamCode)
}

/** 가중치 편집 권한 — 구조/롤업 영향이라 PMO만. */
export function canEditWeight(membership: Membership | null): boolean {
  return membership?.role === 'pmo_admin'
}

/** 산출물 텍스트 편집 권한 — PMO 전체. 팀 편집자는 실적%와 동일 조건(말단+자기 담당)만.
 *  말단 제약은 프로덕션 RLS(team_update_actual: wbs_is_leaf + 담당) 때문 — 비말단은 UPDATE 정책이
 *  없어 조용한 no-op 이 되므로 어포던스를 열지 않는다. 컬럼 가드는 0028 이 deliverable 을 허용한다. */
export function canEditDeliverable(item: ComputedItem, membership: Membership | null): boolean {
  if (!membership) return false
  if (membership.role === 'pmo_admin') return true
  if (item.children.length > 0) return false
  return item.owners.some(o => o.team === membership.teamCode)
}
