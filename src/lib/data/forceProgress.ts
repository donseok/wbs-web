// 강제 진행 버튼 노출 재료 로더 — 보는 사람의 로스터 행으로 서브트리 관리자인 항목을 고른다(스펙 2026-09-23 §3.2).
// 표시 전용이라 실패는 빈 목록(버튼 숨김 — fail-closed)이고 로그를 남긴다. 서버 액션 가드는 그대로다.
import { createAdminClient } from '@/lib/supabase/admin'
import { myMemberIds } from '@/lib/agent/assignee'
import { subtreeManagedIds } from '@/lib/domain/forceProgressRights'
import type { ComputedItem } from '@/lib/domain/types'

export async function getForceManagedIds(
  projectId: string, items: ComputedItem[], user: { id: string; email: string | null } | null,
): Promise<string[]> {
  if (!user) return []
  try {
    const ids = await myMemberIds(createAdminClient(), { userId: user.id, userEmail: user.email ?? '', projectId })
    return subtreeManagedIds(items, ids)
  } catch (e) {
    console.error('[forceProgress] 서브트리 관리자 판정 재료 조회 실패 — 강제 진행 버튼은 관리자에게만 보인다:', e)
    return []
  }
}
