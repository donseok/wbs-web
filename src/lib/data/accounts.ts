// auth.users 전량 수집 — 계정 관리·권한 화면 공용. 'use server' 파일이 아니어서
// 클라이언트에서 직접 부를 수 없다(액션이 게이트를 통과한 뒤에만 호출).
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface RawAuthUser {
  id: string
  email: string
  createdAt: string
  fullName: string | null
}

/**
 * auth.users 전체(페이지네이션). 실패는 throw — 잘린 목록을 완전한 목록처럼 돌려주면
 * 누락 계정이 '존재하지 않음'과 구별되지 않는다(권한 화면에서는 그것이 곧 오정보다).
 */
export async function listAllAuthUsers(admin: AdminClient): Promise<RawAuthUser[]> {
  const users: RawAuthUser[] = []
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error || !data) {
      throw new Error(`계정 목록을 불러오지 못했습니다(page=${page}): ${error?.message ?? 'unknown'}`)
    }
    for (const u of data.users) {
      users.push({
        id: u.id,
        email: u.email ?? '',
        createdAt: u.created_at,
        fullName: (u.user_metadata?.full_name as string | undefined) ?? null,
      })
    }
    if (data.users.length < perPage) break
  }
  return users
}
