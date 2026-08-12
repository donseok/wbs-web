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

  // 새로 배정된 각 리프에 대해 자동 주문 발행 — 실패 격리(배정 성공은 유지, 로깅만).
  // 리프 판정은 이번에 읽은 전체 트리 기준(부모로 등장한 적 없는 항목 = 자식 없음).
  // 대상은 실제로 갱신된 항목만(TOCTOU 조건에 걸려 갱신되지 않은 후보는 제외).
  for (const id of updatedIds) {
    if (hasChildren.has(id)) continue
    try {
      const orderRes = await ensureOrderForAssignedLeaf(admin, {
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
