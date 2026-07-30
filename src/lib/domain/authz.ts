// 권한 판정의 순수 계층 — IO·부수효과 없음. 서버 액션과 UI 어포던스가 같은 규칙을 쓰도록 공유한다.
// 설계 정본: docs/superpowers/specs/2026-07-29-authz-three-tier-design.md
import type { TeamCode } from './types'

/** project_roles.role 값. '조회 전용'은 값이 아니라 행의 부재로 표현한다. */
export type ProjectRole = 'admin' | 'member'

/** 특정 프로젝트에서의 유효 역할. viewer = 프로젝트 역할이 없는 로그인 사용자. */
export type EffectiveRole = 'superuser' | 'admin' | 'member' | 'viewer'

/** 로그인 사용자의 권한 스냅샷. getActor() 가 조립한다. */
export interface Actor {
  userId: string
  teamCode: TeamCode | null
  teamId: string | null
  isSuperuser: boolean
  /** projectId → role. 없는 키 = 그 프로젝트에서는 조회 전용. */
  projectRoles: ReadonlyMap<string, ProjectRole>
}

/**
 * 이 사용자가 이 프로젝트에서 갖는 유효 역할. 비로그인은 null.
 *
 * projectId 가 null 인 경우(프로젝트 미지정 회의록 등)는 프로젝트로 판정할 수 없으므로
 * 슈퍼유저 외 전원을 viewer 로 본다 — fail-closed. 호출부는 이 경우 '작성자 본인'
 * 같은 별도 조건과 OR 로 결합해야 한다.
 */
export function roleIn(actor: Actor | null, projectId: string | null): EffectiveRole | null {
  if (!actor) return null
  if (actor.isSuperuser) return 'superuser'
  if (!projectId) return 'viewer'
  return actor.projectRoles.get(projectId) ?? 'viewer'
}

/**
 * RSC 경계로 내릴 수 있는 직렬화 가능한 스냅샷 — Actor 의 Map 은 클라이언트 props 로
 * 직렬화되지 않는다. 프로젝트 화면은 자기 프로젝트 하나의 역할만 알면 되므로
 * 그 역할 하나를 평탄화해 내리고, 클라이언트에서 actorFromView 로 복원한다.
 */
export interface ProjectActorView {
  userId: string
  teamCode: TeamCode | null
  teamId: string | null
  isSuperuser: boolean
  /** 이 프로젝트에서의 역할. null = 조회 전용. */
  projectRole: ProjectRole | null
}

export function toProjectActorView(actor: Actor | null, projectId: string): ProjectActorView | null {
  if (!actor) return null
  return {
    userId: actor.userId,
    teamCode: actor.teamCode,
    teamId: actor.teamId,
    isSuperuser: actor.isSuperuser,
    projectRole: actor.projectRoles.get(projectId) ?? null,
  }
}

export function actorFromView(view: ProjectActorView | null, projectId: string): Actor | null {
  if (!view) return null
  return {
    userId: view.userId,
    teamCode: view.teamCode,
    teamId: view.teamId,
    isSuperuser: view.isSuperuser,
    projectRoles: new Map(view.projectRole ? [[projectId, view.projectRole]] : []),
  }
}

/** 관리자 이상(슈퍼유저 포함). 등록·수정·삭제 전권. */
export function isProjectAdmin(actor: Actor | null, projectId: string | null): boolean {
  const r = roleIn(actor, projectId)
  return r === 'superuser' || r === 'admin'
}

/** 멤버 이상. 회의·회의록·주간보고·이슈·근태·첨부 쓰기의 최소 자격. */
export function isProjectMember(actor: Actor | null, projectId: string | null): boolean {
  const r = roleIn(actor, projectId)
  return r === 'superuser' || r === 'admin' || r === 'member'
}

/**
 * 전역 성격 리소스(회의록 폴더 등 프로젝트에 속하지 않는 것)용 — 어느 프로젝트든
 * 관리자면 통과. DB 의 app_role() shim 이 'pmo_admin' 을 돌려주는 조건과 같은 의미라
 * 서버 액션과 RLS 판정이 갈라지지 않는다.
 */
export function isAnyProjectAdmin(actor: Actor | null): boolean {
  if (!actor) return false
  if (actor.isSuperuser) return true
  for (const r of actor.projectRoles.values()) if (r === 'admin') return true
  return false
}

/**
 * 어느 프로젝트든 역할이 있으면 true — 조회 전용 계정 차단용.
 * DB 의 `app_role() is not null` 과 같은 의미. 프로젝트 미지정 회의록 생성처럼
 * 특정 프로젝트로 판정할 수 없는 쓰기의 최소 자격으로 쓴다.
 */
export function hasAnyProjectRole(actor: Actor | null): boolean {
  if (!actor) return false
  return actor.isSuperuser || actor.projectRoles.size > 0
}
