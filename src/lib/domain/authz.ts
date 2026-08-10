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
  /** projectId → 그 프로젝트 명단(project_members)의 내 팀. 없는 키 = 명단 팀 없음.
   *  WBS 실적·첨부의 '내 팀' 판정은 teamCode/teamId 와 이 값의 합집합이다(0071 RLS와 동일). */
  rosterTeams: ReadonlyMap<string, { teamId: string; teamCode: TeamCode }>
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
 * 옛 컴포넌트 계약('pmo_admin' | 'team_editor' | null)에 새 2축을 얹는 표시용 shim —
 * DB 의 app_role() 과 같은 의미다. 클라이언트 컴포넌트 다수가 아직 이 문자열로
 * 어포던스를 게이팅하므로, 페이지가 각자 ternary 를 하드코딩하는 대신 이 한 곳을 쓴다.
 * 서버 액션은 이 값을 절대 판정에 쓰지 않는다(가드 3종이 재검증).
 *
 * projectId 를 주면 그 프로젝트 스코프로, 생략하면 전역(어느 프로젝트든) 기준으로 본다.
 */
export function effectiveLegacyRole(
  actor: Actor | null, projectId?: string | null,
): 'pmo_admin' | 'team_editor' | null {
  if (!actor) return null
  if (projectId != null) {
    if (isProjectAdmin(actor, projectId)) return 'pmo_admin'
    if (isProjectMember(actor, projectId)) return 'team_editor'
    return null
  }
  if (isAnyProjectAdmin(actor)) return 'pmo_admin'
  if (hasAnyProjectRole(actor)) return 'team_editor'
  return null
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
  /** 이 프로젝트 명단의 내 팀(0071 합집합 판정용). null = 명단 팀 없음. */
  rosterTeamId: string | null
  rosterTeamCode: TeamCode | null
}

export function toProjectActorView(actor: Actor | null, projectId: string): ProjectActorView | null {
  if (!actor) return null
  return {
    userId: actor.userId,
    teamCode: actor.teamCode,
    teamId: actor.teamId,
    isSuperuser: actor.isSuperuser,
    projectRole: actor.projectRoles.get(projectId) ?? null,
    rosterTeamId: actor.rosterTeams.get(projectId)?.teamId ?? null,
    rosterTeamCode: actor.rosterTeams.get(projectId)?.teamCode ?? null,
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
    rosterTeams: new Map(view.rosterTeamId && view.rosterTeamCode
      ? [[projectId, { teamId: view.rosterTeamId, teamCode: view.rosterTeamCode }]] : []),
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
 * 비공개 프로젝트 UI 숨김 판정 (0070). 보안 경계가 아니라 노출 억제다 —
 * RLS 는 개방 그대로이고 URL 직접 접근도 막지 않는다(설계 2026-08-10).
 * is_private 이 없거나 null 이면 공개로 본다(컬럼 미적용·구 스냅샷 호환).
 * 비공개는 역할(admin/member) 보유자와 슈퍼유저에게만 보이고, 비로그인·viewer 는 숨김.
 */
export function canSeeProject(
  actor: Actor | null,
  project: { id: string; is_private?: boolean | null },
): boolean {
  if (!project.is_private) return true
  if (!actor) return false
  return actor.isSuperuser || actor.projectRoles.has(project.id)
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
 * 관리자 이상인 프로젝트 id 목록 — 항목마다 프로젝트가 다른 전역 목록 화면(내 회의, 회의록
 * 보관함)이 항목별로 판정할 수 있게 RSC 경계로 내리는 직렬화 가능 형태.
 *
 * 슈퍼유저는 '모든 프로젝트의 관리자'라 이 목록으로는 표현되지 않는다 — 호출부는
 * isSuperuser 를 함께 받아 OR 로 결합해야 isProjectAdmin 과 같은 판정이 된다.
 * 미지정(projectId null) 항목은 목록에 걸릴 수 없으므로 자동으로 '슈퍼유저만'이 된다.
 */
export function adminProjectIds(actor: Actor | null): string[] {
  if (!actor) return []
  const out: string[] = []
  for (const [id, role] of actor.projectRoles) if (role === 'admin') out.push(id)
  return out
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
