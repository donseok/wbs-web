'use server'
import { revalidatePath } from 'next/cache'
import { requireSuperuser } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { listAllAuthUsers } from '@/lib/data/accounts'
import { activeTeamCodesSync } from '@/lib/teams/master'
import { isValidEmail } from '@/lib/domain/validate'
import { compareKoreanName } from '@/lib/domain/nameSort'
import {
  isValidPassword, isTeamCode, isAccountRole, parseBulkAccounts, type AccountRole,
} from '@/lib/domain/accounts'
import type { TeamCode } from '@/lib/domain/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface AccountRow {
  id: string
  email: string
  name: string | null
  teamCode: TeamCode | null
  /** 조회 대상 프로젝트에서의 역할. 'viewer' = project_roles 행 없음. */
  role: AccountRole
  isSuperuser: boolean
  createdAt: string
}

export interface AccountInput {
  email: string
  password: string
  teamCode: TeamCode
  /** 이 프로젝트에 부여할 역할. 'viewer' 는 역할 행을 만들지 않는다(조회 전용 시작 — 설계 D7). */
  role: AccountRole
  projectId: string
  name: string | null
}

export interface AccountActionResult {
  ok: boolean
  error?: string
}

export interface BulkResultRow {
  lineNo: number
  email: string
  ok: boolean
  error?: string
}

/** 계정은 전역 축(스펙 §5) — 프로젝트 팀은 절대 잡지 않는다. */
async function resolveTeamId(admin: AdminClient, teamCode: TeamCode): Promise<string | null> {
  const { data, error } = await admin.from('teams').select('id').eq('code', teamCode).is('project_id', null).single()
  // 쓰기 직전의 채번 조회 — null 을 돌려주면 호출부가 저장을 중단(ok:false)하므로 실패는 이미 fail-closed다.
  // 다만 '팀이 없음'과 '조회가 깨짐'이 화면에서 같은 문구로 보이므로 원인은 로그로 남긴다.
  if (error) console.error('[resolveTeamId] 조회 실패:', error.message)
  return (data?.id as string | undefined) ?? null
}

/** 게이트/클라이언트 생성 이후 단건 생성 — bulk 에서 재사용(게이트 재검사 없음). */
async function createOne(admin: AdminClient, input: AccountInput, grantedBy: string): Promise<AccountActionResult> {
  if (!isValidEmail(input.email)) return { ok: false, error: '올바른 이메일 형식이 아닙니다.' }
  if (!isValidPassword(input.password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  if (!isTeamCode(input.teamCode, activeTeamCodesSync())) return { ok: false, error: '알 수 없는 팀 코드' }
  if (!isAccountRole(input.role)) return { ok: false, error: '알 수 없는 권한' }

  const teamId = await resolveTeamId(admin, input.teamCode)
  if (!teamId) return { ok: false, error: '팀을 찾을 수 없습니다.' }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password,
    email_confirm: true, // SMTP 없이 즉시 로그인 가능하도록 확인 처리
    user_metadata: input.name ? { full_name: input.name } : {},
  })
  if (createErr || !created?.user) return { ok: false, error: createErr?.message ?? '계정 생성 실패' }

  // memberships.role 은 deprecated(0054) — 판정에 쓰지 않지만 not null 이라 옛 값 하나를 채운다.
  // 실제 권한은 아래 project_roles 가 결정한다.
  const { error: memErr } = await admin.from('memberships').insert({
    user_id: created.user.id, team_id: teamId, role: 'team_editor',
  })
  if (memErr) {
    // 보상 롤백 — 멤버십 없는 유령 계정 방지
    // 롤백까지 실패하면 유령 계정이 남고, 관리자가 같은 이메일로 재시도할 때 '이미 존재'로만 튕긴다.
    // 이 경우 ok:false 는 그대로 두되(계정 생성은 실패로 보고해야 맞다) 수동 정리를 위해 흔적을 남긴다.
    const { error: rollbackErr } = await admin.auth.admin.deleteUser(created.user.id)
    if (rollbackErr) {
      console.error(`[createAccount] 보상 롤백 실패(유령 계정 잔존 user_id=${created.user.id}):`, rollbackErr.message)
    }
    return { ok: false, error: '팀/권한 저장 실패: ' + memErr.message }
  }

  // 프로젝트 역할 — viewer 는 행을 만들지 않는다(행의 부재 = 조회 전용).
  if (input.role !== 'viewer') {
    const { error: roleErr } = await admin.from('project_roles').insert({
      project_id: input.projectId, user_id: created.user.id, role: input.role, granted_by: grantedBy,
    })
    if (roleErr) {
      // 권한 없는 계정을 '만들어졌다'고 보고하면 관리자는 역할이 있다고 믿는다 — 전체를 되돌린다.
      const { error: rollbackErr } = await admin.auth.admin.deleteUser(created.user.id)
      if (rollbackErr) {
        console.error(`[createAccount] 역할 실패 후 롤백 실패(user_id=${created.user.id}):`, rollbackErr.message)
      }
      return { ok: false, error: '프로젝트 역할 저장 실패: ' + roleErr.message }
    }
  }

  // 같은 이메일의 프로젝트 멤버 행에 새 계정을 잇는다(0019 의 user_id FK).
  // auth.users 트리거 대신 여기서 한다 — 실패하는 트리거는 GoTrue 회원가입 전체를 막는다.
  // 실패해도 계정 생성은 성공으로 둔다: 멤버 보드의 '계정 미연결' 배지가 드러내 준다.
  const { error: linkErr } = await admin
    .from('project_members')
    .update({ user_id: created.user.id })
    .is('user_id', null)
    .eq('email', input.email.trim().toLowerCase())
  if (linkErr) console.error('[createAccount] 멤버 행 연결 실패:', linkErr.message)

  return { ok: true }
}

