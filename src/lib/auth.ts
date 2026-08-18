import { cache } from 'react'
import { createServerClient } from './supabase/server'
import { displayNameFrom } from './domain/display-name'
import type { Membership, TeamCode } from './domain/types'

// cache(): 같은 요청 안의 중복 호출을 1회로 접는다. HTTP 자체는 auth-js·Next 의
// fetch dedupe 가 이미 합치지만, 클라이언트 생성·파싱 오버헤드와 호출 그래프의
// 단수 계산을 단순하게 유지하는 위생 조치다(2026-08-18 성능 감사).
export const getSession = cache(async () => {
  const sb = await createServerClient()
  const { data } = await sb.auth.getUser()
  return data.user
})

/** 헤더 표시용 로그인 사용자 이름 — 계정 생성 시 저장한 full_name, 없으면 이메일 아이디. */
export const getDisplayName = cache(async (): Promise<string | null> => {
  const u = await getSession()
  if (!u) return null
  return displayNameFrom(u.user_metadata, u.email)
})

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
