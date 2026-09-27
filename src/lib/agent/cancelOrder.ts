// 공용 취소(설계 상태 스펙 D14) — 위임 해제·「중단」·개발 워크플로 끄기·스텁 제거·import 의 표식 제거(L7)가 모두 이 함수를 쓴다.
// 주문마다 RPC cancel 사건 하나(0108): 주문 cancelled·점유·설계 상태·claim_scope·runner 를 지우고, claimed 이거나 단계 dd 면
// 단계·실적을 as 로 되돌린다. 종전의 "주문 UPDATE 뒤 set_stage as" 두 단계가 한 트랜잭션이 된다(태그 잠금에도 걸리지 않는다).
import type { AdminClient } from '@/lib/minutes/externalApi'
import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'

export type CancelOrdersResult = {
  cancelled: Array<{ id: string; prevStatus: string }>
  /** 판정과 쓰기 사이에 상태가 바뀐 주문(보고됨 등) — 실패가 아니라 "취소 대상이 아니게 됨". */
  conflicts: string[]
  failed: Array<{ id: string; error: string }>
  /**
   * 단계·실적이 되돌아간 주문이 있으면 참 — 스냅샷을 남기는 것은 호출부 몫이다. 위임 해제(delegation.applyDelegation →
   * 허브·setDelegationAndMode)는 이 값으로 남기지만, 개발 워크플로 끄기(wbsAssign)·import 표식 제거(wbsImport)·
   * 스텁 제거(forceProgress)·허브 「중단」의 항목 없는 주문 직접 취소(agentHub runHubProcessOp stop)는 이 값을 보지 않는다.
   */
  actualChanged: boolean
}

export async function cancelOrders(admin: AdminClient, args: { orderIds: string[]; actorUserId: string }): Promise<CancelOrdersResult> {
  const out: CancelOrdersResult = { cancelled: [], conflicts: [], failed: [], actualChanged: false }
  for (const id of args.orderIds) {
    const r = await applyWorkflowEvent(admin, { event: 'cancel', actorUserId: args.actorUserId, orderId: id })
    if (r.ok) {
      out.cancelled.push({ id, prevStatus: r.prevStatus ?? 'unknown' })
      if (r.actualChanged) out.actualChanged = true
    } else if (r.conflict) {
      out.conflicts.push(id)
    } else {
      console.error('[cancelOrders] 취소 실패:', id, r.error)
      out.failed.push({ id, error: r.error })
    }
  }
  return out
}
