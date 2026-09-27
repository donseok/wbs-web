import type { AdminClient } from '@/lib/minutes/externalApi'
import { notifySuccessorsOnReached } from '@/lib/agent/stageTransition'

/**
 * 원자 전이 RPC apply_workflow_event 의 앱 층 입구(스펙 2026-09-15 §4, 마이그레이션 0096). 주문 CAS·단계·
 * 실적 크레딧·change_logs 는 DB 트랜잭션 하나가 한다 — 여기서는 인자 매핑·결과 파싱·사유 문구만 맡는다.
 * 호출부는 성공 뒤 actualChanged 면 진척 스냅샷을, reachedFirst 면 notifyOnReached 를 부른다(둘 다 실패는 로깅만).
 */
export type WorkflowEvent =
  | 'assign' | 'unassign' | 'claim' | 'report_completion' | 'approve' | 'unapprove' | 'reject' | 'rework' | 'release' | 'set_stage'
  /** 설계 끝 → 구현 시작(0107·0108) — ds·dd 일 때만 ip, ip 이상이면 무변경. 주문 status 는 claimed 그대로, runner 를 적는다. */
  | 'build_start'
  /** 설계 완료(0108) — ds → dd, review 방식·design 범위면 설계 상태 review 로 두고 runner 를 비운다. */
  | 'design_done'
  /** ① 「설계 승인」(claimed·review·dd → accepted, claim_scope build) ② 「설계 확정」(ready·human → dd·accepted). */
  | 'design_accept'
  /** 「설계 되돌리기」·워커의 되돌림 — human 은 사람 설계 대기(as), 그 밖은 review. 사유를 design_note 에. */
  | 'design_reopen'
  /** D14 공용 취소 — ready·claimed → cancelled. claimed 이거나 단계 dd 면 as 로. prev_status 를 돌려준다. */
  | 'cancel'
  /** 설계 방식 변경(항목 사건) — 설계 상태가 있거나 claimed·reported·approved 주문이 있으면 design_mode_locked. */
  | 'set_design_mode'

export type WorkflowEventArgs = {
  event: WorkflowEvent
  actorUserId: string
  /** assign·unassign·set_stage·set_design_mode 필수. 주문 사건은 생략한다(주문의 wbs_item_id 를 쓴다). */
  itemId?: string | null
  orderId?: string | null
  /** set_stage 의 목표 단계. claim(legacy)에서는 null(종전 ip) 또는 'ds'(설계 선행, 0107). */
  stage?: string | null
  /** claim 은 기록, report_completion·release·build_start·design_done 은 점유자 일치 조건. 사람 사건은 null. */
  agent?: string | null
  agentUserId?: string | null
  /** claim: full·design·build(없으면 legacy) / build_start: full·build·rework(없으면 legacy) — 0108. */
  scope?: string | null
  /** 라우트가 읽은 값 CAS(P1) — 키가 있으면 같아야 한다. null 값은 "없음". 키는 0108 RPC 가 보는 다섯뿐이다(오타가 CAS 를 조용히 빼지 않게). */
  cas?: WorkflowCas | null
  /** design_reopen 의 사유. */
  note?: string | null
  /** set_design_mode 의 목표 방식. */
  mode?: string | null
  /** claim·build_start·design_done 이 도는 PC 로 적을 호출 라벨(D25). */
  runner?: string | null
}

/** 0108 apply_workflow_event 의 p_cas 가 보는 키(최종 수정 A6) — 그 밖의 키는 RPC 가 무시해 CAS 가 조용히 빠진다. */
export type WorkflowCas = Partial<Record<'design_state' | 'design_mode' | 'claim_scope' | 'runner' | 'runner_seen_at', string | null>>

export type WorkflowSkipped = 'parent' | 'not_workflow' | 'stage' | 'no_item'
export type WorkflowEventOk = {
  ok: true; orderStatus: string | null; stage: string | null; actualPct: number | null
  stageChanged: boolean; actualChanged: boolean; reachedFirst: boolean; skipped: WorkflowSkipped | null
  /** 주문 사건의 직전 status(0108) — cancel 이 워커가 돌던 주문이었는지(claimed) 호출부가 본다. */
  prevStatus: string | null
  /** 주문 사건 뒤 설계 상태(0108). */
  designState: string | null
  /** set_design_mode 가 실제로 바꿨는가. */
  designModeChanged: boolean
}
export type WorkflowEventFail = { ok: false; conflict: boolean; reason: string; orderStatus: string | null; error: string }

