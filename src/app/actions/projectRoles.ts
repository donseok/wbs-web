'use server'
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin, requireSuperuser } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { listAllAuthUsers } from '@/lib/data/accounts'
import type { AccountRole } from '@/lib/domain/accounts'

export interface ProjectRoleRow {
  /** 계정 없는 명단 전용(legacy) 행은 null — 권한 셀렉트 대신 '계정 없음'을 보여준다. */
  userId: string | null
  email: string | null
  name: string | null
  /** 프로젝트 팀 — 명단(project_members)의 팀. 프로젝트를 위해 구성하는 팀이다. */
  teamCode: string | null
  /** 실제 소속팀 — 전역 memberships 팀. 프로젝트 팀 미지정일 때 참고 표시용. */
  orgTeamCode: string | null
  role: AccountRole
  isSuperuser: boolean
  /** 명단 행 id — 명단 필드(팀·구분·직함) 편집과 삭제에 쓴다. 명단 미등록이면 null. */
  memberId: string | null
  rosterRole: 'admin' | 'contributor' | null
  title: string | null
  roleLabel: string | null
}

export async function listProjectRoles(
  projectId: string,
): Promise<{ ok: true; rows: ProjectRoleRow[] } | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()

  const { data: mems, error: memErr } = await admin
    .from('memberships').select('user_id, is_superuser, teams(code)')
  // 조회 실패를 빈 목록으로 폴백하면 이 화면이 곧 '아무도 권한이 없다'는 잘못된 권한 정보가 되고,
  // 관리자가 그걸 근거로 권한을 다시 부여하는 쓰기까지 유발한다.
  if (memErr || !mems) return { ok: false, error: '권한 정보를 불러오지 못했습니다: ' + (memErr?.message ?? 'unknown') }

  const { data: roles, error: roleErr } = await admin
    .from('project_roles').select('user_id, role').eq('project_id', projectId)
  if (roleErr || !roles) return { ok: false, error: '프로젝트 역할을 불러오지 못했습니다: ' + (roleErr?.message ?? 'unknown') }

  // 명단 정보를 같은 행에 싣는다(2026-08-20 화면 통합 2단계) — 팀·구분·직함을
  // 권한 표에서 직접 편집하고, 계정 없는 legacy 명단 행도 이 목록이 유일한 노출처다.
  const { data: roster, error: rosterErr } = await admin
    .from('project_members')
    .select('id, user_id, email, name, role, title, role_label, teams(code)')
    .eq('project_id', projectId)
  if (rosterErr || !roster) return { ok: false, error: '명단을 불러오지 못했습니다: ' + (rosterErr?.message ?? 'unknown') }

  let users
  try {
    users = await listAllAuthUsers(admin)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '계정 목록을 불러오지 못했습니다.' }
  }
  const userBy = new Map(users.map(u => [u.id, u]))

  type RosterRow = {
    id: string; user_id: string | null; email: string | null; name: string
    role: 'admin' | 'contributor'; title: string | null; role_label: string | null
    teams: { code: string } | null
  }
  const rosterRows = roster as unknown as RosterRow[]
  const rosterByUser = new Map(rosterRows.filter(r => r.user_id).map(r => [r.user_id as string, r]))
  const rosterByEmail = new Map(rosterRows.filter(r => r.email).map(r => [r.email as string, r]))

  const roleBy = new Map(roles.map(r => [r.user_id as string, r.role as 'admin' | 'member']))
  const rows: ProjectRoleRow[] = []
  const seenMemberIds = new Set<string>()
  for (const m of mems) {
    const u = userBy.get(m.user_id as string)
    if (!u) continue // auth 계정이 지워진 잔존 멤버십 — 화면 대상 아님
    const team = m.teams as unknown as { code: string } | null
    const pm = rosterByUser.get(m.user_id as string)
      ?? (u.email ? rosterByEmail.get(u.email.trim().toLowerCase()) : undefined)
    if (pm) seenMemberIds.add(pm.id)
    rows.push({
      userId: m.user_id as string,
      email: u.email,
      name: pm?.name ?? u.fullName,
      teamCode: pm?.teams?.code ?? null,
      orgTeamCode: team?.code ?? null,
      role: roleBy.get(m.user_id as string) ?? 'viewer',
      isSuperuser: Boolean(m.is_superuser),
      memberId: pm?.id ?? null,
      rosterRole: pm?.role ?? null,
      title: pm?.title ?? null,
      roleLabel: pm?.role_label ?? null,
    })
  }
  // 계정과 이어지지 않은 명단 행(legacy 외부 인력) — 숨기면 이 사람들이 화면에서 사라진다.
  for (const pm of rosterRows) {
    if (seenMemberIds.has(pm.id)) continue
    rows.push({
      userId: null,
      email: pm.email,
      name: pm.name,
      teamCode: pm.teams?.code ?? null,
      orgTeamCode: null,
      role: 'viewer',
      isSuperuser: false,
      memberId: pm.id,
      rosterRole: pm.role,
      title: pm.title,
      roleLabel: pm.role_label,
    })
  }
  return { ok: true, rows }
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * 권한을 받은 계정을 팀 구성 명단(project_members)에도 올린다 — 권한과 명단이
 * 별개 테이블이라 "권한 줬는데 팀 구성에 안 보인다"는 혼란이 반복됐다(2026-08-20).
 * 이미 명단에 있으면 조용히 성공(멱등). 이름은 0070 정본(identities)을 계정
 * 표시명보다 우선해 이메일 정합 충돌을 피한다. user_id 연결은 0019 트리거도
 * 보강하지만 여기서 직접 넣어 의존을 줄인다.
 */
