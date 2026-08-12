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

/**
 * itemId → project_id 존재/소속 판별 — RLS 스코프(resolveProjectId, 세션 클라이언트)로만 한다.
 * admin(service_role)으로 먼저 존재를 확인하면 RLS 를 우회해 "존재하지만 권한 없음"과 "존재
 * 자체가 없음"이 다른 에러로 갈라져 비멤버가 타 프로젝트 항목의 존재를 추정할 수 있다
 * (존재 오라클 — wbsSpec.ts loadItemProject 와 동일 문제·동일 해법, 최종 리뷰 권장사항).
 */
async function resolveItemProjectId(itemId: string): Promise<
  | { ok: true; projectId: string }
  | { ok: false; error: string }
> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const resolved = await resolveProjectId('wbs_items', itemId)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  if (resolved.projectId === null) return { ok: false, error: '대상을 찾을 수 없습니다.' }
  return { ok: true, projectId: resolved.projectId }
}

/** 가드 통과 후 admin으로 상세를 로드한다(존재 판별용이 아니다 — 그 역할은 resolveItemProjectId). */
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
 * 후행의 depends 전체가 im/xx 에 도달했는지 확인 — §2.10 알림 의미("착수 가능")와 T15 claim
 * 게이트(depends 전부 stage ≥ im 이어야 통과)를 맞춘다. 선행 하나 도달마다 발행하면 depends
 * 가 여러 개인 후행에게 아직 착수 불가한데 "착수 가능합니다" 라는 거짓 알림이 나간다.
 * 조회 실패·일부 선행 미발견은 fail-closed(false 취급) — 호출부가 발행을 생략한다.
 */
async function allPredecessorsReached(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  dependsRefs: string[],
): Promise<boolean | null> {
  if (dependsRefs.length === 0) return true
  const { data, error } = await admin
    .from('wbs_items')
    .select('external_ref, stage')
    .eq('project_id', projectId)
    .in('external_ref', dependsRefs)
  if (error) return null
  const rows = (data ?? []) as { external_ref: string; stage: string | null }[]
  // dependsRefs 에 중복 external_ref 가 있으면 .in() 은 실제 존재 행만 반환해 항상 짧다 —
  // 배열 길이가 아니라 고유 개수로 비교해야 정상 depends 에서도 영구 미충족이 되지 않는다.
  if (rows.length < new Set(dependsRefs).size) return false // 일부 선행 미발견 — fail-closed
  return rows.every(r => REACHED_STAGES.has(r.stage ?? ''))
}

/**
 * 부록 §2.10 — "stage 가 im 이상에 도달 시" depends 역참조로 후행 리프 담당자에게
 * work.unblocked 발행. 승인 액션이 아니라 여기(stage 를 실제로 쓰는 유일한 경로)에 배선한다.
 * 발행은 후행의 depends 전부가 im/xx 에 도달했을 때만 — 다중 depends 후행은 마지막 선행이
 * 도달하는 순간 1회만 발행된다. 조회·발행 실패는 로깅만 하고 삼킨다 — setWbsStage 의
 * 반환값(ok:true)에 영향을 주지 않는다.
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
      .select('id, name, assignee_member_id, depends')
      .eq('project_id', item.project_id)
      .contains('depends', [item.external_ref])
    if (error) {
      console.error('[wbsAssign] 후행 리프 조회 실패:', error.message)
      return
    }
    type Successor = { id: string; name: string; assignee_member_id: string | null; depends: string[] | null }
    for (const s of (successors ?? []) as Successor[]) {
      if (s.id === item.id) continue // 자기 참조 — 방금 갱신된 자신의 stage로 게이트를 통과해 본인에게 알림 가는 것 방지
      if (!s.assignee_member_id) continue
      const reached = await allPredecessorsReached(admin, item.project_id, s.depends ?? [])
      if (reached === null) {
        console.error(`[wbsAssign] 후행(${s.id}) 선행 완료 여부 확인 실패 — 발행 생략`)
        continue
      }
      if (!reached) continue
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
  const resolved = await resolveItemProjectId(itemId)
  if (!resolved.ok) return resolved
  const g = await requireProjectAdmin(resolved.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const loaded = await loadItem(itemId)
  if (!loaded.ok) return loaded
  const { item } = loaded
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

type TreeRow = { id: string; parent_id: string | null; name: string; assignee_member_id: string | null }

/**
 * 상위 배정 시 미지정 하위 항목에도 같은 담당자 일괄 적용 — 스테이징 실사용 피드백
 * (2026-08-11). 담당자는 노드 속성이라 상속·롤업이 없다는 원 설계(§2.5, 파일 상단 주석)는
 * 그대로 두고, "새로 배정"을 트리 단위로 한 번에 하는 편의 액션을 별도로 둔다 — 자동
 * 상속이 아니라 그 순간의 명시적 일괄 쓰기다.
 *
 * 본인 항목은 setWbsAssignee와 동일하게 항상 반영(단건 액션의 상위집합이어야 한다 —
 * 체크박스를 켰다고 본인 항목에 대한 배정 효과가 약해지면 안 된다). 하위 항목은
 * assignee_member_id 가 null 인 것만 갱신 — 이미 배정된 하위 항목은 손대지 않는다
 * (기존 배정을 조용히 덮어쓰지 않음).
 *
 * 하위 트리 조회는 프로젝트 전체 wbs_items 를 한 번에 읽어 메모리에서 부모→자식을
 * 구성한다(3원칙 ② — 이 단일 조회가 실패하면 갱신 없이 중단, 부분 적용 강행 금지).
 */
