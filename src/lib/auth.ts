import { createServerClient } from './supabase/server'
import type { Membership, TeamCode } from './domain/types'

export async function getSession() {
  const sb = await createServerClient()
  const { data } = await sb.auth.getUser()
  return data.user
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
