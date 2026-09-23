// 좌석의 결정 수(과제 C, 스펙 §7.3) — reported 주문의 최신 completion 값만. 본문은 싣지 않는다.
import { describe, expect, it } from 'vitest'
import { assembleSeatmap, type OrderRow, type ReviewRow, type SeatmapRows } from '@/lib/domain/seatmap'

const NOW = Date.parse('2026-09-23T09:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const OID = '11111111-aaaa-4aaa-8aaa-000000000001'
const order = (over: Partial<OrderRow>): OrderRow => ({
  id: OID, project_id: 'p1', wbs_item_id: 'i1', status: 'reported',
  claimed_by: 'claude-mbp', claimed_by_user_id: 'u1', claimed_at: ago(3600_000), created_at: ago(7200_000),
  updated_at: ago(60_000), last_heartbeat_at: ago(1000), heartbeat_phase: 'reported', heartbeat_agent: 'hong/mbp/w1',
  heartbeat_note: null, ...over,
})
const rows = (orders: OrderRow[], reviews: ReviewRow[]): SeatmapRows => ({
  orders,
  items: [{ id: 'i1', project_id: 'p1', code: 'TSK-01', name: '화면', parent_id: null, actual_pct: 80, assignee_member_id: null, tags: ['agent'] }],
  parents: [], reviews, watchers: [], projects: [{ id: 'p1', name: 'mes-base' }], members: [], predecessors: [],
})
const seatOf = (r: SeatmapRows) => assembleSeatmap(r, NOW).floors[0].zones[0].seats[0]

describe('Seat.decisionCount', () => {
  it('reported 주문은 최신 completion 의 decision_count — 반려된 옛 회차와 합산하지 않는다', () => {
    const s = seatOf(rows([order({})], [
      { work_order_id: OID, review_action: 'reject', review_note: '다시', created_at: ago(9000), decision_count: 3 },
      { work_order_id: OID, review_action: null, review_note: null, created_at: ago(2000), decision_count: 1 },
    ]))
    expect(s.state).toBe('WAIT')
    expect(s.decisionCount).toBe(1)
  })
  it('구 CLI 보고(null)는 null — 0 으로 바꾸지 않는다', () => {
    const s = seatOf(rows([order({})], [{ work_order_id: OID, review_action: null, review_note: null, created_at: ago(2000), decision_count: null }]))
    expect(s.decisionCount).toBeNull()
  })
  it('reported 가 아니면(재작업 중 claimed) 옛 completion 의 값이 있어도 null', () => {
    const s = seatOf(rows([order({ status: 'claimed', heartbeat_phase: 'build' })], [
      { work_order_id: OID, review_action: 'reject', review_note: '다시', created_at: ago(9000), decision_count: 2 },
    ]))
    expect(s.decisionCount).toBeNull()
  })
})
