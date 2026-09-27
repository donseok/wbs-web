// 판단 재료 일괄 로더(설계 상태 스펙 5.3·D22) — 목록·상세·watch·claim·build-start 가 designGate 에 넘길 재료를 모은다.
// 규칙은 여기 두지 않는다(src/lib/domain/designGate.ts 가 원본). 조회만 하고, 실패는 throw 해 호출부가 500 으로 답한다
// (게이트 재료를 "없음"으로 위장하면 막아야 할 claim 이 통과한다 — 에러 3원칙).
import type { AdminClient } from '@/lib/minutes/externalApi'
import { predecessorReached } from '@/lib/domain/agentWork'
import {
  isMine, nextAgentAction, predsState, toClaimScope, toDesignMode, toDesignState,
  type ActionResult, type DesignMode, type ItemFacts, type MineRequest, type OrderFacts,
} from '@/lib/domain/designGate'
import type { AgentOrderStatus } from '@/lib/domain/agentWork'

/** 주문 select 에 덧붙이는 판단 재료 열 — status 는 호출부가 이미 고른다. */
export const ORDER_FACT_COLUMNS =
  'claimed_by, claimed_by_user_id, last_heartbeat_at, heartbeat_phase, heartbeat_agent, design_state, claim_scope, design_note, runner, runner_seen_at'
export const ITEM_FACT_COLUMNS = 'id, project_id, external_ref, stage, actual_pct, tags, depends, depends_waived, design_mode'
const IN_CHUNK = 200

export type FactOrderRow = {
  status: string; claimed_by: string | null; claimed_by_user_id: string | null
  last_heartbeat_at?: string | null; heartbeat_phase?: string | null; heartbeat_agent?: string | null
  design_state?: string | null; claim_scope?: string | null; design_note?: string | null
  runner?: string | null; runner_seen_at?: string | null
}
export type FactItemRow = {
  id: string; project_id: string; external_ref: string | null; stage: string | null; actual_pct: number | string | null
  tags: string[] | null; depends: string[] | null; depends_waived: string[] | null; design_mode: string | null
}

/** 주문 행 → designGate OrderFacts. 0108 전 행·목(열 없음)은 없음·legacy 로 본다. */
export function orderFactsOf(row: FactOrderRow): OrderFacts {
  return {
    status: row.status as AgentOrderStatus,
    designState: toDesignState(row.design_state ?? null),
    claimScope: toClaimScope(row.claim_scope ?? null),
    runner: row.runner ?? null,
    runnerSeenAt: row.runner_seen_at ?? null,
    lastHeartbeatAt: row.last_heartbeat_at ?? null,
    heartbeatPhase: row.heartbeat_phase ?? null,
    heartbeatAgent: row.heartbeat_agent ?? null,
    claimedBy: row.claimed_by ?? null,
    claimedByUserId: row.claimed_by_user_id ?? null,
  }
}

function chunked<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

async function approvedItemIds(admin: AdminClient, itemIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (const c of chunked(itemIds, IN_CHUNK)) {
    const { data, error } = await admin.from('agent_work_orders').select('wbs_item_id').in('wbs_item_id', c).eq('status', 'approved')
    if (error) throw new Error(`승인 주문 조회 실패: ${error.message}`)
    for (const r of (data ?? []) as Array<{ wbs_item_id: string | null }>) if (r.wbs_item_id) out.add(r.wbs_item_id)
  }
  return out
}

/** 한 항목의 approved 주문 여부(claim·build-start 라우트용). 조회 실패는 throw. */
export async function hasApprovedOrder(admin: AdminClient, itemId: string): Promise<boolean> {
  const { data, error } = await admin.from('agent_work_orders').select('id').eq('wbs_item_id', itemId).eq('status', 'approved').limit(1).maybeSingle()
  if (error) throw new Error(`승인 주문 조회 실패: ${error.message}`)
  return data !== null
}

/**
 * 항목들의 ItemFacts — approved 주문(D26)과 선행 도달(predecessorReached, 면제 포함)을 배치로 구한다.
 * 선행은 같은 프로젝트의 external_ref 로 찾는다. 프로젝트에 없는 ref 는 미충족(단계 null — fail-closed, claim 게이트와 같다).
 */