/** RPC 실패 사유 → 사람 문구. 모르는 사유는 코드 그대로 드러낸다(표시 = 로깅). */
export const REASON_TEXT: Record<string, string> = {
  conflict: '상태가 바뀌어 처리하지 못했습니다. 다시 시도하세요.',
  locked: '에이전트에 위임된 작업입니다. 단계는 승인·반려로 바뀝니다. 직접 바꾸려면 위임을 끄세요.',
  not_workflow: '개발 워크플로 대상이 아닌 항목입니다.',
  parent: '하위 항목이 있습니다 — 개발 워크플로 단계는 최종단계에만 지정합니다.',
  item_required: '항목이 필요한 사건입니다.',
  item_not_found: '항목 없음',
  order_required: '주문이 필요한 사건입니다.',
  order_not_found: '주문 없음',
  order_item_mismatch: '주문의 항목이 다릅니다.',
  bad_event: '알 수 없는 사건입니다.',
  bad_stage: '허용되지 않는 단계입니다. 설계 완료(dd)는 「설계 확정」·「설계 승인」으로만 생깁니다.',
  bad_scope: '허용되지 않는 범위입니다.',
  bad_mode: '허용되지 않는 설계 방식입니다.',
  design_gate: '설계 상태 때문에 처리할 수 없습니다. 화면의 설계 상태 안내를 확인하세요.',
  design_mode_locked: '설계가 확정·검토 중이거나 에이전트가 작업 중이라 설계 방식을 바꿀 수 없습니다.',
  stub_pending: '스텁이 남아 있어 승인할 수 없습니다 — 스텁 제거 작업을 먼저 끝내세요.',
}

/** 주문 사건이 단계·실적을 건너뛴 사유 — 사람이 할 일이 달라 warning 으로 드러낸다. */
export const SKIPPED_WARN: Record<WorkflowSkipped, string> = {
  parent: '처리는 됐지만 이 항목에 하위 항목이 있어 단계·실적을 바꾸지 않았습니다 — 개발 워크플로 단계는 최종단계의 것입니다. 주문이 상위 항목에 나간 경위를 확인하세요.',
  no_item: '처리는 됐지만 WBS 항목이 삭제된 주문이라 단계·실적을 바꾸지 않았습니다.',
  not_workflow: '처리는 됐지만 개발 워크플로 대상이 아니라 단계·실적을 바꾸지 않았습니다.',
  stage: '처리는 됐지만 현재 단계가 자동 전이 대상이 아니라 그대로 두었습니다.',
}

export async function applyWorkflowEvent(admin: AdminClient, args: WorkflowEventArgs): Promise<WorkflowEventOk | WorkflowEventFail> {
  const params: Record<string, unknown> = {
    p_event: args.event, p_actor: args.actorUserId,
    p_item_id: args.itemId ?? null, p_order_id: args.orderId ?? null, p_stage: args.stage ?? null,
    p_agent: args.agent ?? null, p_agent_user_id: args.agentUserId ?? null,
  }
  // 0108 인자는 값이 있을 때만 싣는다 — 옛 사건 호출이 0108 전 DB(7인자 함수)에서도 그대로 돈다.
  if (args.scope != null) params.p_scope = args.scope
  if (args.cas != null) params.p_cas = args.cas
  if (args.note != null) params.p_note = args.note
  if (args.mode != null) params.p_mode = args.mode
  if (args.runner != null) params.p_runner = args.runner
  const { data, error } = await admin.rpc('apply_workflow_event', params)
  if (error) return { ok: false, conflict: false, reason: 'rpc_error', orderStatus: null, error: `전이 실패: ${error.message}` }
  const r = (data ?? {}) as Record<string, unknown>
  const orderStatus = typeof r.order_status === 'string' ? r.order_status : null
  if (r.ok !== true) {
    const conflict = r.conflict === true
    const reason = typeof r.reason === 'string' ? r.reason : conflict ? 'conflict' : 'unknown'
    return { ok: false, conflict, reason, orderStatus, error: REASON_TEXT[reason] ?? `전이 실패(${reason})` }
  }
  return {
    ok: true, orderStatus,
    stage: typeof r.stage === 'string' ? r.stage : null,
    actualPct: r.actual_pct == null ? null : Number(r.actual_pct),
    stageChanged: r.stage_changed === true,
    actualChanged: r.actual_changed === true,
    reachedFirst: r.reached_first === true,
    skipped: typeof r.skipped === 'string' ? (r.skipped as WorkflowSkipped) : null,
    prevStatus: typeof r.prev_status === 'string' ? r.prev_status : null,
    designState: typeof r.design_state === 'string' ? r.design_state : null,
    designModeChanged: r.design_mode_changed === true,
  }
}

/** im·xx 첫 도달 뒤 후행 unblocked 알림(§2.10) — 항목을 읽어 notifySuccessorsOnReached 에 넘긴다. 실패는 로깅만. */
export async function notifyOnReached(admin: AdminClient, itemId: string, actorUserId: string): Promise<void> {
  const { data, error } = await admin
    .from('wbs_items').select('id, project_id, name, external_ref').eq('id', itemId).maybeSingle()
  if (error || !data) {
    console.error('[workflowEvent] 도달 알림용 항목 조회 실패:', error?.message ?? '0행')
    return
  }
  await notifySuccessorsOnReached(admin, data as { id: string; project_id: string; name: string; external_ref: string | null }, actorUserId)
}