export async function setWbsAssigneeCascade(
  itemId: string, memberId: string,
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const resolved = await resolveItemProjectId(itemId)
  if (!resolved.ok) return resolved
  const g = await requireProjectAdmin(resolved.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!isUuidLike(memberId)) return { ok: false, error: '잘못된 요청입니다.' }

  const admin = createAdminClient()
  // 쓰기 선행조회 — 로스터 실재 + 프로젝트 일치(setWbsAssignee와 동일한 1차 방어선).
  const { data: mem, error: memErr } = await admin
    .from('project_members').select('id, project_id').eq('id', memberId).maybeSingle()
  if (memErr) return { ok: false, error: `멤버 조회 실패: ${memErr.message}` }
  if (!mem || (mem as { project_id: string }).project_id !== resolved.projectId) {
    return { ok: false, error: '이 프로젝트의 로스터 멤버가 아닙니다.' }
  }

  // 하위 트리 조회 실패 시 중단(3원칙 ②) — 부분 적용 강행 금지.
  const { data: allItems, error: treeErr } = await admin
    .from('wbs_items')
    .select('id, parent_id, name, assignee_member_id')
    .eq('project_id', resolved.projectId)
  if (treeErr) return { ok: false, error: `하위 항목 조회 실패: ${treeErr.message}` }
  const rows = (allItems ?? []) as TreeRow[]
  const byId = new Map(rows.map(r => [r.id, r]))
  const root = byId.get(itemId)
  if (!root) return { ok: false, error: '항목 없음' }

  const childrenOf = new Map<string, TreeRow[]>()
  const hasChildren = new Set<string>()
  for (const r of rows) {
    if (r.parent_id) {
      hasChildren.add(r.parent_id)
      const list = childrenOf.get(r.parent_id)
      if (list) list.push(r); else childrenOf.set(r.parent_id, [r])
    }
  }

  const subtree: TreeRow[] = []
  const stack: TreeRow[] = [root]
  while (stack.length > 0) {
    const cur = stack.pop() as TreeRow
    subtree.push(cur)
    for (const c of childrenOf.get(cur.id) ?? []) stack.push(c)
  }
  // 본인(itemId)은 값이 다를 때만(단건 액션과 동일한 no-op 판정), 하위는 미지정만.
  const targets = subtree.filter(r => (
    r.id === itemId ? r.assignee_member_id !== memberId : r.assignee_member_id === null
  ))
  if (targets.length === 0) return { ok: true, count: 0 }

  const targetIds = targets.map(r => r.id)
  const { data: updated, error: updErr } = await admin
    .from('wbs_items')
    .update({ assignee_member_id: memberId, updated_at: new Date().toISOString() })
    .in('id', targetIds)
    .select('id')
  if (updErr) return { ok: false, error: updErr.message }
  const count = updated?.length ?? 0
  if (count === 0) return { ok: true, count: 0 }

  revalidatePath(`/p/${resolved.projectId}`, 'layout')

  // 요약 알림 1건만 — 항목별 발행은 하위 트리가 큰 경우 스팸이 된다.
  const extra = count - 1
  const detail = extra > 0
    ? `'${root.name}' 외 ${extra}건의 작업 담당자로 지정되었습니다`
    : `'${root.name}' 작업 담당자로 지정되었습니다`
  await emitNotification({
    type: 'work.assigned',
    projectId: resolved.projectId,
    actorUserId: g.actor.userId,
    entityType: 'wbs_item',
    entityId: itemId,
    payload: { title: root.name, detail, href: `/p/${resolved.projectId}/wbs` },
    recipientMemberIds: [memberId],
  })

  // 새로 배정된 각 리프에 대해 자동 주문 발행 — 실패 격리(배정 성공은 유지, 로깅만).
  // 리프 판정은 이번에 읽은 전체 트리 기준(부모로 등장한 적 없는 항목 = 자식 없음).
  for (const target of targets) {
    if (hasChildren.has(target.id)) continue
    try {
      const orderRes = await ensureOrderForAssignedLeaf(admin, {
        projectId: resolved.projectId,
        wbsItemId: target.id,
        actorUserId: g.actor.userId,
      })
      if (!orderRes.ok) console.error('[wbsAssign] cascade 자동 주문 발행 실패:', orderRes.error)
    } catch (e) {
      console.error('[wbsAssign] cascade 자동 주문 발행 예외:', e)
    }
  }

  return { ok: true, count }
}

export async function setWbsStage(
  itemId: string, stage: 'todo' | 'as' | 'fp' | 'ip' | 'im' | 'xx' | null,
): Promise<{ ok: boolean; error?: string }> {
  if (stage !== null && !STAGES.has(stage)) return { ok: false, error: '허용되지 않는 단계입니다.' }
  const resolved = await resolveItemProjectId(itemId)
  if (!resolved.ok) return resolved
  const g = await requireProjectAdmin(resolved.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const loaded = await loadItem(itemId)
  if (!loaded.ok) return loaded
  const { item } = loaded
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
