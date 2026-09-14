import { describe, expect, it } from 'vitest'
import { animFor, OFFLINE_MS, STALE_MS } from '@/lib/domain/seatState'
import { ageLabel, assembleSeatmap, type OrderRow, type SeatmapRows } from '@/lib/domain/seatmap'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const P1 = 'p1', P2 = 'p2'
const order = (over: Partial<OrderRow>): OrderRow => ({
  id: '11111111-aaaa-4aaa-8aaa-000000000001', project_id: P1, wbs_item_id: 'i1', status: 'claimed',
  claimed_by: 'claude-mbp', claimed_by_user_id: 'u1', claimed_at: ago(3600_000), created_at: ago(7200_000),
  updated_at: ago(60_000), last_heartbeat_at: ago(1000), heartbeat_phase: 'build', heartbeat_agent: 'hong/mbp/w1',
  heartbeat_note: null, ...over,
})
const rows = (over: Partial<SeatmapRows> = {}): SeatmapRows => ({
  orders: [order({})],
  items: [{ id: 'i1', project_id: P1, code: 'TSK-04-02', name: '주문 상세', parent_id: 'z1', actual_pct: 25 }],
  parents: [{ id: 'z1', project_id: P1, code: 'WP-04', name: '주문 관리', parent_id: null, actual_pct: null }],
  reviews: [], watchers: [], projects: [{ id: P1, name: 'mes-base' }, { id: P2, name: 'mes-runlog' }],
  ...over,
})

describe('assembleSeatmap — 층·구역·책상', () => {
  it('주문 1건이 층(프로젝트)→구역(부모 항목)→책상으로 놓이고 상태·애니메이션·캐릭터가 붙는다', () => {
    const m = assembleSeatmap(rows(), NOW)
    expect(m.floors).toHaveLength(1) // 주문 없는 프로젝트는 층을 만들지 않는다
    const f = m.floors[0]
    expect(f.name).toBe('mes-base')
    expect(f.zones[0].code).toBe('WP-04')
    const s = f.zones[0].seats[0]
    expect(s.id8).toBe('11111111')
    expect(s.state).toBe('ACTIVE'); expect(s.anim).toBe('typing'); expect(s.progress).toBe(25)
    expect(s.agent).toBe('hong/mbp/w1')
    expect(['monitor_bot', 'cat_dev', 'human_dev', 'dome_bot']).toContain(s.character)
  })
  it('부모가 없는 항목은 "구역 없음", 항목이 지워진 주문(wbs_item_id null)은 "항목 없음" 구역에 놓인다', () => {
    const m = assembleSeatmap(rows({
      orders: [order({ id: 'a'.repeat(8) + '-1', wbs_item_id: 'i2' }), order({ id: 'b'.repeat(8) + '-2', wbs_item_id: null })],
      items: [{ id: 'i2', project_id: P1, code: 'TSK-99', name: '고아', parent_id: null, actual_pct: 0 }],
      parents: [],
    }), NOW)
    const keys = m.floors[0].zones.map(z => z.name)
    expect(keys).toContain('구역 없음')
    expect(keys).toContain('항목 없음')
  })
  it('책상은 구역 안에서 code 순', () => {
    const m = assembleSeatmap(rows({
      orders: [order({ id: 'c'.repeat(8) + '-3', wbs_item_id: 'i3' }), order({})],
      items: [
        { id: 'i3', project_id: P1, code: 'TSK-04-01', name: '먼저', parent_id: 'z1', actual_pct: 0 },
        { id: 'i1', project_id: P1, code: 'TSK-04-02', name: '나중', parent_id: 'z1', actual_pct: 25 },
      ],
    }), NOW)
    expect(m.floors[0].zones[0].seats.map(s => s.code)).toEqual(['TSK-04-01', 'TSK-04-02'])
  })
  it('마지막 completion 보고가 reject 면 rejected 와 reviewNote 가 붙고 상태는 REJECTED', () => {
    const m = assembleSeatmap(rows({
      reviews: [
        { work_order_id: order({}).id, review_action: 'approve', review_note: null, created_at: ago(9000_000) },
        { work_order_id: order({}).id, review_action: 'reject', review_note: '테스트 누락', created_at: ago(600_000) },
      ],
    }), NOW)
    const s = m.floors[0].zones[0].seats[0]
    expect(s.state).toBe('REJECTED'); expect(s.rejected).toBe(true); expect(s.reviewNote).toBe('테스트 누락')
  })
  it('DONE(approved) 은 doneCount 로 세고 카운터에는 들어가지 않는다', () => {
    const m = assembleSeatmap(rows({ orders: [order({ status: 'approved' })] }), NOW)
    expect(m.floors[0].doneCount).toBe(1)
    expect(m.counters).toEqual({ active: 0, standby: 0, idle: 0, offline: 0 })
  })
  it('WAIT 좌석의 idle 애니메이션은 좌석 id 로 오프셋을 받아 서로 다르다', () => {
    const m = assembleSeatmap(rows({
      orders: [
        order({ id: 'o-1', status: 'reported' }),
        order({ id: 'o-3', status: 'reported' }),
        order({ id: 'o-5', status: 'reported' }),
      ],
    }), NOW)
    const seats = m.floors[0].zones[0].seats
    const byId = (id: string) => seats.find(s => s.orderId === id)!
    const anims = ['o-1', 'o-3', 'o-5'].map(id => byId(id).anim)
    expect(new Set(anims).size).toBe(3)
    const idleSlot = Math.floor(NOW / 10_000)
    expect(byId('o-1').anim).toBe(animFor('WAIT', byId('o-1').phase, idleSlot + 1))
    expect(byId('o-3').anim).toBe(animFor('WAIT', byId('o-3').phase, idleSlot + 2))
    expect(byId('o-5').anim).toBe(animFor('WAIT', byId('o-5').phase, idleSlot + 0))
  })
})