export async function createAccount(input: AccountInput): Promise<AccountActionResult> {
  // 계정 관리는 슈퍼유저 전용(2026-08-20 결정 — 종전 설계 D7 '관리자도 생성 가능'을 대체).
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const res = await createOne(admin, input, g.actor.userId)
  if (res.ok) revalidatePath('/admin/accounts')
  return res
}

export async function bulkCreateAccounts(
  text: string, projectId: string,
): Promise<{ ok: boolean; error?: string; results: BulkResultRow[] }> {
  // 계정 관리는 슈퍼유저 전용(2026-08-20) — 종전 행 단위 관리자 슬롯 검사는 게이트로 흡수됐다.
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error, results: [] }
  const admin = createAdminClient()
  const lines = parseBulkAccounts(text, activeTeamCodesSync())
  if (lines.length === 0) return { ok: false, error: '처리할 행이 없습니다.', results: [] }

  const results: BulkResultRow[] = []
  for (const line of lines) {
    if (!line.ok) {
      results.push({ lineNo: line.lineNo, email: line.email ?? line.raw, ok: false, error: line.error })
      continue
    }
    const res = await createOne(admin, {
      email: line.email!, password: line.password!, teamCode: line.teamCode!,
      role: line.role!, projectId, name: line.name ?? null,
    }, g.actor.userId)
    results.push({ lineNo: line.lineNo, email: line.email!, ok: res.ok, error: res.error })
  }
  revalidatePath('/admin/accounts')
  return { ok: true, results }
}

/**
 * 대상 계정이 나보다 높거나 같은 등급이면 슈퍼유저만 손댈 수 있다.
 *
 * 이 검사가 없으면 어느 한 프로젝트의 관리자가 **슈퍼유저 계정의 비밀번호를 초기화해
 * 그 계정으로 로그인**할 수 있고, setProjectRole·createAccount 가 지키는
 * '관리자 슬롯은 슈퍼유저만' 불변식이 통째로 우회된다. 등급 경계는 계정 조작
 * 경로에서도 지켜져야 한다.
 *
 * 조회 실패는 거부다 — '슈퍼유저가 아니다'로 폴백하면 가드가 그 순간 사라진다.
 */
