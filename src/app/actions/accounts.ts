'use server'
import { revalidatePath } from 'next/cache'
import { getMembership } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidEmail } from '@/lib/domain/validate'
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
  role: string | null      // 'pmo_admin' | 'team_editor' | null(멤버십 없음)
  createdAt: string
}

export interface AccountInput {
  email: string
  password: string
  teamCode: TeamCode
  role: AccountRole
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

async function isAdmin(): Promise<boolean> {
  const m = await getMembership()
  return m?.role === 'pmo_admin'
}

async function resolveTeamId(admin: AdminClient, teamCode: TeamCode): Promise<string | null> {
  const { data } = await admin.from('teams').select('id').eq('code', teamCode).single()
  return (data?.id as string | undefined) ?? null
}

/** 게이트/클라이언트 생성 이후 단건 생성 — bulk 에서 재사용(게이트 재검사 없음). */
async function createOne(admin: AdminClient, input: AccountInput): Promise<AccountActionResult> {
  if (!isValidEmail(input.email)) return { ok: false, error: '올바른 이메일 형식이 아닙니다.' }
  if (!isValidPassword(input.password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  if (!isTeamCode(input.teamCode)) return { ok: false, error: '알 수 없는 팀 코드' }
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

  const { error: memErr } = await admin.from('memberships').insert({
    user_id: created.user.id, team_id: teamId, role: input.role,
  })
  if (memErr) {
    // 보상 롤백 — 멤버십 없는 유령 계정 방지
    await admin.auth.admin.deleteUser(created.user.id)
    return { ok: false, error: '팀/권한 저장 실패: ' + memErr.message }
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
  if (!(await isAdmin())) return { ok: false, error: '권한 없음' }
  const admin = createAdminClient()
  const res = await createOne(admin, input)
  if (res.ok) revalidatePath('/admin/accounts')
  return res
}

export async function bulkCreateAccounts(
  text: string,
): Promise<{ ok: boolean; error?: string; results: BulkResultRow[] }> {
  if (!(await isAdmin())) return { ok: false, error: '권한 없음', results: [] }
  const admin = createAdminClient()
  const lines = parseBulkAccounts(text)
  if (lines.length === 0) return { ok: false, error: '처리할 행이 없습니다.', results: [] }

  const results: BulkResultRow[] = []
  for (const line of lines) {
    if (!line.ok) {
      results.push({ lineNo: line.lineNo, email: line.email ?? line.raw, ok: false, error: line.error })
      continue
    }
    const res = await createOne(admin, {
      email: line.email!, password: line.password!, teamCode: line.teamCode!, role: line.role!, name: line.name ?? null,
    })
    results.push({ lineNo: line.lineNo, email: line.email!, ok: res.ok, error: res.error })
  }
  revalidatePath('/admin/accounts')
  return { ok: true, results }
}

export async function resetPassword(userId: string, password: string): Promise<AccountActionResult> {
  if (!(await isAdmin())) return { ok: false, error: '권한 없음' }
  if (!isValidPassword(password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function updateAccountRole(
  userId: string, teamCode: string, role: string,
): Promise<AccountActionResult> {
  if (!(await isAdmin())) return { ok: false, error: '권한 없음' }
  if (!isTeamCode(teamCode)) return { ok: false, error: '알 수 없는 팀 코드' }
  if (!isAccountRole(role)) return { ok: false, error: '알 수 없는 권한' }
  const admin = createAdminClient()

  // 마지막 PMO 관리자 강등 방지 — 전원이 /admin/accounts 에서 잠기는 것을 막는다.
  if (role !== 'pmo_admin') {
    const { data: admins } = await admin.from('memberships').select('user_id').eq('role', 'pmo_admin')
    const adminIds = (admins ?? []).map((r) => r.user_id as string)
    if (adminIds.includes(userId) && adminIds.length <= 1) {
      return { ok: false, error: '마지막 PMO 관리자는 강등할 수 없습니다. 다른 관리자를 먼저 지정하세요.' }
    }
  }

  const teamId = await resolveTeamId(admin, teamCode)
  if (!teamId) return { ok: false, error: '팀을 찾을 수 없습니다.' }
  // memberships PK 는 user_id — 없으면 삽입, 있으면 갱신
  const { error } = await admin
    .from('memberships')
    .upsert({ user_id: userId, team_id: teamId, role }, { onConflict: 'user_id' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/accounts')
  return { ok: true }
}

export async function listAccounts(): Promise<AccountRow[]> {
  if (!(await isAdmin())) return []
  const admin = createAdminClient()

  // 1) auth.users 전체 수집(페이지네이션)
  type RawUser = { id: string; email: string; created_at: string; full_name: string | null }
  const users: RawUser[] = []
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error || !data) break
    for (const u of data.users) {
      users.push({
        id: u.id,
        email: u.email ?? '',
        created_at: u.created_at,
        full_name: (u.user_metadata?.full_name as string | undefined) ?? null,
      })
    }
    if (data.users.length < perPage) break
  }

  // 2) memberships + teams 조인
  const { data: mems } = await admin.from('memberships').select('user_id, role, teams(code)')
  const byUser = new Map<string, { role: string; teamCode: TeamCode | null }>()
  for (const row of mems ?? []) {
    const team = row.teams as unknown as { code: TeamCode } | null
    byUser.set(row.user_id as string, { role: row.role as string, teamCode: team?.code ?? null })
  }

  return users
    .map<AccountRow>((u) => ({
      id: u.id,
      email: u.email,
      name: u.full_name,
      teamCode: byUser.get(u.id)?.teamCode ?? null,
      role: byUser.get(u.id)?.role ?? null,
      createdAt: u.created_at,
    }))
    .sort((a, b) => a.email.localeCompare(b.email))
}
