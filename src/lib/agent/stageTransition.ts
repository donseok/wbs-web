import type { AdminClient } from '@/lib/minutes/externalApi'
import { emitNotification } from '@/lib/notify/emit'

/** WBS Task 단계(§2.5) — dev_workflow=true 항목의 자동 전이 대상. 미지정은 'todo' 문자열이 아니라 null(0082). */
export type WbsStage = 'as' | 'fp' | 'ip' | 'im' | 'xx'

const REACHED_STAGES_LIST = ['im', 'xx'] as const
/** stage 가 "완료 도달"로 간주되는 값 — §2.10 알림·claim 게이트(stageAtLeast) 판정 축. */
export const REACHED_STAGES: Set<string> = new Set(REACHED_STAGES_LIST)

type StageItem = { id: string; project_id: string; name: string; external_ref: string | null }

/**
 * 후행의 depends 전체가 im/xx 에 도달했는지 확인 — §2.10 알림 의미("착수 가능")와 T15 claim
 * 게이트(depends 전부 stage ≥ im 이어야 통과)를 맞춘다. 선행 하나 도달마다 발행하면 depends
 * 가 여러 개인 후행에게 아직 착수 불가한데 "착수 가능합니다" 라는 거짓 알림이 나간다.
 * 조회 실패·일부 선행 미발견은 fail-closed(false 취급) — 호출부가 발행을 생략한다.
 */
async function allPredecessorsReached(
  admin: AdminClient,
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
 * 도달하는 순간 1회만 발행된다. 조회·발행 실패는 로깅만 하고 삼킨다 — transitionStage 의
 * 반환값(ok:true)에 영향을 주지 않는다.
 */
export async function notifySuccessorsOnReached(
  admin: AdminClient,
  item: StageItem,
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
      console.error('[stageTransition] 후행 리프 조회 실패:', error.message)
      return
    }
    type Successor = { id: string; name: string; assignee_member_id: string | null; depends: string[] | null }
    for (const s of (successors ?? []) as Successor[]) {
      if (s.id === item.id) continue // 자기 참조 — 방금 갱신된 자신의 stage로 게이트를 통과해 본인에게 알림 가는 것 방지
      if (!s.assignee_member_id) continue
      const reached = await allPredecessorsReached(admin, item.project_id, s.depends ?? [])
      if (reached === null) {
        console.error(`[stageTransition] 후행(${s.id}) 선행 완료 여부 확인 실패 — 발행 생략`)
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
    console.error('[stageTransition] 후행 리프 unblocked 발행 예외:', e)
  }
}

/**
 * dev_workflow=true 항목의 stage 를 조건부로 전이시키고 change_logs 를 남긴다 — Task 워크플로
 * 재설계의 공용 전이부(배정↔as, claim/report/승인 전이가 모두 이 함수를 통한다).
 * dev_workflow 게이트를 호출부가 아니라 여기서 판정하는 이유: 호출부(배정·claim·report·승인)
 * 마다 게이트를 반복 구현하면 하나라도 빠뜨렸을 때 dev_workflow=false 항목이 자동 전이된다.
 *
 * 동작 순서(고정):
 *  1. wbs_items 조회. 실패/없음 → { ok:false, transitioned:false } + 로깅(3원칙 — 위장 금지).
 *  2. dev_workflow !== true → { ok:true, transitioned:false }(무간섭).
 *  3. fromIn 이 주어졌는데 현재 stage 가 그 밖 → { ok:true, transitioned:false }(no-op).
 *  4. 현재 stage === to → { ok:true, transitioned:false }(no-op).
 *  5. UPDATE(stage, updated_at) + change_logs insert(field='stage'). change_logs 실패는 로깅만.
 *  6. old 가 im/xx 아님 && to 가 im/xx → notifySuccessorsOnReached 호출("처음 도달"에서만).
 *
 * 실패(1·5의 UPDATE)는 로깅만 하고 { ok:false } — 호출부 본 로직(claim·report·승인)을 깨지
 * 않는다. 호출부는 이 반환값으로 자기 응답을 좌우하지 않고 실패를 로깅만 하는 것이 원칙이다.
 */
export async function transitionStage(
  admin: AdminClient,
  args: {
    itemId: string
    to: WbsStage | null
    fromIn?: ReadonlyArray<WbsStage | null>
    actorUserId: string
  },
): Promise<{ ok: boolean; transitioned: boolean }> {
  const { itemId, to, fromIn, actorUserId } = args

  const { data, error } = await admin
    .from('wbs_items')
    .select('id, project_id, name, external_ref, stage, dev_workflow')
    .eq('id', itemId)
    .maybeSingle()
  if (error) {
    console.error('[stageTransition] 항목 조회 실패:', error.message)
    return { ok: false, transitioned: false }
  }
  if (!data) {
    console.error('[stageTransition] 항목 없음:', itemId)
    return { ok: false, transitioned: false }
  }
  const item = data as {
    id: string; project_id: string; name: string; external_ref: string | null
    stage: string | null; dev_workflow: boolean | null
  }

  if (item.dev_workflow !== true) return { ok: true, transitioned: false }

  const oldStage = item.stage as WbsStage | null
  if (fromIn && !fromIn.includes(oldStage)) return { ok: true, transitioned: false }
  if (oldStage === to) return { ok: true, transitioned: false }

  // CAS — 조회 이후 다른 경로가 먼저 stage 를 바꿨으면 이 UPDATE 는 0행이어야 한다(경합에서 짐).
  const updateQuery = admin
    .from('wbs_items')
    .update({ stage: to, updated_at: new Date().toISOString() })
    .eq('id', itemId)
  const { data: updated, error: updateErr } = await (
    oldStage === null ? updateQuery.is('stage', null) : updateQuery.eq('stage', oldStage)
  ).select('id')
  if (updateErr) {
    console.error('[stageTransition] stage 갱신 실패:', updateErr.message)
    return { ok: false, transitioned: false }
  }
  if (!updated || (updated as unknown[]).length === 0) {
    // 경합에서 짐 — 에러가 아니다. 로그 없이 no-op(F4, 최종 리뷰).
    return { ok: true, transitioned: false }
  }

  const { error: logErr } = await admin.from('change_logs').insert({
    user_id: actorUserId, wbs_item_id: itemId, field: 'stage',
    old_value: oldStage, new_value: to,
  })
  if (logErr) console.error('[stageTransition] 단계 변경 이력 기록 실패:', logErr.message)

  // §2.10 — im/xx 에 "처음" 도달할 때만(역전이·재설정은 위 oldStage === to 조기 반환과 이
  // 조건으로 모두 제외된다). 본 함수 반환값에는 영향을 주지 않는다.
  if (!REACHED_STAGES.has(oldStage ?? '') && to !== null && REACHED_STAGES.has(to)) {
    await notifySuccessorsOnReached(admin, {
      id: item.id, project_id: item.project_id, name: item.name, external_ref: item.external_ref,
    }, actorUserId)
  }

  return { ok: true, transitioned: true }
}