async function assertCanTouchAccount(
  admin: AdminClient, targetUserId: string, callerIsSuperuser: boolean,
): Promise<AccountActionResult> {
  if (callerIsSuperuser) return { ok: true }

  const { data: mem, error: memErr } = await admin
    .from('memberships').select('is_superuser').eq('user_id', targetUserId).maybeSingle()
  if (memErr) {
    console.error('[assertCanTouchAccount] 대상 등급 조회 실패:', memErr.message)
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  if (mem?.is_superuser) {
    return { ok: false, error: '슈퍼유저 계정은 슈퍼유저만 변경할 수 있습니다.' }
  }

  // 관리자끼리도 서로의 계정을 만지지 못하게 한다 — 동급 탈취로 권한 경계가 흐려진다.
  const { data: roles, error: roleErr } = await admin
    .from('project_roles').select('project_id').eq('user_id', targetUserId).eq('role', 'admin')
  if (roleErr || !roles) {
    console.error('[assertCanTouchAccount] 대상 역할 조회 실패:', roleErr?.message)
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  if (roles.length > 0) {
    return { ok: false, error: '관리자 계정은 슈퍼유저만 변경할 수 있습니다.' }
  }
  return { ok: true }
}

/** 팀 변경 — 팀은 프로젝트 역할과 별개의 전역 속성(WBS 담당 판정용). role 컬럼은 건드리지 않는다. */
export async function updateAccountTeam(userId: string, teamCode: string): Promise<AccountActionResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  if (!isTeamCode(teamCode, activeTeamCodesSync())) return { ok: false, error: '알 수 없는 팀 코드' }
  const admin = createAdminClient()
  // 게이트가 슈퍼유저 전용이 된 뒤에도 등급 경계 검사는 남긴다 — 정책이 다시 느슨해져도 안전하게.
  const allowed = await assertCanTouchAccount(admin, userId, g.actor.isSuperuser)
  if (!allowed.ok) return allowed
  const teamId = await resolveTeamId(admin, teamCode)
  if (!teamId) return { ok: false, error: '팀을 찾을 수 없습니다.' }
  const { data: upd, error } = await admin
    .from('memberships').update({ team_id: teamId }).eq('user_id', userId).select('user_id')
  if (error) return { ok: false, error: error.message }
  if (!upd || upd.length === 0) {
    // 멤버십이 없는 계정 — role 은 deprecated not null 이라 옛 값 하나를 채워 삽입한다.
    const { error: insErr } = await admin.from('memberships')
      .insert({ user_id: userId, team_id: teamId, role: 'team_editor' })
    if (insErr) return { ok: false, error: insErr.message }
  }
  revalidatePath('/admin/accounts')
  return { ok: true }
}

export async function resetPassword(userId: string, password: string): Promise<AccountActionResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  if (!isValidPassword(password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  const admin = createAdminClient()
  // 비밀번호 초기화는 그 계정으로 로그인할 수 있게 만드는 조작이다 —
  // 게이트가 슈퍼유저 전용이 된 뒤에도 등급 경계 검사는 남긴다.
  const allowed = await assertCanTouchAccount(admin, userId, g.actor.isSuperuser)
  if (!allowed.ok) return allowed
  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * 계정 목록. **권한 거부를 빈 배열로 돌려주지 않는다** — 이 화면은 그 자체가 권한 정보라
 * '계정 0개'가 곧 오정보가 되고(관리자 0명으로 보인다), 관리자가 그걸 근거로 권한을
 * 다시 부여하는 쓰기까지 유발한다. 아래 조회 실패 처리와 같은 기준(fail-loud).
 */
export async function listAccounts(
  projectId: string,
): Promise<{ ok: true; rows: AccountRow[] } | { ok: false; error: string }> {
  const g = await requireSuperuser()
  if (!g.ok) {
    console.error('[listAccounts] 게이트 거부:', g.error, 'projectId=', projectId)
    return { ok: false, error: g.error }
  }
  const admin = createAdminClient()

  // 1) auth.users 전체 수집(페이지네이션·실패는 throw)
  const users = await listAllAuthUsers(admin)

  // 2) memberships(팀·슈퍼유저) + project_roles(이 프로젝트 역할) 조인
  const { data: mems, error: memsErr } = await admin
    .from('memberships').select('user_id, is_superuser, teams(code)')
  // 조회 실패를 '멤버십 없음'으로 폴백하면 모든 계정이 '팀 없음 / 권한 없음'으로 렌더링된다.
  // 여기는 권한 관리 화면이라 그 화면이 곧 잘못된 권한 정보이고(관리자 0명으로 보임),
  // 그걸 근거로 관리자가 권한을 다시 부여하는 쓰기까지 유발한다. 조용한 빈 값보다 에러가 낫다.
  if (memsErr || !mems) throw new Error('계정 권한 정보를 불러오지 못했습니다: ' + (memsErr?.message ?? 'unknown'))
  const byUser = new Map<string, { teamCode: TeamCode | null; isSuperuser: boolean }>()
  for (const row of mems) {
    const team = row.teams as unknown as { code: TeamCode } | null
    byUser.set(row.user_id as string, {
      teamCode: team?.code ?? null,
      isSuperuser: Boolean(row.is_superuser),
    })
  }

  const { data: roles, error: rolesErr } = await admin
    .from('project_roles').select('user_id, role').eq('project_id', projectId)
  if (rolesErr || !roles) throw new Error('프로젝트 역할을 불러오지 못했습니다: ' + (rolesErr?.message ?? 'unknown'))
  const roleBy = new Map(roles.map(r => [r.user_id as string, r.role as AccountRole]))

  const rows = users
    .map<AccountRow>((u) => ({
      id: u.id,
      email: u.email,
      name: u.fullName,
      teamCode: byUser.get(u.id)?.teamCode ?? null,
      role: roleBy.get(u.id) ?? 'viewer',
      isSuperuser: byUser.get(u.id)?.isSuperuser ?? false,
      createdAt: u.createdAt,
    }))
    // 계정 표에 '이름' 열이 있으므로 이름 가나다순으로 보여준다.
    // 이름이 비어 있는 계정(이메일만 등록)은 compareKoreanName 이 뒤로 보내고, 그 안에서는 이메일순.
    .sort((a, b) => compareKoreanName(a.name, b.name) || a.email.localeCompare(b.email))
  return { ok: true, rows }
}
