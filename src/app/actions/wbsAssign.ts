'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { emitNotification } from '@/lib/notify/emit'
import { ensureOrderForAssignedLeaf } from '@/lib/agent/ensureOrder'

/**
 * WBS 담당자(로스터 축)·단계(stage) 갱신 — §2.5. 배정 권한은 프로젝트 관리자.
 * 담당자는 노드 속성 — 하위 상속·롤업 없음. 배정 해제 시 활성 주문은 자동 취소하지 않는다(§2.8).
 */

const STAGES = new Set(['todo', 'as', 'fp', 'ip', 'im', 'xx'])

type LoadedItem = {
  id: string; project_id: string; parent_id: string | null; name: string
  assignee_member_id: string | null; external_ref: string | null
}

async function loadItem(itemId: string): Promise<
  | { ok: true; item: LoadedItem }
  | { ok: false; error: string }
> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('wbs_items')
    .select('id, project_id, parent_id, name, assignee_member_id, external_ref')
    .eq('id', itemId).maybeSingle()
  if (error) return { ok: false, error: `항목 조회 실패: ${error.message}` }
  if (!data) return { ok: false, error: '항목 없음' }
  return { ok: true, item: data as LoadedItem }
}

const REACHED_STAGES = new Set(['im', 'xx'])

/**
 * 부록 §2.10 — "stage 가 im 이상에 도달 시" depends 역참조로 후행 리프 담당자에게
 * work.unblocked 발행. 승인 액션이 아니라 여기(stage 를 실제로 쓰는 유일한 경로)에 배선한다.
 * 조회·발행 실패는 로깅만 하고 삼킨다 — setWbsStage 의 반환값(ok:true)에 영향을 주지 않는다.
 */
async function notifySuccessorsOnReached(
  admin: ReturnType<typeof createAdminClient>,
  item: LoadedItem,
  actorUserId: string,
): Promise<void> {
  try {
    if (!item.external_ref) return
    const { data: successors, error } = await admin
      .from('wbs_items')
      .select('id, name, assignee_member_id')
      .eq('project_id', item.project_id)
      .contains('depends', [item.external_ref])
    if (error) {
      console.error('[wbsAssign] 후행 리프 조회 실패:', error.message)
      return
    }
    for (const s of (successors ?? []) as { id: string; name: string; assignee_member_id: string | null }[]) {
      if (!s.assignee_member_id) continue
      await emitNotification({
        type: 'work.unblocked',
        projectId: item.project_id,
        actorUserId,
        entityType: 'wbs_item',
        entityId: s.id,
        payload: {
          title: s.name,
          detail: '선행 작업이 완료되어 착수 가능합니다',
          href: `/p/${item.project_id}/wbs`,
        },
        recipientMemberIds: [s.assignee_member_id],
        dedupeKey: `unblocked:${s.id}:${item.id}`,
      })
    }
  } catch (e) {
    console.error('[wbsAssign] 후행 리프 unblocked 발행 예외:', e)
  }
}