async function addAccountToRoster(
  admin: AdminClient, projectId: string, userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: existing, error: exErr } = await admin
    .from('project_members').select('id')
    .eq('project_id', projectId).eq('user_id', userId).maybeSingle()
  if (exErr) return { ok: false, error: '명단 조회에 실패해 추가를 중단했습니다: ' + exErr.message }
  if (existing) return { ok: true }

  const { data: got, error: userErr } = await admin.auth.admin.getUserById(userId)
  if (userErr || !got?.user?.email) {
    return { ok: false, error: '계정 정보를 확인할 수 없어 명단 추가를 중단했습니다.' }
  }
  const email = got.user.email.trim().toLowerCase()
  const fullName = (got.user.user_metadata?.full_name as string | undefined)?.trim() || null

  // 0070: 같은 이메일은 전 프로젝트에서 같은 이름이어야 한다 — 정본이 있으면 그 이름을 쓴다.
  const { data: identity, error: idErr } = await admin
    .from('project_member_identities').select('name').eq('email', email).maybeSingle()
  if (idErr) return { ok: false, error: '멤버 기준정보를 확인할 수 없어 명단 추가를 중단했습니다.' }
  const name = identity?.name ?? fullName ?? email

  // 소속 팀: 전역 memberships 의 팀 코드를 프로젝트 스코프 팀으로 재해석(0071 규칙과 동일).
  let teamId: string | null = null
  const { data: mem } = await admin
    .from('memberships').select('teams(code)').eq('user_id', userId).maybeSingle()
  const teamCode = (mem?.teams as unknown as { code: string } | null)?.code ?? null
  if (teamCode) {
    const { data: teams } = await admin.from('teams')
      .select('id, project_id').eq('code', teamCode)
      .or(`project_id.eq.${projectId},project_id.is.null`)
    const rows = (teams ?? []) as Array<{ id: string; project_id: string | null }>
    teamId = (rows.find(r => r.project_id !== null) ?? rows[0])?.id ?? null
  }

  const { error: insErr } = await admin.from('project_members').insert({
    project_id: projectId, name, email, team_id: teamId, role: 'contributor', user_id: userId,
  })
  if (insErr) {
    if (insErr.code === '23505') return { ok: true } // 동시 쓰기로 이미 등록됨 — 멱등 성공
    return { ok: false, error: '명단 추가에 실패했습니다: ' + insErr.message }
  }
  revalidatePath(`/p/${projectId}/members`)
  return { ok: true }
}

/**
 * 계정 보유자의 명단 행을 보장하고 id 를 돌려준다 — 자동 동기화(2026-08-20) 이전에
 * 권한을 받은 계정은 명단 행이 없어 명단 필드를 편집할 수 없었다. 편집 진입 시
 * 여기로 행을 만들고 updateMember 로 이어간다.
 */
