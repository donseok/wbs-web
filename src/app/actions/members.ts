'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { isValidEmail } from '@/lib/domain/validate'
import type { ProjectMemberRole, TeamCode } from '@/lib/domain/types'

export interface MemberInput {
  name: string
  email: string | null
  teamCode: TeamCode | null
  role: ProjectMemberRole
  title: string | null
}

export interface MemberActionResult {
  ok: boolean
  error?: string
}

type ServerClient = Awaited<ReturnType<typeof createServerClient>>

async function resolveTeamId(sb: ServerClient, teamCode: TeamCode | null): Promise<string | null> {
  if (!teamCode) return null
  const { data } = await sb.from('teams').select('id').eq('code', teamCode).single()
  return (data?.id as string | undefined) ?? null
}

export async function addMember(projectId: string, input: MemberInput): Promise<MemberActionResult> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  if (input.email && !isValidEmail(input.email)) return { ok: false, error: '올바른 이메일 형식이 아닙니다.' }
  const sb = await createServerClient()
  const teamId = await resolveTeamId(sb, input.teamCode)
  const { error } = await sb.from('project_members').insert({
    project_id: projectId,
    name: input.name,
    email: input.email,
    team_id: teamId,
    role: input.role,
    title: input.title,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/p/' + projectId + '/members')
  return { ok: true }
}

export async function updateMember(memberId: string, input: MemberInput): Promise<MemberActionResult> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  if (input.email && !isValidEmail(input.email)) return { ok: false, error: '올바른 이메일 형식이 아닙니다.' }
  const sb = await createServerClient()
  const teamId = await resolveTeamId(sb, input.teamCode)
  const { data, error } = await sb
    .from('project_members')
    .update({
      name: input.name,
      email: input.email,
      team_id: teamId,
      role: input.role,
      title: input.title,
    })
    .eq('id', memberId)
    .select('project_id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (data?.project_id) revalidatePath('/p/' + (data.project_id as string) + '/members')
  return { ok: true }
}

export async function removeMember(memberId: string): Promise<MemberActionResult> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
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
