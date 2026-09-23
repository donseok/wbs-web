// 병목 제안(강제 진행 스펙 F14) — 한 선행이 위임된 ready 후속 N건 이상을 T시간 넘게 막으면 층 머리에 띠를 띄운다.
import { describe, expect, it } from 'vitest'
import { assembleSeatmap, type ItemRow, type OrderRow, type SeatmapRows } from '@/lib/domain/seatmap'

const NOW = Date.parse('2026-09-23T12:00:00Z')
const H = 3600_000
const P1 = 'p1'
const order = (id: string, itemId: string): OrderRow => ({
  id: `${id}-aaaa-4aaa-8aaa-000000000001`, project_id: P1, wbs_item_id: itemId, status: 'ready',
  claimed_by: null, claimed_by_user_id: null, claimed_at: null, created_at: new Date(NOW - 10 * H).toISOString(),
  updated_at: new Date(NOW - 6 * H).toISOString(), last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null,
  heartbeat_note: null,
})
const succ = (id: string, over: Partial<ItemRow> = {}): ItemRow => ({
  id, project_id: P1, code: id.toUpperCase(), name: id, parent_id: 'wp', actual_pct: 0, assignee_member_id: null,
  tags: ['agent'], depends: ['m/P1'], ...over,
})
const rows = (items: ItemRow[]): SeatmapRows => ({
  orders: items.map((it, i) => order(`1111111${i}`, it.id)),
  items,
  parents: [{ id: 'wp', project_id: P1, code: 'WP', name: '구역', parent_id: null, actual_pct: null, assignee_member_id: null, tags: null }],
  reviews: [], watchers: [], projects: [{ id: P1, name: 'mes' }], members: [],
  predecessors: [{ id: 'pred', project_id: P1, external_ref: 'm/P1', code: 'P1', name: '선행', stage: 'ip', actual_pct: 30, order_approved: false }],
})

describe('assembleSeatmap — 병목 제안', () => {
  it('한 선행이 기본값(3건·4시간)을 넘겨 막으면 층에 제안 띠가 뜬다', () => {
    const map = assembleSeatmap(rows([succ('a'), succ('b'), succ('c')]), NOW)
    expect(map.floors[0].bottlenecks).toEqual([{ predRef: 'm/P1', successorIds: ['a', 'b', 'c'], text: '선행 P1 이 후속 3건을 막고 있습니다(6시간째)' }])
  })
  it('면제된 간선은 막힘으로 세지 않는다', () => {
    const map = assembleSeatmap(rows([succ('a'), succ('b', { depends_waived: ['m/P1'] }), succ('c')]), NOW)
    expect(map.floors[0].bottlenecks).toEqual([])
  })
  it('프로젝트 설정 기준을 따른다', () => {
    const r = { ...rows([succ('a'), succ('b')]), bottleneckSettings: { [P1]: { minSuccessors: 2, minHours: 5 } } }
    expect(assembleSeatmap(r, NOW).floors[0].bottlenecks).toHaveLength(1)
  })
  it('위임되지 않은 후속은 세지 않는다', () => {
    const map = assembleSeatmap(rows([succ('a'), succ('b'), succ('c', { tags: [] })]), NOW)
    expect(map.floors[0].bottlenecks).toEqual([])
  })
})
