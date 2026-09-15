// 선행 도달 알림(§2.10) — 단계 전이 자체는 원자 전이 RPC(0096, src/lib/agent/workflowEvent.ts)가 한다.
import type { AdminClient } from '@/lib/minutes/externalApi'
import { emitNotification } from '@/lib/notify/emit'
import { predecessorReached } from '@/lib/domain/agentWork'

type StageItem = { id: string; project_id: string; name: string; external_ref: string | null }

/**
 * 후행의 depends 전체가 충족(predecessorReached — im·xx 또는 실적 100, 스펙 2026-09-15 §3.7)됐는지 확인 — §2.10 알림 의미("착수 가능")와 T15 claim
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
    .select('external_ref, stage, actual_pct')
    .eq('project_id', projectId)
    .in('external_ref', dependsRefs)
  if (error) return null
  const rows = (data ?? []) as { external_ref: string; stage: string | null; actual_pct: number | string | null }[]
  // dependsRefs 에 중복 external_ref 가 있으면 .in() 은 실제 존재 행만 반환해 항상 짧다 —
  // 배열 길이가 아니라 고유 개수로 비교해야 정상 depends 에서도 영구 미충족이 되지 않는다.
  if (rows.length < new Set(dependsRefs).size) return false // 일부 선행 미발견 — fail-closed
  return rows.every(r => predecessorReached({ stage: r.stage, actualPct: r.actual_pct == null ? null : Number(r.actual_pct) }))
}

/**
 * 부록 §2.10 — "stage 가 im 이상에 도달 시" depends 역참조로 후행 리프 담당자에게
 * work.unblocked 발행. 단계는 원자 전이 RPC(apply_workflow_event)가 쓰고, 그 결과의 reachedFirst 를 본
 * 호출부(workflowEvent.notifyOnReached)가 이 함수를 부른다.
 * 발행은 후행의 depends 전부가 충족(predecessorReached)됐을 때만 — 다중 depends 후행은 마지막 선행이
 * 충족되는 순간 1회만 발행된다. 조회·발행 실패는 로깅만 하고 삼킨다 — 호출부 결과에 영향을 주지 않는다.
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