describe('assembleSeatmap — 카운터·확인 필요·watcher', () => {
  it('카운터: Active=ACTIVE+STALE+REJECTED+BLOCKED, Idle=WAIT, Offline=OFFLINE+READY', () => {
    const m = assembleSeatmap(rows({
      orders: [
        order({ id: '1'.repeat(8) + '-a' }),
        order({ id: '2'.repeat(8) + '-b', last_heartbeat_at: ago(STALE_MS + 1), updated_at: ago(STALE_MS + 1) }),
        order({ id: '3'.repeat(8) + '-c', heartbeat_phase: 'blocked', heartbeat_note: '어느 DB?' }),
        order({ id: '4'.repeat(8) + '-d', status: 'reported' }),
        order({ id: '5'.repeat(8) + '-e', last_heartbeat_at: ago(OFFLINE_MS + 1), updated_at: ago(OFFLINE_MS + 1) }),
        order({ id: '6'.repeat(8) + '-f', status: 'ready', claimed_by: null, claimed_by_user_id: null, heartbeat_agent: null }),
      ],
    }), NOW)
    expect(m.counters).toEqual({ active: 3, standby: 0, idle: 1, offline: 2 })
    expect(m.attention.map(a => a.state)).toEqual(['BLOCKED', 'STALE', 'OFFLINE'])
    expect(m.attention[0].why).toBe('어느 DB?')
  })
  it('watcher: 70분 안이면 살아 있고, project_id null 은 모든 층에, 지정이면 그 층에만', () => {
    const m = assembleSeatmap(rows({
      orders: [order({}), order({ id: '9'.repeat(8) + '-z', project_id: P2, wbs_item_id: null })],
      watchers: [
        { id: 'w1', user_id: 'u1', project_id: null, agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, until_label: '18:00', last_seen_at: ago(60_000) },
        { id: 'w2', user_id: 'u1', project_id: P2, agent: 'hong/mbp/poll', host: 'mbp', slots: null, busy: null, until_label: null, last_seen_at: ago(60_000) },
        { id: 'w3', user_id: 'u2', project_id: null, agent: 'kim/air/lead', host: 'air', slots: 2, busy: 0, until_label: null, last_seen_at: ago(71 * 60_000) },
      ],
    }), NOW)
    const byName = Object.fromEntries(m.floors.map(f => [f.name, f.watchers.map(w => w.agent)]))
    expect(byName['mes-base']).toEqual(['hong/mbp/lead'])
    expect(byName['mes-runlog']).toEqual(['hong/mbp/lead', 'hong/mbp/poll'])
    expect(m.counters.standby).toBe(2)
  })
  it('fetchedAt 은 nowMs 의 ISO', () => {
    expect(assembleSeatmap(rows(), NOW).fetchedAt).toBe(new Date(NOW).toISOString())
  })
})

describe('ageLabel', () => {
  it('초·분·시간 분·없음', () => {
    expect(ageLabel(ago(12_000), NOW)).toBe('12초 전')
    expect(ageLabel(ago(5 * 60_000), NOW)).toBe('5분 전')
    expect(ageLabel(ago(2 * 3600_000 + 3 * 60_000), NOW)).toBe('2시간 3분 전')
    expect(ageLabel(null, NOW)).toBe('—')
  })
})
