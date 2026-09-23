// 오피스 좌석의 스텁 잔존(강제 진행 스펙 F13) — 좌석이 승인 버튼 비활성·배지 재료를 싣는다.
import { describe, expect, it } from 'vitest'
import { assembleSeatmap, type OrderRow, type SeatmapRows } from '@/lib/domain/seatmap'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const P1 = 'p1'
const order = (over: Partial<OrderRow>): OrderRow => ({
  id: '11111111-aaaa-4aaa-8aaa-000000000001', project_id: P1, wbs_item_id: 'succ', status: 'reported',
  claimed_by: 'claude-mbp', claimed_by_user_id: 'u1', claimed_at: ago(3600_000), created_at: ago(7200_000),
  updated_at: ago(60_000), last_heartbeat_at: ago(1000), heartbeat_phase: 'build', heartbeat_agent: 'hong/mbp/w1',
  heartbeat_note: null, ...over,
})
const succItem = { id: 'succ', project_id: P1, code: 'TSK-02', name: '후행', parent_id: 'wp', actual_pct: 80, assignee_member_id: 'm1', tags: ['agent'] }
const stubItem = { id: 's1', project_id: P1, code: 'TSK-01', name: '스텁 제거·실연결: TSK-01 선행', parent_id: 'succ', actual_pct: 0, assignee_member_id: 'm1', tags: ['agent'], stub_for: 'm/TSK-01', stage: 'ip' }
const wpItem = { id: 'wp', project_id: P1, code: 'WP-01', name: '구역', parent_id: null, actual_pct: null, assignee_member_id: null, tags: null }
const rows = (over: Partial<SeatmapRows> = {}): SeatmapRows => ({
  orders: [order({})], items: [succItem], parents: [wpItem], reviews: [], watchers: [],
  projects: [{ id: P1, name: 'mes' }], members: [], predecessors: [], stubs: [stubItem], ...over,
})
const seatOf = (m: ReturnType<typeof assembleSeatmap>, itemId: string) => m.floors[0].zones.flatMap(z => z.seats).find(s => s.itemId === itemId)!

describe('assembleSeatmap — 스텁 잔존', () => {
  it('reported 주문 좌석에 스텁 잔존 목록이 실린다', () => {
    expect(seatOf(assembleSeatmap(rows(), NOW), 'succ').stubPending).toEqual([{ subTaskId: 's1', label: '스텁 잔존: TSK-01 대체' }])
  })
  it('하위가 xx 면 빈 목록이다', () => {
    expect(seatOf(assembleSeatmap(rows({ stubs: [{ ...stubItem, stage: 'xx' }] }), NOW), 'succ').stubPending).toEqual([])
  })
  it('stubs 를 안 넘기면(옛 호출부) 빈 목록이다', () => {
    expect(seatOf(assembleSeatmap(rows({ stubs: undefined }), NOW), 'succ').stubPending).toEqual([])
  })
})
