// 설계 영역 판정 재료(WBS 작업 패널) — 항목 하나의 설계 사실과 활성 주문을 읽어 designGate 의 화면 판정에 넘긴다.
// 서버 액션 파일('use server') 밖에 두는 이유: 가드 없는 본체가 액션으로 열리지 않게(delegation.ts 와 같은 이유).
// 스펙: docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md 3절·7절
import type { AdminClient } from '@/lib/minutes/externalApi'
import {
  designButtons, designModeChangeBlock, designPushWarning, designScreen,
  type DesignButton, type DesignMode, type DesignState, type ItemFacts, type ScreenOrder,
} from '@/lib/domain/designGate'
import { ITEM_FACT_COLUMNS, ORDER_FACT_COLUMNS, loadItemFacts, orderFactsOf, type FactItemRow, type FactOrderRow } from '@/lib/agent/designFacts'

export type DesignTarget = {
  itemId: string; projectId: string
  item: ItemFacts
  /** 활성 주문(ready·claimed·reported — 0077 로 항목당 하나). */
  active: (ScreenOrder & { id: string }) | null
  /** 항목의 모든 주문 status(방식 잠금 판정). */
  orderStatuses: string[]
  lastReview: 'approve' | 'reject' | null
}

export type DesignPanel = {
  mode: DesignMode
  designState: DesignState | null
  /** 3절 화면 행 — 없으면 null(단계 문구 그대로). */
  screen: { row: number; label: string; note: string | null; hint: string | null } | null
  buttons: DesignButton[]
  pushWarning: string | null
  /** 방식을 바꿀 수 없는 이유(null 이면 바꿀 수 있다). */
  modeLock: string | null
}

/** 활성 주문 status — 0077 의 부분 유일 인덱스(agent_work_orders_active_per_item_uidx)가 항목당 하나로 묶는다. */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['ready', 'claimed', 'reported'])

/** 조회 실패는 throw — 호출부가 오류로 드러낸다(에러 3원칙). 항목이 없으면 null. */
export async function loadDesignTarget(admin: AdminClient, itemId: string): Promise<DesignTarget | null> {
  const { data: item, error } = await admin.from('wbs_items').select(ITEM_FACT_COLUMNS).eq('id', itemId).maybeSingle()
  if (error) throw new Error(`항목 조회 실패: ${error.message}`)
  if (!item) return null
  const row = item as unknown as FactItemRow
  // 주문 목록과 판단 재료(승인 주문·선행)는 서로 기대지 않는다 — 함께 읽어 패널을 열 때의 왕복을 줄인다.
  const [orders, factsById] = await Promise.all([
    admin.from('agent_work_orders').select(`id, status, ${ORDER_FACT_COLUMNS}`).eq('wbs_item_id', itemId),
    loadItemFacts(admin, [row]),
  ])
  if (orders.error) throw new Error(`주문 조회 실패: ${orders.error.message}`)
  const list = (orders.data ?? []) as unknown as Array<FactOrderRow & { id: string }>
  const activeRow = list.find(o => ACTIVE_STATUSES.has(o.status)) ?? null
  let lastReview: 'approve' | 'reject' | null = null
  if (activeRow) {
    // 마지막 완료 보고의 검토 결과 — 3절 5행(재작업 대기)의 재료. 좌석·허브와 같은 규칙(kind completion 의 최신 행).
    const { data: rep, error: rErr } = await admin.from('agent_work_reports').select('review_action')
      .eq('work_order_id', activeRow.id).eq('kind', 'completion').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (rErr) throw new Error(`보고 조회 실패: ${rErr.message}`)
    lastReview = (rep as { review_action: 'approve' | 'reject' | null } | null)?.review_action ?? null
  }
  const facts = factsById.get(row.id)
  if (!facts) throw new Error('설계 판단 재료를 만들지 못했습니다.')
  const active = activeRow ? { ...orderFactsOf(activeRow), id: activeRow.id, designNote: activeRow.design_note ?? null } : null
  return { itemId, projectId: row.project_id, item: facts.facts, active, orderStatuses: list.map(o => o.status), lastReview }
}

/** 3절 화면 판정·7절 버튼·Y13 push 경고·4.1 방식 잠금을 한 번에. */
export function designPanelOf(t: DesignTarget, nowMs: number): DesignPanel {
  const screen = designScreen({ item: t.item, active: t.active, lastReview: t.lastReview, nowMs })
  const designState = t.active?.designState ?? null
  return {
    mode: t.item.mode,
    designState,
    screen: screen ? { row: screen.row, label: screen.label, note: screen.note, hint: screen.hint } : null,
    buttons: designButtons(t.item, t.active),
    pushWarning: designPushWarning(t.item, t.active),
    modeLock: designModeChangeBlock({ designState, orderStatuses: t.orderStatuses }),
  }
}
