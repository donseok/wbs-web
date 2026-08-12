import type { AdminClient } from '@/lib/minutes/externalApi'
import { orderPriorityFromLabel } from '@/lib/domain/agentWork'
import { emitNotification } from '@/lib/notify/emit'

/**
 * §2.8 재정의(2026-08-13): dev_workflow ON 인 리프에는 주문이 존재한다 — 배정은 조건이 아니다.
 * 멱등: 활성 주문(ready/claimed/reported) 부분 유니크(0077)가 DB 보증, 여기는 선행조회 + 23505 수렴.
 * 발행 조건은 기존 가드 그대로: agent_projects.enabled · 리프 · 호출부가 관리자 권한 경로.
 */
export async function ensureOrderForWorkflowLeaf(
  admin: AdminClient,
  args: { projectId: string; wbsItemId: string; actorUserId: string; instructions?: string },
): Promise<
  | { ok: true; created: boolean; reason?: 'not_agent_project' | 'not_leaf' | 'active_exists' | 'not_workflow' }
  | { ok: false; error: string }
> {
  const { projectId, wbsItemId, actorUserId } = args

  // Step 1: agent_projects 게이트 — enabled = true 만 발행
  const { data: reg, error: regErr } = await admin
    .from('agent_projects')
    .select('enabled')
    .eq('project_id', projectId)
    .maybeSingle()
  if (regErr) return { ok: false, error: `등록 조회 실패: ${regErr.message}` }
  if (!reg || (reg as { enabled: boolean }).enabled !== true) {
    return { ok: true, created: false, reason: 'not_agent_project' }
  }

  // Step 2: 항목 조회 — priority 라벨과 설명 정보, 담당자 ID, dev_workflow 게이트.
  // 주문 priority = 항목 priority 라벨의 정수 매핑(계약 v2.0: critical=100/high=50/medium=10/low=0).
  // 수용 기준은 주문에 복제하지 않는다 — 정본은 wbs_items.acceptance jsonb 이고 claim/show 응답이 실어 나른다(결정 B).
  const { data: item, error: itemErr } = await admin
    .from('wbs_items')
    .select('name, priority, external_ref, assignee_member_id, dev_workflow')
    .eq('id', wbsItemId)
    .maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  const row = item as
    | {
        name: string
        priority: string | null
        external_ref: string | null
        assignee_member_id: string | null
        dev_workflow: boolean | null
      }
    | null
  if (row?.dev_workflow !== true) {
    return { ok: true, created: false, reason: 'not_workflow' }
  }

  // Step 3: 리프 검증 — 자식 없어야 함
  const { data: child, error: childErr } = await admin
    .from('wbs_items')
    .select('id')
    .eq('parent_id', wbsItemId)
    .limit(1)
    .maybeSingle()
  if (childErr) return { ok: false, error: `하위 항목 확인 실패: ${childErr.message}` }
  if (child) return { ok: true, created: false, reason: 'not_leaf' }

  // Step 4: 활성 주문 확인 — ready/claimed/reported 상태의 주문 존재 확인
  const { data: active, error: activeErr } = await admin
    .from('agent_work_orders')
    .select('id')
    .eq('wbs_item_id', wbsItemId)
    .in('status', ['ready', 'claimed', 'reported'])
    .limit(1)
    .maybeSingle()
  if (activeErr) return { ok: false, error: `활성 주문 확인 실패: ${activeErr.message}` }
  if (active) return { ok: true, created: false, reason: 'active_exists' }

  // Step 5: 주문 발행 시도
  const { data: orderData, error } = await admin
    .from('agent_work_orders')
    .insert({
      project_id: projectId,
      wbs_item_id: wbsItemId,
      instructions: args.instructions?.trim() || (row ? `${row.external_ref ?? ''} ${row.name}`.trim() : ''),
      priority: orderPriorityFromLabel(row?.priority ?? null),
      created_by: actorUserId,
    })
    .select('id')
    .single()

  if (error) {
    // 부분 유니크 경합 — 다른 트리거가 먼저 발행했다. 멱등 no-op.
    if ((error as { code?: string }).code === '23505') {
      return { ok: true, created: false, reason: 'active_exists' }
    }
    return { ok: false, error: error.message }
  }

  // 실제 생성 성공 — 알림 발행 (fire-and-forget, 본 로직 실패로 이어지지 않음)
  const orderId = (orderData as { id: string }).id
  if (row?.assignee_member_id) {
    emitNotification({
      type: 'work.order_created',
      projectId,
      entityType: 'agent_order',
      entityId: orderId,
      payload: {
        title: row.name,
        detail: '작업 주문이 발행되었습니다',
        href: `/p/${projectId}/wbs`,
      },
      recipientMemberIds: [row.assignee_member_id],
      dedupeKey: `order_created:${wbsItemId}:${orderId}`,
    }).catch(() => {
      // 알림 실패는 로깅만 하고 본 로직에 영향을 주지 않음
    })
  }

  return { ok: true, created: true }
}
