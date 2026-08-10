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

  // 0071: 프로젝트 명단의 내 팀 — WBS 실적·첨부의 합집합 판정 재료. 조회 실패는 다른 축과
  // 동일하게 throw(fail-closed) — 명단 팀만 빠진 Actor 는 '권한 없음'으로 조용히 좁아진다.
  const { data: rosterRows, error: rosterErr } = await sb
    .from('project_members')
    .select('project_id, team_id, teams(code)')
    .eq('user_id', u.user.id)
    .not('team_id', 'is', null)
  if (rosterErr || !rosterRows) {
    console.error('[getActor] 명단 팀 조회 실패:', rosterErr?.message)
    throw new Error('권한 정보를 불러오지 못했습니다: ' + (rosterErr?.message ?? 'unknown'))
  }
  const rosterTeams = new Map<string, { teamId: string; teamCode: TeamCode }>()
  for (const r of rosterRows) {
    const t = (r.teams ?? null) as unknown as { code: TeamCode } | null
    if (r.team_id && t?.code) rosterTeams.set(r.project_id as string, { teamId: r.team_id as string, teamCode: t.code })
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
    rosterTeams,
  }
}

/**
 * 화면 계층용 — getActor 의 throw 를 삼키고 **조회 전용(null)** 으로 열화한다.
 *
 * 레이아웃·페이지에서 getActor() 를 그대로 부르면 project_roles 조회 실패 한 번이
 * 인증 영역 전체를 500 으로 만든다(0052 롤백 직후가 가장 현실적인 트리거 —
 * 테이블이 사라져 모든 요청이 PGRST205 로 실패한다). listProjects 가 이미
 * 같은 판단으로 [] 폴백을 택했고, 이 함수는 그 예방책을 권한 축에도 맞춘다.
 *
 * fail-closed 는 유지된다 — null 은 어포던스 0(조회 전용)이며, 쓰기는 서버 액션의
 * 가드가 다시 판정해 거부한다. 실패 사실은 로그로 남긴다(표시 = 로깅).
 */
export async function getActorForView(): Promise<Actor | null> {
  return (await getActorViewState()).actor
}

/**
 * getActorForView 와 같은 열화를 하되 **실패했다는 사실을 함께 돌려준다**.
 *
 * `actor: null` 하나로는 "권한이 없는 사람"과 "권한을 못 읽은 상태"가 구분되지 않는다.
 * 화면은 그 둘을 똑같이 '게스트'로 그렸고, 2026-08-05 REST 장애 때 전 사용자가 게스트 +
 * '등록된 프로젝트 없음' 으로 보였다. 로그인 실패로 오인돼 원인 추적이 늦어졌다.
 * 에러 처리 3원칙의 '표시 = 로깅' 중 로깅만 있고 표시가 없던 자리다.
 *
 * fail-closed 는 그대로다 — degraded 여도 어포던스는 0이고 쓰기는 서버 액션 가드가 다시 막는다.
 * 달라지는 건 화면이 이 상태를 **정상인 척하지 않는다**는 것뿐이다.
 */
export async function getActorViewState(): Promise<{ actor: Actor | null; degraded: boolean }> {
  try {
    return { actor: await getActor(), degraded: false }
  } catch (e) {
    // Next 의 제어 흐름 예외는 예외가 아니라 신호다 — 삼키면 정적/동적 판정과 리다이렉트가 깨진다.
    // cookies() 는 정적 렌더 중 DYNAMIC_SERVER_USAGE 를 던져 "이 라우트는 동적"임을 알린다.
    if (isFrameworkSignal(e)) throw e
    console.error('[getActorForView] 권한 조회 실패 — 조회 전용으로 열화:', e instanceof Error ? e.message : e)
    return { actor: null, degraded: true }
  }
}

/** Next 가 제어 흐름에 쓰는 예외(동적 사용·redirect·notFound·요청 취소)인지. */
function isFrameworkSignal(e: unknown): boolean {
  const digest = (e as { digest?: unknown })?.digest
  if (typeof digest === 'string'
    && (digest === 'DYNAMIC_SERVER_USAGE'
      || digest === 'NEXT_NOT_FOUND'
      || digest.startsWith('NEXT_REDIRECT')
      || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK'))) return true
  // 프리렌더 중단·요청 취소도 우리 에러가 아니다.
  return e instanceof Error && (e.name === 'DynamicServerError' || e.name === 'AbortError')
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
