// 서브트리 관리자 가드(트랙 B, 2026-09-15) — 허브 "개발 프로세스 조정" op(승인·반려/승인취소/재작업·
// 중단·단계 조정)의 관리자 전용 판정에 "서브트리 관리자"를 더한다. 별도 파일로 두는 이유는
// delegation.ts 에 섞지 않기 위해서다 — delegation.ts 는 ensureOrder(3 export)·stageTransition·
// agentSeatmap 을 끌고 오는 무거운 모듈이고, requireDelegationRight 는 위임 토글·프롬프트 편집이
// 공유하는 "관리자 또는 리프 담당자 본인" 계약이라 서브트리 관리자를 거기 섞으면 위임 토글까지
// 조용히 넓어진다(이번 범위 밖). wbsAssign.ts·agentHub.ts 가 이 파일 하나만 가져가면 그 무게가
// 따라오지 않는다 — 이 리포는 부분 목킹으로 같은 문제를 이미 두 번 우회했다(authz/errors.ts,
// wbs-assign.test.ts 의 stageTransition importOriginal).
import { requireProjectAdmin, requireProjectMember } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { viewerEmail } from '@/lib/data/agentSeatmap'
import { myMemberIds, isSubtreeManager } from '@/lib/agent/assignee'

export const ERR_NOT_SUBTREE_MANAGER = '관리자 또는 서브트리 관리자만 할 수 있습니다.'

export type SubtreeGuardResult =
  | { ok: true; actor: { userId: string }; isAdmin: boolean }
  | { ok: false; error: string }

/**
 * 개발 프로세스 조정 op(승인·중단·단계 조정, 그리고 반려/승인취소/재작업의 "관리자도 리프
 * 담당자 본인도 아니다" 경로)의 공용 자격 — 관리자 또는 그 항목의 서브트리 관리자.
 *
 * "서브트리 관리자" = 대상 항목의 strict 조상(부모·조부모…루트, 자신 제외) 중 어느 노드의
 * 담당자가 나인 경우(isSubtreeManager, assignee.ts). 관리자 가드를 먼저 물어 관리자는 추가
 * 조회 없이 통과한다(requireDelegationRight 와 같은 패턴).
 *
 * fail-closed: 로스터·조상 조회가 던지면(myMemberIds·isSubtreeManager 계약) 거부로 잡는다.
 */
export async function requireSubtreeManagerOrAdmin(
  itemId: string, projectId: string,
): Promise<SubtreeGuardResult> {
  const a = await requireProjectAdmin(projectId)
  if (a.ok) return { ok: true, actor: { userId: a.actor.userId }, isAdmin: true }
  const m = await requireProjectMember(projectId)
  if (!m.ok) return { ok: false, error: m.error }
  const admin = createAdminClient()
  try {
    const email = await viewerEmail(admin, m.actor.userId)
    const mine = await myMemberIds(admin, { userId: m.actor.userId, userEmail: email ?? '', projectId })
    const manager = await isSubtreeManager(admin, { itemId, projectId, myMemberIds: mine })
    if (!manager) return { ok: false, error: ERR_NOT_SUBTREE_MANAGER }
    return { ok: true, actor: { userId: m.actor.userId }, isAdmin: false }
  } catch (e) {
    console.error('[subtreeManager] 서브트리 관리자 판정 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: '서브트리 관리자 판정에 실패했습니다.' }
  }
}
