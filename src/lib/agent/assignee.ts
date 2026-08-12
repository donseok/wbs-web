import type { AdminClient } from '@/lib/minutes/externalApi'

/**
 * 로스터 다리 이중 매칭(§2.5-④) — user_id 링크(0019 트리거) 또는 email 소문자 일치.
 * scope=assigned·claim 배정 제한이 공유하는 "이게 내 배정인지" 판정 재료.
 * 조회 실패는 위장하지 않고 throw — 배정 판정은 보안 재료라 "빈 결과"로 삼키면 사칭을 못 잡는다.
 */
export async function myMemberIds(
  admin: AdminClient,
  args: { userId: string; userEmail: string; projectId: string },
): Promise<string[]> {
  const { data, error } = await admin
    .from('project_members').select('id, user_id, email').eq('project_id', args.projectId)
  if (error) throw new Error(`로스터 조회 실패: ${error.message}`)
  const email = args.userEmail.toLowerCase()
  const out = new Set<string>()
  for (const m of (data ?? []) as Array<{ id: string; user_id: string | null; email: string | null }>) {
    if (m.user_id === args.userId || (m.email && m.email.toLowerCase() === email)) out.add(m.id)
  }
  return [...out]
}