export async function ensureRosterRow(
  projectId: string, userId: string,
): Promise<{ ok: true; memberId: string } | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()

  const ensured = await addAccountToRoster(admin, projectId, userId)
  if (!ensured.ok) return { ok: false, error: ensured.error ?? '명단 행을 만들지 못했습니다.' }

  const { data: byUser, error: findErr } = await admin
    .from('project_members').select('id')
    .eq('project_id', projectId).eq('user_id', userId).maybeSingle()
  if (findErr) return { ok: false, error: '명단 행 조회에 실패했습니다: ' + findErr.message }
  if (byUser) return { ok: true, memberId: byUser.id as string }

  // 이메일로만 걸린 미연결 행(0019 이전 데이터) — user_id 대신 이메일로 찾는다.
  const { data: got } = await admin.auth.admin.getUserById(userId)
  const email = got?.user?.email?.trim().toLowerCase()
  if (email) {
    const { data: byEmail } = await admin
      .from('project_members').select('id')
      .eq('project_id', projectId).eq('email', email).maybeSingle()
    if (byEmail) return { ok: true, memberId: byEmail.id as string }
  }
  return { ok: false, error: '명단 행을 찾지 못했습니다. 새로고침 후 다시 시도하세요.' }
}

/** 관리자 슬롯은 슈퍼유저만 조작한다 — 관리자가 관리자를 늘리면 지금의 28명 상황이 재현된다. */
export async function setProjectRole(
  projectId: string, userId: string, role: AccountRole,
  opts?: { addToRoster?: boolean },
): Promise<{ ok: boolean; error?: string; rosterError?: string }> {
  const g = role === 'admin' ? await requireSuperuser() : await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const admin = createAdminClient()

  // 관리자를 강등할 때도 슈퍼유저 권한이 필요하다. 현재 역할을 먼저 읽는다.
  const { data: cur, error: curErr } = await admin
    .from('project_roles').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle()
  if (curErr) {
    console.error('[setProjectRole] 현재 역할 조회 실패:', curErr.message)
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  if (cur?.role === 'admin' && !g.actor.isSuperuser) return { ok: false, error: '권한 없음' }

  if (role === 'viewer') {
    const { error } = await admin.from('project_roles').delete()
      .eq('project_id', projectId).eq('user_id', userId)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await admin.from('project_roles').upsert(
      { project_id: projectId, user_id: userId, role, granted_by: g.actor.userId },
      { onConflict: 'project_id,user_id' },
    )
    if (error) return { ok: false, error: error.message }
  }
  revalidatePath(`/p/${projectId}/settings`)
  revalidatePath('/admin/accounts')

  // 권한을 받은 사람은 팀 구성에도 항상 보인다(기본 동기화, 2026-08-20) —
  // opts.addToRoster === false 로만 끌 수 있다. 명단 추가는 권한 부여 뒤의
  // 부가 작업이라 실패해도 권한 결과는 유지하고 rosterError 로 드러낸다(조용한 실패 금지).
  if (role !== 'viewer' && opts?.addToRoster !== false) {
    const roster = await addAccountToRoster(admin, projectId, userId)
    if (!roster.ok) return { ok: true, rosterError: roster.error }
  }
  return { ok: true }
}

export async function setSuperuser(userId: string, value: boolean): Promise<{ ok: boolean; error?: string }> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()

  // 마지막 슈퍼유저 강등 방지 — 전원이 전역 관리에서 잠기면 복구 경로가 DB 직접 수정뿐이다.
  // 조회 실패를 '슈퍼유저 0명'으로 폴백하면 가드가 통째로 무력화되므로 실패는 곧 거부(fail-closed).
  if (!value) {
    const { data: sus, error: susErr } = await admin
      .from('memberships').select('user_id').eq('is_superuser', true)
    if (susErr || !sus) {
      console.error('[setSuperuser] 슈퍼유저 목록 조회 실패:', susErr?.message)
      return { ok: false, error: '슈퍼유저 목록을 확인할 수 없어 변경을 중단했습니다. 잠시 후 다시 시도하세요.' }
    }
    const ids = sus.map(r => r.user_id as string)
    if (ids.includes(userId) && ids.length <= 1) {
      return { ok: false, error: '마지막 슈퍼유저는 해제할 수 없습니다. 다른 슈퍼유저를 먼저 지정하세요.' }
    }
  }

  const { error } = await admin.from('memberships').update({ is_superuser: value }).eq('user_id', userId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/accounts')
  return { ok: true }
}