export async function setWbsAssignee(
  itemId: string, memberId: string | null,
): Promise<{ ok: boolean; error?: string; orderCreated?: boolean }> {
  const loaded = await loadItem(itemId)
  if (!loaded.ok) return loaded
  const { item } = loaded
  const g = await requireProjectAdmin(item.project_id)
  if (!g.ok) return { ok: false, error: g.error }
  // 이미 같은 담당자면 쓰기·알림 없이 성공 — 알림 멱등은 dedupeKey(영구 억제)가 아니라
  // 상태 비교로 확보한다. dedupeKey를 쓰면 재배정 순환(M1→M2→M1)에서 두 번째 M1 배정이
  // 조용히 무발행된다(23505를 성공으로 처리하는 emit.ts 특성).
  if ((item.assignee_member_id ?? null) === memberId) return { ok: true }
  const admin = createAdminClient()
  if (memberId !== null) {
    if (!isUuidLike(memberId)) return { ok: false, error: '잘못된 요청입니다.' }
    // 쓰기 선행조회 — 로스터 실재 + 프로젝트 일치(복합 FK 가 2차 방어선, 여기가 1차).
    const { data: mem, error: memErr } = await admin
      .from('project_members').select('id, project_id').eq('id', memberId).maybeSingle()
    if (memErr) return { ok: false, error: `멤버 조회 실패: ${memErr.message}` }
    if (!mem || (mem as { project_id: string }).project_id !== item.project_id) {
      return { ok: false, error: '이 프로젝트의 로스터 멤버가 아닙니다.' }
    }
  }
  const { data: updated, error } = await admin
    .from('wbs_items')
    .update({ assignee_member_id: memberId, updated_at: new Date().toISOString() })
    .eq('id', itemId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  revalidatePath(`/p/${item.project_id}`, 'layout')
  // 배정 해제(null)는 알림 대상이 없다 — §2.8 역방향: 활성 주문 자동 취소도, 알림도 없다.
  if (memberId !== null) {
    await emitNotification({
      type: 'work.assigned',
      projectId: item.project_id,
      actorUserId: g.actor.userId,
      entityType: 'wbs_item',
      entityId: itemId,
      payload: { title: item.name, detail: '작업 담당자로 지정되었습니다', href: `/p/${item.project_id}/wbs` },
      recipientMemberIds: [memberId],
    })
    // §2.8 자동 발행 — 배정 성공에 종속된 오류 격리 호출이다. 실패해도 배정 자체는 성공을
    // 유지한다(에러는 로깅만). ensureOrderForAssignedLeaf 내부가 리프·게이트·멱등을 자체 처리한다.
    try {
      const orderRes = await ensureOrderForAssignedLeaf(admin, {
        projectId: item.project_id,
        wbsItemId: itemId,
        actorUserId: g.actor.userId,
      })
      if (!orderRes.ok) console.error('[wbsAssign] 자동 주문 발행 실패:', orderRes.error)
    } catch (e) {
      console.error('[wbsAssign] 자동 주문 발행 예외:', e)
    }
  }
  return { ok: true }
}

export async function setWbsStage(
  itemId: string, stage: 'todo' | 'as' | 'fp' | 'ip' | 'im' | 'xx' | null,
): Promise<{ ok: boolean; error?: string }> {
  if (stage !== null && !STAGES.has(stage)) return { ok: false, error: '허용되지 않는 단계입니다.' }
  const loaded = await loadItem(itemId)
  if (!loaded.ok) return loaded
  const { item } = loaded
  const g = await requireProjectAdmin(item.project_id)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { data: cur, error: curErr } = await admin
    .from('wbs_items').select('stage').eq('id', itemId).maybeSingle()
  if (curErr) return { ok: false, error: `단계 조회 실패: ${curErr.message}` }
  const oldStage = (cur as { stage: string | null } | null)?.stage ?? null
  if (oldStage === stage) return { ok: true }
  const { data: updated, error } = await admin
    .from('wbs_items')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', itemId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  const { error: logErr } = await admin.from('change_logs').insert({
    user_id: g.actor.userId, wbs_item_id: itemId, field: 'stage',
    old_value: oldStage, new_value: stage,
  })
  if (logErr) console.error('[wbsAssign] 단계 변경 이력 기록 실패:', logErr.message)
  revalidatePath(`/p/${item.project_id}`, 'layout')
  // §2.10 — im 이상에 "처음" 도달할 때만(역전이·재설정은 위 oldStage === stage 조기 반환과
  // 이 조건으로 모두 제외된다). 본 로직의 반환값에는 영향을 주지 않는다.
  if (!REACHED_STAGES.has(oldStage ?? '') && stage !== null && REACHED_STAGES.has(stage)) {
    await notifySuccessorsOnReached(admin, item, g.actor.userId)
  }
  return { ok: true }
}

/**
 * 선택된 항목의 현재 담당자·단계 조회 — 패널이 선택 변경 시 읽는다(RowDetailPanel의
 * getChangeLogs 관례와 동일하게 클라이언트에서 별도 로드; ComputedItem 을 확장하지 않는다).
 *
 * itemId만 받는 액션이라 getSession() 만으로는 "이 프로젝트 멤버인가"를 판정하지 못한다
 * (리뷰 라운드 1 — 로그인만 확인하면 타 프로젝트 멤버도 읽을 수 있었다). resolveProjectId로
 * 소속 프로젝트를 먼저 읽고 requireProjectMember로 재판정한다 — 가드는 이 둘만 쓴다
 * (role === '...' 직접 비교·memberships.role 참조 없음).
 *
 * 실패는 null — 3원칙 ①: "조회 안 됨"을 "미배정"으로 위장하면 관리자가 실제 값을 못 본 채
 * 셀렉트를 건드려 조용히 덮어쓸 수 있다. 패널은 null 을 "표시 불가" 상태로 렌더해야 한다.
 */
export async function getWbsAssigneeStage(
  itemId: string,
): Promise<{ assigneeMemberId: string | null; stage: string | null } | null> {
  if (!isUuidLike(itemId)) return null
  const resolved = await resolveProjectId('wbs_items', itemId)
  if (!resolved.ok) {
    console.error('[getWbsAssigneeStage] 프로젝트 조회 실패:', resolved.error)
    return null
  }
  const g = await requireProjectMember(resolved.projectId)
  if (!g.ok) {
    console.error('[getWbsAssigneeStage] 권한 없음:', g.error)
    return null
  }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('wbs_items').select('assignee_member_id, stage').eq('id', itemId).maybeSingle()
  if (error) {
    console.error('[getWbsAssigneeStage] 조회 실패:', error.message)
    return null
  }
  if (!data) return null
  const row = data as { assignee_member_id: string | null; stage: string | null }
  return { assigneeMemberId: row.assignee_member_id ?? null, stage: row.stage ?? null }
}
