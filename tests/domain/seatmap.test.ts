import { describe, expect, it } from 'vitest'
import { animFor, OFFLINE_MS, STALE_MS } from '@/lib/domain/seatState'
import { ageLabel, assembleSeatmap, type OrderRow, type SeatmapRows, type WatcherRow } from '@/lib/domain/seatmap'

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
  items: [{ id: 'i1', project_id: P1, code: 'TSK-04-02', name: '주문 상세', parent_id: 'z1', actual_pct: 25, assignee_member_id: 'm1', tags: ['agent'] }],
  parents: [{ id: 'z1', project_id: P1, code: 'WP-04', name: '주문 관리', parent_id: null, actual_pct: null, assignee_member_id: null, tags: ['agent'] }],
  reviews: [], watchers: [], projects: [{ id: P1, name: 'mes-base' }, { id: P2, name: 'mes-runlog' }],
  members: [], predecessors: [],
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
    expect(['cat', 'human_m', 'human_f', 'dog', 'bot']).toContain(s.character)
  })
  it('부모가 없는 항목은 "구역 없음"에 놓이고, 항목이 지워진 주문(wbs_item_id null)과 agent 태그가 없는 항목의 주문은 보이지 않는다', () => {
    const m = assembleSeatmap(rows({
      orders: [
        order({ id: 'a'.repeat(8) + '-1', wbs_item_id: 'i2' }),
        order({ id: 'b'.repeat(8) + '-2', wbs_item_id: null }),
        order({ id: 'c'.repeat(8) + '-3', wbs_item_id: 'i3' }),
        order({ id: 'd'.repeat(8) + '-4', wbs_item_id: 'i4' }),
      ],
      items: [
        { id: 'i2', project_id: P1, code: 'TSK-99', name: '고아', parent_id: null, actual_pct: 0, assignee_member_id: null, tags: ['agent'] },
        { id: 'i3', project_id: P1, code: 'TSK-98', name: '사람이 하는 작업', parent_id: 'z1', actual_pct: 0, assignee_member_id: null, tags: [] },
        { id: 'i4', project_id: P1, code: 'TSK-97', name: '태그 없음(null)', parent_id: 'z1', actual_pct: 0, assignee_member_id: null, tags: null },
      ],
      parents: [],
    }), NOW)
    const names = m.floors[0].zones.map(z => z.name)
    expect(names).toEqual(['구역 없음'])
    expect(m.floors[0].seatCount).toBe(1)
    expect(m.counters.active + m.counters.idle + m.counters.offline).toBe(1)
  })
  it('책상은 구역 안에서 code 순', () => {
    const m = assembleSeatmap(rows({
      orders: [order({ id: 'c'.repeat(8) + '-3', wbs_item_id: 'i3' }), order({})],
      items: [
        { id: 'i3', project_id: P1, code: 'TSK-04-01', name: '먼저', parent_id: 'z1', actual_pct: 0, assignee_member_id: null, tags: ['agent'] },
        { id: 'i1', project_id: P1, code: 'TSK-04-02', name: '나중', parent_id: 'z1', actual_pct: 25, assignee_member_id: null, tags: ['agent'] },
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
      orders: [order({}), order({ id: '9'.repeat(8) + '-z', project_id: P2, wbs_item_id: 'i9' })],
      items: [
        { id: 'i1', project_id: P1, code: 'TSK-04-02', name: '주문 상세', parent_id: 'z1', actual_pct: 25, assignee_member_id: 'm1', tags: ['agent'] },
        { id: 'i9', project_id: P2, code: 'TSK-01', name: '런로그 항목', parent_id: null, actual_pct: 0, assignee_member_id: null, tags: ['agent'] },
      ],
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
  it('신호 시각을 둘 다 파싱 못하면(lastSignalMs=0) lastSignalAt 은 null 이다(끊김 56년 전 방지)', () => {
    const m = assembleSeatmap(rows({
      orders: [order({ updated_at: 'garbage', last_heartbeat_at: 'garbage' })],
    }), NOW)
    const s = m.floors[0].zones[0].seats[0]
    expect(s.state).toBe('OFFLINE')
    expect(s.lastSignalAt).toBeNull()
    expect(ageLabel(s.lastSignalAt, NOW)).toBe('—')
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

describe('assembleSeatmap — 내 작업(scope=mine)', () => {
  const items = [
    { id: 'i1', project_id: P1, code: 'TSK-04-01', name: '내 담당', parent_id: 'z1', actual_pct: 0, assignee_member_id: 'm1', tags: ['agent'] },
    { id: 'i2', project_id: P1, code: 'TSK-04-02', name: '남 담당·내 에이전트', parent_id: 'z1', actual_pct: 10, assignee_member_id: 'm2', tags: ['agent'] },
    { id: 'i3', project_id: P1, code: 'TSK-04-03', name: '남 담당·남 에이전트', parent_id: 'z1', actual_pct: 10, assignee_member_id: 'm2', tags: ['agent'] },
    { id: 'i4', project_id: P1, code: 'TSK-04-04', name: '남 담당 완료', parent_id: 'z1', actual_pct: 100, assignee_member_id: 'm2', tags: ['agent'] },
  ]
  const orders = [
    order({ id: 'o1', wbs_item_id: 'i1', status: 'ready', claimed_by: null, claimed_by_user_id: null }),
    order({ id: 'o2', wbs_item_id: 'i2', claimed_by_user_id: 'u1' }),
    order({ id: 'o3', wbs_item_id: 'i3', claimed_by_user_id: 'u9' }),
    order({ id: 'o4', wbs_item_id: 'i4', status: 'approved', claimed_by_user_id: 'u9' }),
  ]
  it('담당자가 내 로스터 행이거나 내 계정이 잡은 주문만 남기고, 완료 수도 그 기준으로 센다', () => {
    const m = assembleSeatmap(rows({ items, orders }), NOW, { mine: { userId: 'u1', memberIds: new Set(['m1']) } })
    expect(m.scope).toBe('mine')
    const codes = m.floors.flatMap(f => f.zones.flatMap(z => z.seats.map(s => s.code)))
    expect(codes).toEqual(['TSK-04-01', 'TSK-04-02'])
    expect(m.floors[0].doneCount).toBe(0)
    expect(m.counters.offline + m.counters.active + m.counters.idle).toBe(2)
  })
  it('옵션이 없으면 전체(scope=all)', () => {
    const m = assembleSeatmap(rows({ items, orders }), NOW)
    expect(m.scope).toBe('all')
    expect(m.floors[0].seatCount).toBe(3)
    expect(m.floors[0].doneCount).toBe(1)
  })
  it('내 것이 하나도 없으면 층이 없다', () => {
    const m = assembleSeatmap(rows({ items, orders }), NOW, { mine: { userId: 'nobody', memberIds: new Set() } })
    expect(m.floors).toEqual([])
  })
})

describe('assembleSeatmap — 착수 대기 사유(waitReason)', () => {
  const ready = () => order({ status: 'ready', claimed_by: null, claimed_by_user_id: null, claimed_at: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null })
  const w = (over: Partial<WatcherRow> = {}): WatcherRow => ({ id: 'w1', user_id: 'u1', project_id: null, agent: 'hong/mbp', host: null, slots: 2, busy: 0, until_label: null, last_seen_at: ago(60_000), ...over })
  const seatOf = (m: ReturnType<typeof assembleSeatmap>) => m.floors[0].zones[0].seats[0]
  it('READY 가 아니면 null', () => {
    expect(seatOf(assembleSeatmap(rows(), NOW)).waitReason).toBeNull()
  })
  it('READY + 이 층을 보는 살아 있는 감시자 없음 → agent_off. TTL 지난 감시자와 다른 층만 보는 감시자는 세지 않는다', () => {
    const m = assembleSeatmap(rows({ orders: [ready()], items: [{ id: 'i1', project_id: P1, code: 'T', name: 'n', parent_id: 'z1', actual_pct: 0, assignee_member_id: null, tags: ['agent'] }],
      watchers: [w({ last_seen_at: ago(71 * 60_000) }), w({ id: 'w2', project_id: P2 })] }), NOW)
    expect(seatOf(m).waitReason?.kind).toBe('agent_off')
  })
  it('READY + 감시자(project_id null) 있음 → pickup', () => {
    const m = assembleSeatmap(rows({ orders: [ready()], items: [{ id: 'i1', project_id: P1, code: 'T', name: 'n', parent_id: 'z1', actual_pct: 0, assignee_member_id: null, tags: ['agent'] }], watchers: [w()] }), NOW)
    expect(seatOf(m).waitReason?.kind).toBe('pickup')
  })
  it('선행은 같은 프로젝트의 external_ref 로만 맞춘다 — 다른 프로젝트의 같은 ref 는 무시(미충족 = dependency)', () => {
    const base = { orders: [ready()], items: [{ id: 'i1', project_id: P1, code: 'T', name: 'n', parent_id: 'z1', actual_pct: 0, assignee_member_id: null, tags: ['agent'], depends: ['M/T1'] }], watchers: [w()] }
    const other = assembleSeatmap(rows({ ...base, predecessors: [{ id: 'x', project_id: P2, external_ref: 'M/T1', code: 'X', name: 'x', stage: 'xx', order_approved: true }] }), NOW)
    expect(seatOf(other).waitReason?.kind).toBe('dependency')
    expect(seatOf(other).waitReason?.text).toContain('M/T1(프로젝트에 없는 항목)')
    const same = assembleSeatmap(rows({ ...base, predecessors: [{ id: 'x', project_id: P1, external_ref: 'M/T1', code: 'X', name: 'x', stage: 'xx', order_approved: false }] }), NOW)
    expect(seatOf(same).waitReason?.kind).toBe('pickup')
  })
  it('담당자 항목은 담당자 로스터 행의 user_id 감시자만 자격 — 없으면 agent_off 에 담당자 이름, 로스터 행이 없으면 계정 미연결 취급', () => {
    const items = [{ id: 'i1', project_id: P1, code: 'T', name: 'n', parent_id: 'z1', actual_pct: 0, assignee_member_id: 'm1', tags: ['agent'] }]
    const off = assembleSeatmap(rows({ orders: [ready()], items, members: [{ id: 'm1', project_id: P1, user_id: 'u7', name: '홍길동' }], watchers: [w()] }), NOW)
    expect(off.floors[0].zones[0].seats[0].waitReason).toMatchObject({ kind: 'agent_off' })
    expect(seatOf(off).waitReason?.text).toContain('담당자 홍길동')
    const on = assembleSeatmap(rows({ orders: [ready()], items, members: [{ id: 'm1', project_id: P1, user_id: 'u1', name: '홍길동' }], watchers: [w()] }), NOW)
    expect(seatOf(on).waitReason?.kind).toBe('pickup')
    const missing = assembleSeatmap(rows({ orders: [ready()], items, members: [], watchers: [w()] }), NOW)
    expect(seatOf(missing).waitReason?.text).toContain('(로스터에 없음)')
    expect(seatOf(missing).waitReason?.text).toContain('계정이 로스터에 연결돼 있지 않아')
  })
})
