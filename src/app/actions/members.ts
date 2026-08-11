'use server'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin, resolveProjectId } from '@/lib/authz'
import { revalidatePath } from 'next/cache'
import { isValidEmail } from '@/lib/domain/validate'
import type { ProjectMemberRole, TeamCode } from '@/lib/domain/types'

export interface MemberInput {
  name: string
  email: string | null
  teamCode: TeamCode | null
  role: ProjectMemberRole
  title: string | null
  roleLabel: string | null
}

export interface MemberActionResult {
  ok: boolean
  error?: string
}

type ServerClient = Awaited<ReturnType<typeof createServerClient>>

const MEMBER_IDENTITY_CONFLICT =
  '동일한 이메일은 모든 프로젝트에서 같은 이름으로 등록해야 합니다.'
const MEMBER_IDENTITY_LOOKUP_FAILED = '멤버 기준정보를 확인할 수 없어 중단했습니다.'
const MEMBER_IDENTITY_RENAME_FORBIDDEN =
  '여러 프로젝트에서 사용하는 이름은 슈퍼유저만 변경할 수 있습니다.'
const MEMBER_UPDATE_RETRY = '다른 요청이 멤버 정보를 변경했습니다. 다시 시도해 주세요.'

/** 팀 코드 → teams.id — 프로젝트 행 우선, 전역 폴백(0071 스코프. import RPC 와 같은 규칙). */
async function resolveTeamId(sb: ServerClient, teamCode: TeamCode | null, projectId: string): Promise<string | null> {
  if (!teamCode) return null
  const { data } = await sb.from('teams')
    .select('id, project_id')
    .eq('code', teamCode)
    .or(`project_id.eq.${projectId},project_id.is.null`)
  const rows = (data ?? []) as Array<{ id: string; project_id: string | null }>
  return (rows.find(r => r.project_id !== null) ?? rows[0])?.id ?? null
}

/** 0019 의 부분 유니크 인덱스 위반을 사용자 언어로 옮긴다 — 원시 Postgres 문자열 노출 방지. */
function memberWriteError(error: { code?: string; message: string }): string {
  // 0070의 정본 trigger와 복합 FK는 앱 사전 조회 뒤의 동시 쓰기까지 막는다.
  // 다른 프로젝트의 이름이나 이메일은 오류에 싣지 않는다.
  if (
    (error.code === '23514' && error.message.includes('PROJECT_MEMBER_EMAIL_NAME_MISMATCH'))
    || (error.code === '23503' && error.message.includes('project_members_email_name_fkey'))
  ) {
    return MEMBER_IDENTITY_CONFLICT
  }
  if (error.message.includes('PROJECT_MEMBER_IDENTITY_RENAME_FORBIDDEN')) {
    return MEMBER_IDENTITY_RENAME_FORBIDDEN
  }
  if (error.message.includes('PROJECT_MEMBER_NOT_FOUND')) return '멤버를 찾을 수 없습니다.'
  if (error.message.includes('PROJECT_MEMBER_UPDATE_FORBIDDEN')) return '권한 없음'
  if (error.message.includes('PROJECT_MEMBER_RETRY')) return MEMBER_UPDATE_RETRY
  if (error.code !== '23505') return error.message
  // 두 제약은 원인이 다르다: 같은 이메일 재등록 vs 다른 이메일이 같은 계정으로 해석됨.
  if (error.message.includes('project_members_project_user_uidx')) {
    return '이 로그인 계정은 이미 이 프로젝트의 멤버로 등록되어 있습니다.'
  }
  return '같은 이메일의 멤버가 이 프로젝트에 이미 있습니다.'
}

/**
 * 이메일은 프로젝트 경계를 넘는 사람 키다. 같은 이메일의 기존 로스터 이름과 다르면
 * 다른 프로젝트를 몰래 고치지 않고 현재 쓰기를 거부한다. 이 조회는 친절한 UX용이며,
 * SELECT-then-write 경합의 최종 방어는 0070의 email PK 정본 + 복합 FK가 맡는다.
 */
async function validateMemberIdentity(
  sb: ServerClient,
  email: string | null,
  name: string,
): Promise<MemberActionResult> {
  if (!email) return { ok: true }

  const query = sb
    .from('project_members')
    .select('id, name')
    .eq('email', email)

  const { data, error } = await query
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
  if (error) {
    console.error('[validateMemberIdentity] 전역 이메일 기준정보 조회 실패:', error.message)
    return { ok: false, error: MEMBER_IDENTITY_LOOKUP_FAILED }
  }

  const canonicalName = (data?.[0]?.name as string | undefined)?.trim()
  if (canonicalName && canonicalName !== name) {
    return { ok: false, error: MEMBER_IDENTITY_CONFLICT }
  }
  return { ok: true }
}

export async function addMember(projectId: string, input: MemberInput): Promise<MemberActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const name = input.name.trim()
  if (!name) return { ok: false, error: '이름을 입력하세요.' }
  if (input.email && !isValidEmail(input.email)) return { ok: false, error: '올바른 이메일 형식이 아닙니다.' }
  const email = input.email?.trim().toLowerCase() || null // 0019 trigger·0070 정본 키와 같은 정규화
  const sb = await createServerClient()
  const identity = await validateMemberIdentity(sb, email, name)
  if (!identity.ok) return identity
  const teamId = await resolveTeamId(sb, input.teamCode, projectId)
  const { error } = await sb.from('project_members').insert({
    project_id: projectId,
    name,
    email,
    team_id: teamId,
    role: input.role,
    title: input.title,
    role_label: input.roleLabel?.trim() || null,
  })
  if (error) return { ok: false, error: memberWriteError(error) }
  revalidatePath('/p/' + projectId + '/members')
  return { ok: true }
}

export async function updateMember(memberId: string, input: MemberInput): Promise<MemberActionResult> {
  // projectId 를 인자로 받지 않으므로 대상 행에서 먼저 읽는다 — 선행 조회 실패는 쓰기 중단 사유.
  const found = await resolveProjectId('project_members', memberId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectAdmin(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const name = input.name.trim()
  if (!name) return { ok: false, error: '이름을 입력하세요.' }
  if (input.email && !isValidEmail(input.email)) return { ok: false, error: '올바른 이메일 형식이 아닙니다.' }
  const email = input.email?.trim().toLowerCase() || null // 0019 trigger·0070 정본 키와 같은 정규화
  const sb = await createServerClient()
  const teamId = await resolveTeamId(sb, input.teamCode, found.projectId!)
  // 이름 정본 변경과 현재 프로젝트 속성 수정을 한 RPC 트랜잭션으로 묶는다.
  // 단일 프로젝트 email은 해당 관리자가 교정할 수 있고, 여러 프로젝트가 공유하면
  // DB가 슈퍼유저만 허용한다. 두 요청으로 나누면 한쪽만 저장되는 반쪽 성공이 생긴다.
  const { error } = await sb.rpc('update_project_member_with_identity', {
    p_member_id: memberId,
    p_name: name,
    p_email: email,
    p_team_id: teamId,
    p_role: input.role,
    p_title: input.title,
    p_role_label: input.roleLabel?.trim() || null,
  })
  if (error) return { ok: false, error: memberWriteError(error) }
  revalidatePath('/p/' + found.projectId + '/members')
  return { ok: true }
}

export async function removeMember(memberId: string): Promise<MemberActionResult> {
  const found = await resolveProjectId('project_members', memberId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectAdmin(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('project_members')
    .delete()
    .eq('id', memberId)
    .select('project_id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (data?.project_id) revalidatePath('/p/' + (data.project_id as string) + '/members')
  return { ok: true }
}
