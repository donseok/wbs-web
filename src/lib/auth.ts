import { createServerClient } from './supabase/server'
import type { Membership, TeamCode } from './domain/types'

export async function getSession() {
  const sb = await createServerClient()
  const { data } = await sb.auth.getUser()
  return data.user
}

/** 헤더 표시용 로그인 사용자 이름 — 계정 생성 시 저장한 full_name, 없으면 이메일 아이디. */
export async function getDisplayName(): Promise<string | null> {
  const sb = await createServerClient()
  const { data } = await sb.auth.getUser()
  const u = data.user
  if (!u) return null
  const full = (u.user_metadata?.full_name as string | undefined)?.trim()
  return full || u.email?.split('@')[0] || null
}

export async function getMembership(): Promise<Membership | null> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return null
  const { data } = await sb
    .from('memberships')
    .select('role, teams(code, id)')
    .eq('user_id', u.user.id)
    .single()
  if (!data) return null
  const team = data.teams as unknown as { code: TeamCode; id: string }
  return { role: data.role, teamCode: team.code, teamId: team.id }
}
