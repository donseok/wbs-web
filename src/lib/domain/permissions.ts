import type { ComputedItem } from './types'
import { isProjectAdmin, isProjectMember, type Actor } from './authz'

/** '내 팀' 후보 코드 — 계정 전역 팀(memberships) ∪ 그 프로젝트 명단 팀(0071 RLS와 동일 합집합). */
export function actorTeamCodesFor(actor: Actor, projectId: string): string[] {
  const out: string[] = []
  if (actor.teamCode) out.push(actor.teamCode)
  const roster = actor.rosterTeams.get(projectId)
  if (roster && roster.teamCode !== actor.teamCode) out.push(roster.teamCode)
  return out
}

/** '내 팀' 후보 id — 서버 액션의 item_owners 재검증용(위와 같은 합집합). */
export function actorTeamIdsFor(actor: Actor, projectId: string): string[] {
  const out: string[] = []
  if (actor.teamId) out.push(actor.teamId)
  const roster = actor.rosterTeams.get(projectId)
  if (roster && roster.teamId !== actor.teamId) out.push(roster.teamId)
  return out
}

/**
 * 실적% 편집 권한 (순수). UI 어포던스 게이팅과 서버 재검증이 같은 규칙을 쓰도록 공유한다.
 * 규칙: 말단(자식 없는) 항목만 + 관리자 이상은 전체, 멤버는 자기 팀이 담당(primary/support)인 항목만.
 *
 * 말단 판정 기준은 level 이 아니라 자식 유무다 — 롤업(computeNode)이 children.length===0 인
 * 노드의 actualPct 를 그대로 rolledActualPct 로 쓰기 때문. level==='activity' 로 게이팅하면
 * 자식 없는 Task(예: "1-3. 프로젝트 착수 보고회")가 롤업엔 0% 로 반영되는데 입력은 막히는
 * 모순이 생긴다. 상위(롤업) 항목은 항상 false — 서버 updateActual 도 자식이 있으면 거부한다.
 */
export function canEditActual(item: ComputedItem, actor: Actor | null, projectId: string): boolean {
  if (item.children.length > 0) return false
  if (isProjectAdmin(actor, projectId)) return true
  if (!isProjectMember(actor, projectId)) return false
  const mine = actorTeamCodesFor(actor!, projectId)
  return item.owners.some(o => mine.includes(o.team))
}

/** 가중치 편집 권한 — 구조/롤업 영향이라 관리자 이상만. */
export function canEditWeight(actor: Actor | null, projectId: string): boolean {
  return isProjectAdmin(actor, projectId)
}

/** 산출물 텍스트 편집 권한 — 관리자 이상은 전체. 멤버는 실적%와 동일 조건(말단+자기 담당)만.
 *  말단 제약은 프로덕션 RLS(team_update_actual: wbs_is_leaf + 담당) 때문 — 비말단은 UPDATE 정책이
 *  없어 조용한 no-op 이 되므로 어포던스를 열지 않는다. 컬럼 가드는 0028 이 deliverable 을 허용한다. */
export function canEditDeliverable(item: ComputedItem, actor: Actor | null, projectId: string): boolean {
  if (isProjectAdmin(actor, projectId)) return true
  if (item.children.length > 0) return false
  if (!isProjectMember(actor, projectId)) return false
  const mine = actorTeamCodesFor(actor!, projectId)
  return item.owners.some(o => mine.includes(o.team))
}