export async function loadItemFacts(
  admin: AdminClient, items: readonly FactItemRow[],
): Promise<Map<string, { facts: ItemFacts; depsUnmet: Array<{ external_ref: string; stage: string | null }> }>> {
  const out = new Map<string, { facts: ItemFacts; depsUnmet: Array<{ external_ref: string; stage: string | null }> }>()
  if (items.length === 0) return out
  const approved = await approvedItemIds(admin, items.map(i => i.id))
  const refs = [...new Set(items.flatMap(i => (i.depends ?? []).filter(r => !(i.depends_waived ?? []).includes(r))))]
  const projects = [...new Set(items.map(i => i.project_id))]
  const preds = new Map<string, { id: string; stage: string | null; actual_pct: number | string | null }>()
  if (refs.length > 0) {
    for (const c of chunked(refs, IN_CHUNK)) {
      const { data, error } = await admin.from('wbs_items').select('id, project_id, external_ref, stage, actual_pct')
        .in('project_id', projects).in('external_ref', c)
      if (error) throw new Error(`선행 항목 조회 실패: ${error.message}`)
      for (const p of (data ?? []) as Array<{ id: string; project_id: string; external_ref: string; stage: string | null; actual_pct: number | string | null }>) {
        preds.set(`${p.project_id}|${p.external_ref}`, p)
      }
    }
  }
  const predApproved = preds.size > 0 ? await approvedItemIds(admin, [...preds.values()].map(p => p.id)) : new Set<string>()
  for (const i of items) {
    const waived = i.depends_waived ?? []
    const depsUnmet: Array<{ external_ref: string; stage: string | null }> = []
    for (const ref of i.depends ?? []) {
      if (waived.includes(ref)) continue
      const p = preds.get(`${i.project_id}|${ref}`)
      if (!p) { depsUnmet.push({ external_ref: ref, stage: null }); continue }
      const reached = predecessorReached({ stage: p.stage, orderApproved: predApproved.has(p.id), actualPct: p.actual_pct == null ? null : Number(p.actual_pct) })
      if (!reached) depsUnmet.push({ external_ref: ref, stage: p.stage })
    }
    out.set(i.id, {
      facts: {
        mode: toDesignMode(i.design_mode), stage: i.stage, actualPct: i.actual_pct == null ? null : Number(i.actual_pct),
        delegated: (i.tags ?? []).includes('agent'), hasApprovedOrder: approved.has(i.id), preds: predsState(depsUnmet),
      },
      depsUnmet,
    })
  }
  return out
}

/** 항목이 지워진 주문은 판단하지 않는다(skip) — 그 밖은 designGate.nextAgentAction. */
export function decide(item: ItemFacts | null, order: OrderFacts, nowMs: number): ActionResult {
  if (item === null) return { action: 'skip', reason: '항목이 지워진 주문', depsUnmet: false }
  return nextAgentAction(item, order, nowMs)
}

/**
 * 응답의 mine(계약 2.11, 목록·상세 공통). ready·claimed 주문은 5.3 정의(isMine — 같은 신원 ∧ 도는 PC, 팀장 요청이면 거르기·팀원 라벨까지)다.
 * 그 밖(reported·approved 등)은 종전 뜻(점유 사용자 일치)을 그대로 둔다. isMine 은 claimed 가 아니면 늘 거짓인데, 팀장의 머지 충돌 해소
 * (.claude/skills/dflow-team/references/merge-conflict.md)가 reported·approved 주문의 mine 으로 자기 주문을 가리기 때문이다.
 */
export function responseMine(
  order: Pick<OrderFacts, 'status' | 'claimedBy' | 'claimedByUserId' | 'runner' | 'runnerSeenAt'>, req: MineRequest, nowMs: number,
): boolean {
  if (order.status === 'ready' || order.status === 'claimed') return isMine(order, req, nowMs)
  return order.claimedByUserId === req.userId
}

/** 계약 2.11 응답 칸(목록·상세 공통, PAT 응답에만 — watch 는 싣지 않는다). */
export function designFieldsOf(
  row: Pick<FactOrderRow, 'design_state' | 'claim_scope' | 'design_note' | 'runner' | 'runner_seen_at'>,
  mode: DesignMode | string | null, a: ActionResult, mine: boolean,
) {
  return {
    design_mode: toDesignMode(mode), design_state: toDesignState(row.design_state ?? null), design_note: row.design_note ?? null,
    claim_scope: row.claim_scope ?? null, runner: row.runner ?? null, runner_seen_at: row.runner_seen_at ?? null,
    action: a.action, action_reason: a.reason, deps_unmet: a.depsUnmet, mine,
  }
}
