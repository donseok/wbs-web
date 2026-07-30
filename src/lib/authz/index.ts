import { createServerClient } from '../supabase/server'
import {
  isProjectAdmin as pureIsProjectAdmin,
  isProjectMember as pureIsProjectMember,
  type Actor, type ProjectRole,
} from '../domain/authz'
import type { TeamCode } from '../domain/types'

export type { Actor, ProjectRole }

export type GuardResult = { ok: true; actor: Actor } | { ok: false; error: string }

const ERR_LOOKUP = '권한을 확인할 수 없어 중단했습니다.'
const ERR_DENIED = '권한 없음'
const ERR_ANON = '로그인 필요'
const ERR_MISSING = '대상을 찾을 수 없습니다.'

/**
 * 로그인 사용자의 권한 스냅샷을 조립한다. 비로그인은 null.
 *
 * 조회 실패는 throw 한다 — '역할 없음'으로 폴백하면 그 순간 전원이 조회 전용으로
 * 보이고(운영 마비), 반대로 관대하게 폴백하면 가드가 통째로 뚫린다. 어느 쪽도 조용해서는 안 된다.
 */
export async function getActor(): Promise<Actor | null> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return null

  const { data: mem, error: memErr } = await sb
    .from('memberships')
    .select('is_superuser, teams(code, id)')
    .eq('user_id', u.user.id)
    .maybeSingle()
  if (memErr) {
    console.error('[getActor] 멤버십 조회 실패:', memErr.message)
    throw new Error('권한 정보를 불러오지 못했습니다: ' + memErr.message)
  }

  const { data: roles, error: rolesErr } = await sb
    .from('project_roles')
    .select('project_id, role')
    .eq('user_id', u.user.id)
  if (rolesErr || !roles) {
    console.error('[getActor] 프로젝트 역할 조회 실패:', rolesErr?.message)
    throw new Error('권한 정보를 불러오지 못했습니다: ' + (rolesErr?.message ?? 'unknown'))
  }

  const team = (mem?.teams ?? null) as unknown as { code: TeamCode; id: string } | null
  const map = new Map<string, ProjectRole>()
  for (const r of roles) map.set(r.project_id as string, r.role as ProjectRole)

  return {
    userId: u.user.id,
    teamCode: team?.code ?? null,
    teamId: team?.id ?? null,
    isSuperuser: Boolean(mem?.is_superuser),
    projectRoles: map,
  }
}

/** getActor 의 throw 를 GuardResult 로 감싼다 — 액션은 예외가 아니라 결과로 응답한다. */
async function actorOrError(): Promise<GuardResult> {
  let actor: Actor | null
  try {
    actor = await getActor()
  } catch {
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!actor) return { ok: false, error: ERR_ANON }
  return { ok: true, actor }
}

/** 전역 관리(프로젝트 생성·삭제, 관리자 지정, 팀 기준정보, LLM 설정, 봇 재색인). */
export async function requireSuperuser(): Promise<GuardResult> {
  const r = await actorOrError()
  if (!r.ok) return r
  return r.actor.isSuperuser ? r : { ok: false, error: ERR_DENIED }
}

/** 해당 프로젝트의 관리자 이상. */
export async function requireProjectAdmin(projectId: string | null): Promise<GuardResult> {
  const r = await actorOrError()
  if (!r.ok) return r
  return pureIsProjectAdmin(r.actor, projectId) ? r : { ok: false, error: ERR_DENIED }
}

/** 해당 프로젝트의 멤버 이상. */
export async function requireProjectMember(projectId: string | null): Promise<GuardResult> {
  const r = await actorOrError()
  if (!r.ok) return r
  return pureIsProjectMember(r.actor, projectId) ? r : { ok: false, error: ERR_DENIED }
}

/** project_id 컬럼을 직접 가진 테이블 화이트리스트 — 임의 테이블 조회를 막는다. */
export type ProjectScopedTable =
  | 'wbs_items' | 'meetings' | 'issues' | 'minutes' | 'attendance_records'
  | 'announcements' | 'weekly_reports' | 'project_members' | 'task_dependencies'

/**
 * 대상 행에서 project_id 를 읽어 온다. projectId 를 인자로 받지 않는 액션이 판정 전에 쓴다.
 * 조회 실패는 쓰기 중단 사유다(3원칙 ②). minutes.project_id 는 nullable 이므로
 * ok:true 이면서 projectId 가 null 일 수 있다 — 호출부가 그 분기를 명시적으로 처리해야 한다.
 */
export async function resolveProjectId(
  table: ProjectScopedTable, id: string,
): Promise<{ ok: true; projectId: string | null } | { ok: false; error: string }> {
  const sb = await createServerClient()
  const { data, error } = await sb.from(table).select('project_id').eq('id', id).maybeSingle()
  if (error) {
    console.error(`[resolveProjectId] ${table} 조회 실패:`, error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!data) return { ok: false, error: ERR_MISSING }
  return { ok: true, projectId: (data.project_id as string | null) ?? null }
}
