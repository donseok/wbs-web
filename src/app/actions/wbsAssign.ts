'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { emitNotification } from '@/lib/notify/emit'
import { backfillProjectOrders, ensureAgentProject, ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'
import { REACHED_STAGES, notifySuccessorsOnReached, transitionStage } from '@/lib/agent/stageTransition'

/**
 * WBS 담당자(로스터 축)·단계(stage) 갱신 — §2.5. 배정 권한은 프로젝트 관리자.
 * 담당자는 노드 속성 — 하위 상속·롤업 없음. 배정 해제 시 활성 주문은 자동 취소하지 않는다(§2.8).
 *
 * 2026-08-13 stage 워크플로 재설계 — 'todo'는 NULL로 통합됐다(0082). dev_workflow=true 항목은
 * 배정↔as 자동 전이가 걸린다(transitionStage, 아래 setWbsAssignee/Cascade/setWbsDevWorkflow).
 */

const STAGES = new Set(['as', 'fp', 'ip', 'im', 'xx'])

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
  // 배정↔as 자동 전이(2026-08-13 재설계) — dev_workflow=false·이미 다른 stage면 transitionStage
  // 내부에서 no-op. 실패는 로깅만, 배정 결과(ok:true)는 유지한다(배정 성공에 종속된 오류 격리).
  try {
    const tr = memberId !== null
      ? await transitionStage(admin, { itemId, to: 'as', fromIn: [null], actorUserId: g.actor.userId })
      : await transitionStage(admin, { itemId, to: null, fromIn: ['as'], actorUserId: g.actor.userId })
    if (!tr.ok) console.error('[wbsAssign] 배정↔stage 전이 실패:', itemId)
  } catch (e) {
    console.error('[wbsAssign] 배정↔stage 전이 예외:', e)
  }
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
    // 유지한다(에러는 로깅만). ensureOrderForWorkflowLeaf 내부가 리프·게이트·멱등을 자체 처리한다.
    try {
      const orderRes = await ensureOrderForWorkflowLeaf(admin, {
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
 * 순회는 visited Set 으로 순환을 가드한다(parent_id 데이터 오류로 순환이 생겨도 무한루프 없음).
 *
 * 하위 항목의 실제 UPDATE 는 `.is('assignee_member_id', null)` 을 DB 조건으로 그대로
 * 실어 보낸다(리뷰 라운드 1 — TOCTOU) — 트리를 읽은 시점과 쓰는 시점 사이에 다른 관리자가
 * 먼저 배정했다면, 메모리상의 "미지정 후보" 판정이 낡았어도 이 조건이 그 행을 걸러내
 * 덮어쓰지 않는다. 실제로 몇 건이 바뀌었는지는 이 UPDATE 의 반환(select)으로만 집계한다 —
 * 사전 후보 목록 크기가 아니다. 본인 항목은 단건 액션과 동일한 무조건 갱신이라 이 조건에서
 * 제외하고 별도 UPDATE 로 처리한다.
 *
 * 요약 알림은 실제로 갱신된 항목이 1건 이상일 때만 발행하고(리뷰 라운드 1 — 귀속 오류),
 * 명칭·건수도 실제 갱신 결과 기준이다(본인이 갱신되지 않았으면 실제로 갱신된 첫 항목의
 * 이름을 쓴다).
 *
 * 본인 UPDATE 성공 후 하위 UPDATE 가 실패하면(리뷰 라운드 2 — 부분 커밋을 전체 실패로
 * 보고하는 회귀) 이미 DB 에 반영된 본인 쓰기를 없던 일로 위장하지 않는다(3원칙: 표시=로깅,
 * 커밋된 쓰기는 커밋된 대로 보고한다) — 로깅만 하고 `ok:true` 로 계속 진행해 본인 반영분
 * 기준으로 revalidate·알림·자동발행을 마치되, 응답에 `cascadeFailed:true` 를 실어 호출부가
 * "일부만 적용됐다"는 사실을 사용자에게 보여줄 수 있게 한다.
 */
export async function setWbsAssigneeCascade(
  itemId: string, memberId: string,
): Promise<{ ok: boolean; error?: string; count?: number; cascadeFailed?: boolean }> {
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
  const visited = new Set<string>()
  const stack: TreeRow[] = [root]
  while (stack.length > 0) {
    const cur = stack.pop() as TreeRow
    if (visited.has(cur.id)) continue
    visited.add(cur.id)
    subtree.push(cur)
    for (const c of childrenOf.get(cur.id) ?? []) {
      if (!visited.has(c.id)) stack.push(c)
    }
  }

  // 하위(본인 제외) 중 이번 읽기 시점에 미지정이었던 후보 — 실제 반영 여부는 아래 UPDATE의
  // .is('assignee_member_id', null) 조건이 쓰기 시점 기준으로 다시 판정한다.
  const descendantCandidateIds = subtree
    .filter(r => r.id !== itemId && r.assignee_member_id === null)
    .map(r => r.id)
  const rootNeedsUpdate = root.assignee_member_id !== memberId

  if (!rootNeedsUpdate && descendantCandidateIds.length === 0) return { ok: true, count: 0 }

  const nowIso = new Date().toISOString()
  const updatedIds: string[] = []

  // 본인 — 단건 액션(setWbsAssignee)과 동일한 무조건 갱신. 조건부 하위 UPDATE 와 분리한다.
  if (rootNeedsUpdate) {
    const { data: updatedRoot, error: rootErr } = await admin
      .from('wbs_items')
      .update({ assignee_member_id: memberId, updated_at: nowIso })
      .eq('id', itemId)
      .select('id')
    if (rootErr) return { ok: false, error: rootErr.message }
    for (const r of (updatedRoot ?? []) as { id: string }[]) updatedIds.push(r.id)
  }

  // 하위 — DB 조건(.is null)으로 TOCTOU 방어. 후보였지만 그 사이 다른 관리자가 먼저
  // 배정했다면 조건에 걸려 갱신되지 않고, 갱신 건수 집계에도 잡히지 않는다.
  // 이 UPDATE 자체가 실패해도(네트워크 등) 위에서 이미 커밋된 본인 UPDATE 를 없던 일로
  // 만들지 않는다 — 로깅만 하고 cascadeFailed 플래그로 이어간다(리뷰 라운드 2).
  let cascadeFailed = false
  if (descendantCandidateIds.length > 0) {
    const { data: updatedDesc, error: descErr } = await admin
      .from('wbs_items')
      .update({ assignee_member_id: memberId, updated_at: nowIso })
      .in('id', descendantCandidateIds)
      .is('assignee_member_id', null)
      .select('id')
    if (descErr) {
      console.error('[wbsAssign] cascade 하위 UPDATE 실패 — 본인 반영분만 확정:', descErr.message)
      cascadeFailed = true
    } else {
      for (const r of (updatedDesc ?? []) as { id: string }[]) updatedIds.push(r.id)
    }
  }

  const count = updatedIds.length
  if (count === 0) return { ok: true, count: 0, ...(cascadeFailed ? { cascadeFailed: true } : {}) }

  revalidatePath(`/p/${resolved.projectId}`, 'layout')

  // 요약 알림 1건만, 실제로 갱신된 항목이 있을 때만 — 명칭·건수도 실제 갱신 기준.
  // 본인이 갱신 대상에 없으면(이미 같은 담당자 등) 실제로 갱신된 첫 항목의 이름을 쓴다.
  const titleItemId = updatedIds.includes(itemId) ? itemId : updatedIds[0]
  const titleItem = byId.get(titleItemId)
  const titleName = titleItem?.name ?? ''
  const extra = count - 1
  const detail = extra > 0
    ? `'${titleName}' 외 ${extra}건의 작업 담당자로 지정되었습니다`
    : `'${titleName}' 작업 담당자로 지정되었습니다`
  await emitNotification({
    type: 'work.assigned',
    projectId: resolved.projectId,
    actorUserId: g.actor.userId,
    entityType: 'wbs_item',
    entityId: titleItemId,
    payload: { title: titleName, detail, href: `/p/${resolved.projectId}/wbs` },
    recipientMemberIds: [memberId],
  })

  // 배정↔as 자동 전이(2026-08-13 재설계) — 실제 갱신된 항목 전부가 대상이다(하위는 원래
  // 미지정→새 배정이므로 리프 여부와 무관). dev_workflow·현재 stage 검사는 transitionStage
  // 내부가 맡는다. 실패는 로깅만, cascade 결과에는 영향을 주지 않는다.
  for (const id of updatedIds) {
    try {
      const tr = await transitionStage(admin, { itemId: id, to: 'as', fromIn: [null], actorUserId: g.actor.userId })
      if (!tr.ok) console.error('[wbsAssign] cascade 배정↔stage 전이 실패:', id)
    } catch (e) {
      console.error('[wbsAssign] cascade 배정↔stage 전이 예외:', e)
    }
  }

  // 새로 배정된 각 리프에 대해 자동 주문 발행 — 실패 격리(배정 성공은 유지, 로깅만).
  // 리프 판정은 이번에 읽은 전체 트리 기준(부모로 등장한 적 없는 항목 = 자식 없음).
  // 대상은 실제로 갱신된 항목만(TOCTOU 조건에 걸려 갱신되지 않은 후보는 제외).
  for (const id of updatedIds) {
    if (hasChildren.has(id)) continue
    try {
      const orderRes = await ensureOrderForWorkflowLeaf(admin, {
        projectId: resolved.projectId,
        wbsItemId: id,
        actorUserId: g.actor.userId,
      })
      if (!orderRes.ok) console.error('[wbsAssign] cascade 자동 주문 발행 실패:', orderRes.error)
    } catch (e) {
      console.error('[wbsAssign] cascade 자동 주문 발행 예외:', e)
    }
  }

  return { ok: true, count, ...(cascadeFailed ? { cascadeFailed: true } : {}) }
}

export async function setWbsStage(
  itemId: string, stage: 'as' | 'fp' | 'ip' | 'im' | 'xx' | null,
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
  // 리프 게이트 — 개발 워크플로 단계는 최종단계(자식 없는 항목)의 것이다. 해제(null)는 막지 않는다:
  // 이미 잘못 찍힌 상위 항목의 값을 지울 길이 이 드롭다운뿐이다.
  if (stage !== null) {
    const { data: child, error: childErr } = await admin
      .from('wbs_items').select('id').eq('parent_id', itemId).limit(1).maybeSingle()
    if (childErr) return { ok: false, error: `하위 항목 확인 실패: ${childErr.message}` }
    if (child) return { ok: false, error: '하위 항목이 있습니다 — 개발 워크플로 단계는 최종단계에만 지정합니다.' }
  }
  const { data: cur, error: curErr } = await admin
    .from('wbs_items').select('stage').eq('id', itemId).maybeSingle()
  if (curErr) return { ok: false, error: `단계 조회 실패: ${curErr.message}` }
  const oldStage = (cur as { stage: string | null } | null)?.stage ?? null
  if (oldStage === stage) return { ok: true }
  // 완료(xx) 직행 차단 — 이 드롭다운은 dev_workflow·agent_work_orders 를 전혀 안 보는 경로라,
  // claimed/reported 인 활성 에이전트 주문이 있는 상태에서 xx 를 고르면 겉보기엔 승인된 것처럼
  // 보이는데 주문은 그대로 남아 후속 작업 선행 게이트가 안 풀린다(2026-08-25 mes-runlog 리허설
  // 실측 — 승인 버튼을 안 거치고 이 드롭다운으로 "완료"를 골라 발생). 완료는 승인 버튼으로만.
  if (stage === 'xx') {
    const { data: activeOrder, error: orderErr } = await admin
      .from('agent_work_orders').select('id').eq('wbs_item_id', itemId)
      .in('status', ['claimed', 'reported']).limit(1).maybeSingle()
    if (orderErr) return { ok: false, error: `에이전트 주문 확인 실패: ${orderErr.message}` }
    if (activeOrder) {
      return {
        ok: false,
        error: '이 항목에 진행 중인 에이전트 주문이 있습니다 — 완료 처리는 "진행 상황"의 승인 버튼으로 하세요.',
      }
    }
  }
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

type DevWorkflowUpdatedRow = { id: string; assignee_member_id: string | null; stage: string | null }

/**
 * dev_workflow 토글(2026-08-13 재설계) — 개발 워크플로 도입 여부(NULL 진입점)를 켜고 끈다.
 * cascade=false 는 본인 1건만, cascade=true 는 setWbsAssigneeCascade 와 동일한 트리 로드·순회
 * 패턴으로 서브트리 전체를 일괄 갱신한다(방향 무관 — enabled 값으로 통일, 트리 조회 실패 시
 * 중단해 부분 적용을 막는다 — 3원칙 ②).
 *
 * count 는 "실제로 바뀐" 행 수다 — UPDATE 에 `.neq('dev_workflow', enabled)` 를 DB 조건으로
 * 실어 보내 반환(select)으로만 집계한다(setWbsAssigneeCascade 의 TOCTOU 방어와 같은 이유:
 * 이미 같은 값인 행을 건드렸다고 보고하지 않는다).
 *
 * change_logs 는 루트 1건만 남긴다(일괄 이력 폭주 방지) — old/new 는 문자열 'false'/'true'.
 * `.neq` 필터를 통과한 행은 전부 이전 값이 `!enabled` 였다는 뜻이라 방향에 관계없이 도출된다.
 *
 * ON 후처리(enabled=true): 갱신된 항목 중 리프(트리에서 자식으로 등장한 적 없는 항목)에만
 * (a) 담당자가 있고 stage 가 NULL 이면 transitionStage 로 as 전이, (b) ensureOrderForWorkflowLeaf
 * 로 자동 주문 발행 — 부모 노드는 대상이 아니다(주문·초기 착수는 리프 개념이라 setWbsAssigneeCascade
 * 의 배정 전이와 달리 여기는 리프로 제한한다). 실패는 로깅만.
 *
 * OFF 후처리(enabled=false): 갱신된 항목들의 활성 주문 중 `ready` 만 `cancelled` 로 일괄 전환한다
 * (claimed/reported 는 건드리지 않는다 — 진행 중인 작업을 강제 중단하지 않는다, §2.8 취지 연장).
 * 이 UPDATE 실패는 로깅 + `cascadeFailed:true` 로 알린다(본 토글 자체는 이미 커밋됐으므로 위장하지
 * 않는다 — cascade 부분 실패를 전체 실패로 보고하지 않는 setWbsAssigneeCascade 와 동일한 원칙).
 */
export async function setWbsDevWorkflow(
  itemId: string, enabled: boolean, cascade: boolean,
): Promise<{ ok: boolean; error?: string; count?: number; cascadeFailed?: boolean }> {
  const resolved = await resolveItemProjectId(itemId)
  if (!resolved.ok) return resolved
  const g = await requireProjectAdmin(resolved.projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  const updatedIds: string[] = []
  const hasChildren = new Set<string>()
  const infoById = new Map<string, DevWorkflowUpdatedRow>()

  if (!cascade) {
    const { data: updated, error } = await admin
      .from('wbs_items')
      .update({ dev_workflow: enabled, updated_at: nowIso })
      .eq('id', itemId)
      .neq('dev_workflow', enabled)
      .select('id, assignee_member_id, stage')
    if (error) return { ok: false, error: error.message }
    for (const r of (updated ?? []) as DevWorkflowUpdatedRow[]) {
      updatedIds.push(r.id)
      infoById.set(r.id, r)
    }
    if (updatedIds.length > 0) {
      // 리프 판정 — 단건은 자식 존재 여부만 확인(ensureOrderForWorkflowLeaf 내부 검증과 동일 질의).
      // 조회 실패 시 리프로 간주하지 않는다(fail-open 금지, 3원칙 ② — 판정 불가면 as 전이
      // 같은 쓰기를 강행하지 않는다) — hasChildren 에 넣어 이 항목의 ON 후처리를 건너뛴다.
      const { data: child, error: childErr } = await admin
        .from('wbs_items').select('id').eq('parent_id', itemId).limit(1).maybeSingle()
      if (childErr) {
        console.error('[wbsAssign] dev_workflow 리프 판정 실패:', childErr.message)
        hasChildren.add(itemId)
      } else if (child) hasChildren.add(itemId)
    }
  } else {
    // 하위 트리 조회 실패 시 중단(3원칙 ②) — setWbsAssigneeCascade 와 동일한 패턴.
    const { data: allItems, error: treeErr } = await admin
      .from('wbs_items')
      .select('id, parent_id')
      .eq('project_id', resolved.projectId)
    if (treeErr) return { ok: false, error: `하위 항목 조회 실패: ${treeErr.message}` }
    const rows = (allItems ?? []) as { id: string; parent_id: string | null }[]
    const byId = new Map(rows.map(r => [r.id, r]))
    const root = byId.get(itemId)
    if (!root) return { ok: false, error: '항목 없음' }

    const childrenOf = new Map<string, typeof rows>()
    for (const r of rows) {
      if (r.parent_id) {
        hasChildren.add(r.parent_id)
        const list = childrenOf.get(r.parent_id)
        if (list) list.push(r); else childrenOf.set(r.parent_id, [r])
      }
    }

    const subtreeIds: string[] = []
    const visited = new Set<string>()
    const stack = [root]
    while (stack.length > 0) {
      const cur = stack.pop() as typeof root
      if (visited.has(cur.id)) continue
      visited.add(cur.id)
      subtreeIds.push(cur.id)
      for (const c of childrenOf.get(cur.id) ?? []) {
        if (!visited.has(c.id)) stack.push(c)
      }
    }

    const { data: updated, error: updErr } = await admin
      .from('wbs_items')
      .update({ dev_workflow: enabled, updated_at: nowIso })
      .in('id', subtreeIds)
      .neq('dev_workflow', enabled)
      .select('id, assignee_member_id, stage')
    if (updErr) return { ok: false, error: updErr.message }
    for (const r of (updated ?? []) as DevWorkflowUpdatedRow[]) {
      updatedIds.push(r.id)
      infoById.set(r.id, r)
    }
  }

  const count = updatedIds.length
  if (count === 0) return { ok: true, count: 0 }

  // change_logs — 루트 1건만(일괄 이력 폭주 방지). .neq 를 통과한 행은 전부 이전 값이
  // !enabled 였다는 뜻이라 방향에 관계없이 old/new 를 이렇게 도출할 수 있다.
  const { error: logErr } = await admin.from('change_logs').insert({
    user_id: g.actor.userId, wbs_item_id: itemId, field: 'dev_workflow',
    old_value: enabled ? 'false' : 'true', new_value: enabled ? 'true' : 'false',
  })
  if (logErr) console.error('[wbsAssign] dev_workflow 변경 이력 기록 실패:', logErr.message)

  revalidatePath(`/p/${resolved.projectId}`, 'layout')

  let cascadeFailed = false

  if (enabled) {
    // 프로젝트 자동 활성(2026-08-24) — dev_workflow ON 도 "에이전트에게 일을 시키는 행위"다. 처음 활성이면
    // 백필이 이 프로젝트의 dev_workflow 리프 전부(방금 켠 것 포함)에 주문을 보장한다. 실패는 로깅만.
    try {
      const proj = await ensureAgentProject(admin, { projectId: resolved.projectId, actorUserId: g.actor.userId })
      if (!proj.ok) console.error('[wbsAssign] dev_workflow ON 프로젝트 활성 실패:', proj.error)
      else if (proj.activated) {
        const bf = await backfillProjectOrders(admin, { projectId: resolved.projectId, actorUserId: g.actor.userId })
        if (!bf.ok) console.error('[wbsAssign] 백필 실패:', bf.error)
      }
    } catch (e) {
      console.error('[wbsAssign] dev_workflow ON 프로젝트 활성 예외:', e)
    }
    // ON — 리프에만 초기 as 전이 + 자동 주문 발행. 실패는 로깅만(본 토글 결과는 유지).
    for (const id of updatedIds) {
      if (hasChildren.has(id)) continue
      const info = infoById.get(id)
      if (info?.assignee_member_id && info.stage === null) {
        try {
          const tr = await transitionStage(admin, { itemId: id, to: 'as', fromIn: [null], actorUserId: g.actor.userId })
          if (!tr.ok) console.error('[wbsAssign] dev_workflow ON stage 전이 실패:', id)
        } catch (e) {
          console.error('[wbsAssign] dev_workflow ON stage 전이 예외:', e)
        }
      }
      try {
        const orderRes = await ensureOrderForWorkflowLeaf(admin, {
          projectId: resolved.projectId, wbsItemId: id, actorUserId: g.actor.userId,
        })
        if (!orderRes.ok) console.error('[wbsAssign] dev_workflow ON 자동 주문 발행 실패:', orderRes.error)
      } catch (e) {
        console.error('[wbsAssign] dev_workflow ON 자동 주문 발행 예외:', e)
      }
    }
  } else {
    // OFF — 갱신된 항목들의 ready 주문만 일괄 취소(claimed/reported 는 진행 중이라 건드리지 않음).
    const { error: cancelErr } = await admin
      .from('agent_work_orders')
      .update({ status: 'cancelled', updated_at: nowIso })
      .in('wbs_item_id', updatedIds)
      .eq('status', 'ready')
    if (cancelErr) {
      console.error('[wbsAssign] dev_workflow OFF 주문 취소 실패:', cancelErr.message)
      cascadeFailed = true
    }
  }

  return { ok: true, count, ...(cascadeFailed ? { cascadeFailed: true } : {}) }
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
): Promise<{ assigneeMemberId: string | null; stage: string | null; devWorkflow: boolean } | null> {
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
    .from('wbs_items').select('assignee_member_id, stage, dev_workflow').eq('id', itemId).maybeSingle()
  if (error) {
    console.error('[getWbsAssigneeStage] 조회 실패:', error.message)
    return null
  }
  if (!data) return null
  const row = data as { assignee_member_id: string | null; stage: string | null; dev_workflow: boolean | null }
  return {
    assigneeMemberId: row.assignee_member_id ?? null,
    stage: row.stage ?? null,
    devWorkflow: row.dev_workflow === true,
  }
}
