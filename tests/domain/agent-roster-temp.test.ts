// 조정자 킷의 표시 전용 감시자 — 조정 세션(coord)·임시 팀원(임시:<레인>·<요약>) — 이름 읽기·책상·정렬·집계 제외.
import { describe, expect, it } from 'vitest'
import { assembleRoster, coordLine, isAuxSlot, isCoordSlot, parseCoordSlot, isAuxWatcherAgent, parseTempSlot, slotLabel, tempStatusKind } from '@/lib/domain/agentRoster'
import { assembleSeatmap, type OrderRow, type SeatmapRows, type WatcherRow } from '@/lib/domain/seatmap'
import { assembleAgentHub, type AgentHubRows } from '@/lib/domain/agentHub'
import type { Floor, Seat, Watcher } from '@/lib/domain/seatmap'

describe('parseTempSlot · slotLabel', () => {
  it('첫 · 만 레인과 요약의 경계다 — 요약에 · 가 더 있어도 요약이다', () => {
    expect(parseTempSlot('임시:레인A·로그인 화면 · 검증 · 정리')).toEqual({ lane: '레인A', summary: '로그인 화면 · 검증 · 정리' })
    expect(parseTempSlot('임시:b2·요약')).toEqual({ lane: 'b2', summary: '요약' })
  })
  it('경계가 없거나 레인이 비면 안전하게 읽는다', () => {
    expect(parseTempSlot('임시:레인A')).toEqual({ lane: '레인A', summary: '' })
    expect(parseTempSlot('임시:·요약만')).toEqual({ lane: '레인 미상', summary: '요약만' })
  })
  it('임시 슬롯이 아니면 null', () => {
    for (const s of ['lead', 'poll', 'coord', 'w1', '임시', 'x임시:a·b']) expect(parseTempSlot(s)).toBeNull()
  })
  it('라벨 — 임시는 레인, coord 는 팀장(조정), 기존 자리는 그대로', () => {
    expect(slotLabel('임시:레인A·요약')).toBe('레인A')
    expect(slotLabel('coord')).toBe('팀장(조정)')
    expect(slotLabel('w2')).toBe('팀원 2')
    expect(slotLabel('lead')).toBe('팀장')
    expect(slotLabel('poll')).toBe('단독 감시')
    expect(slotLabel('mystery')).toBe('mystery')
  })
  it('조정 슬롯 — coord · coord:<run-id> 만 인정하고 coordinator 같은 접두 오인은 아니다', () => {
    expect(parseCoordSlot('coord')).toEqual({ runId: null })
    expect(parseCoordSlot('coord:widget-2026-10-05')).toEqual({ runId: 'widget-2026-10-05' })
    expect(parseCoordSlot('coord:')).toEqual({ runId: null })
    for (const s of ['coordinator', 'coordx', 'lead', 'w1', '임시:coord·x']) { expect(parseCoordSlot(s)).toBeNull(); expect(isCoordSlot(s)).toBe(false) }
    expect(slotLabel('coord:r1')).toBe('팀장(조정)')
    expect(slotLabel('coordinator')).toBe('coordinator')
    expect(isAuxSlot('coord:r1')).toBe(true)
    expect(isAuxSlot('coordinator')).toBe(false)
    expect(isAuxWatcherAgent('jji/mac/coord:r1')).toBe(true)
    expect(isAuxWatcherAgent('jji/mac/coordinator')).toBe(false)
    expect(coordLine({ slots: 2, busy: 1 }, 'r1')).toBe('레인 2개 · 작업 중 1 · 회차 r1')
    expect(coordLine(null, 'r1')).toBe('조정 중 · 회차 r1')
  })
  it('보조 자리 판정 — coord·임시만 true, 일반 감시자·규칙 밖 신원은 false', () => {
    expect(isAuxSlot('coord')).toBe(true)
    expect(isAuxSlot('임시:a·b')).toBe(true)
    for (const s of ['lead', 'poll', 'w1']) expect(isAuxSlot(s)).toBe(false)
    expect(isAuxWatcherAgent('jji/mac/coord')).toBe(true)
    expect(isAuxWatcherAgent('jji/mac/임시:a·b')).toBe(true)
    expect(isAuxWatcherAgent('jji/mac/lead')).toBe(false)
    expect(isAuxWatcherAgent('claude-mac')).toBe(false)
  })
  it('상태 라벨 분류와 조정 한 줄', () => {
    expect(['작업 중', '대기', '머지 중', '끝', '이상한값', null].map(tempStatusKind)).toEqual(['working', 'wait', 'merge', 'done', 'other', 'other'])
    expect(coordLine({ slots: 4, busy: 2 })).toBe('레인 4개 · 작업 중 2')
    expect(coordLine({ slots: 3, busy: null })).toBe('레인 3개 · 작업 중 0')
    expect(coordLine(null)).toBe('조정 중')
  })
})

const seat = (orderId: string, agent: string | null, state: Seat['state']): Seat =>
  ({ orderId, agent, state, code: orderId, name: orderId } as unknown as Seat)
const watcher = (agent: string, over: Partial<Watcher> = {}): Watcher =>
  ({ agent, host: null, slots: null, busy: null, untilLabel: null, lastSeenAt: '2026-10-06T00:00:00Z', projectId: null, ...over })
const floor = (seats: Seat[], watchers: Watcher[]): Floor =>
  ({ id: 'p', name: 'P', seatCount: seats.length, doneCount: 0, watchers, leads: [], zones: [{ key: 'z', code: 'Z', name: 'Z', seats, summary: { work: 0, wait: 0, ready: 0, done: 0 } }] })

describe('assembleRoster — 임시 팀원·조정 세션 책상', () => {
  it('임시 팀원은 같은 PC 행의 temp 책상이 된다(라벨=레인, 요약·상태 보존)', () => {
    const r = assembleRoster({ floors: [floor([], [watcher('jji/mac/임시:레인A·로그인 · 검증', { untilLabel: '머지 중' })])] })
    expect(r.hosts).toHaveLength(1)
    const d = r.hosts[0].desks[0]
    expect(d).toMatchObject({ kind: 'temp', label: '레인A', temp: { lane: '레인A', summary: '로그인 · 검증' } })
    expect(d.watcher?.untilLabel).toBe('머지 중')
    expect(r.hosts[0].watcher).toBeNull() // 행의 「감시자」가 아니다
    expect(r.hosts[0].slots).toBeNull()
  })
  it('coord 는 lead 책상(팀장(조정))이고 레인 수(slots)로 빈 팀원 책상을 만들지 않는다', () => {
    const r = assembleRoster({ floors: [floor([seat('o1', 'jji/mac/w1', 'ACTIVE')], [watcher('jji/mac/coord', { slots: 5, busy: 2 })])] })
    const h = r.hosts[0]
    expect(h.desks.map(d => `${d.kind}:${d.label}`)).toEqual(['lead:팀장(조정)', 'member:팀원 1'])
    expect(h.slots).toBeNull()
    expect(r.tiles.empty).toBe(0)
  })
  it('coord:<run-id> 도 팀장(조정) 책상이고 행 감시자·좌석 수에서 빠진다', () => {
    const r = assembleRoster({ floors: [floor([], [watcher('jji/mac/coord:r1', { slots: 5, busy: 1 })])] })
    expect(r.hosts[0].desks.map(d => `${d.kind}:${d.label}`)).toEqual(['lead:팀장(조정)'])
    expect(r.hosts[0].watcher).toBeNull()
    expect(r.tiles.empty).toBe(0)
  })
  it('실제 키 형태 — coord:<run-id> 1 + 임시:<레인>·<요약> 3 이면 한 PC 행에 팀장 1·임시 팀원 3', () => {
    const base = 'jongik-jang/jangjong-ig-ui-macbookair-813'
    const r = assembleRoster({ floors: [floor([], [
      watcher(`${base}/coord:rule-set-subset-call-2026-10-06`, { slots: 3, busy: 3 }),
      watcher(`${base}/임시:eng·SET 노드 엔진 계약·흐름·실행·cactus 미리 받기`, { untilLabel: '작업 중' }),
      watcher(`${base}/임시:srv·서버 저장`, { untilLabel: '작업 중' }),
      watcher(`${base}/임시:ui·화면`, { untilLabel: '작업 중' }),
    ])] })
    expect(r.hosts).toHaveLength(1)
    const d = r.hosts[0].desks
    expect(d.filter(x => x.kind === 'lead')).toHaveLength(1)
    expect(d.filter(x => x.kind === 'temp').map(x => x.label)).toEqual(['eng', 'srv', 'ui'])
    expect(d.find(x => x.label === 'eng')?.temp?.summary).toBe('SET 노드 엔진 계약·흐름·실행·cactus 미리 받기')
    expect(d).toHaveLength(4)
  })
  it('접두만 같은 coordinator 는 일반 감시자처럼 다룬다(회귀)', () => {
    const r = assembleRoster({ floors: [floor([], [watcher('jji/mac/coordinator', { slots: 2 })])] })
    expect(r.hosts[0].watcher?.agent).toBe('jji/mac/coordinator')
    expect(r.tiles.empty).toBe(2)
  })
  it('일반 감시자와 같이 있어도 행의 감시자·좌석 수는 일반 감시자 기준(회귀)', () => {
    const r = assembleRoster({ floors: [floor([], [
      watcher('jji/mac/lead', { slots: 2, lastSeenAt: '2026-10-06T00:00:00Z' }),
      watcher('jji/mac/coord', { slots: 9, lastSeenAt: '2026-10-06T01:00:00Z' }),
      watcher('jji/mac/임시:a·x', { slots: 7, lastSeenAt: '2026-10-06T02:00:00Z', untilLabel: '대기' }),
    ])] })
    const h = r.hosts[0]
    expect(h.watcher?.agent).toBe('jji/mac/lead')
    expect(h.slots).toBe(2)
    expect(h.desks.filter(d => d.kind === 'empty')).toHaveLength(2)
    expect(r.tiles.empty).toBe(2)
  })
  it('정렬 — 팀장 먼저, w<N> 번호순, 임시 팀원은 레인 이름순(숫자는 수로)으로 맨 뒤', () => {
    const r = assembleRoster({ floors: [floor(
      [seat('o10', 'jji/mac/w10', 'ACTIVE'), seat('o2', 'jji/mac/w2', 'ACTIVE')],
      [
        watcher('jji/mac/임시:레인10·c'), watcher('jji/mac/임시:레인2·b'), watcher('jji/mac/임시:가·a'),
        watcher('jji/mac/poll'), watcher('jji/mac/lead'), watcher('jji/mac/coord', { slots: 3 }),
      ],
    )] })
    // 감시자(조정·팀장·단독 감시) → 팀원 2 → 팀원 10 → 임시(레인 이름순, 숫자는 수로)
    expect(r.hosts[0].desks.map(d => `${d.kind}:${d.label}`)).toEqual([
      'lead:팀장(조정)', 'lead:팀장', 'lead:단독 감시', 'member:팀원 2', 'member:팀원 10', 'temp:가', 'temp:레인2', 'temp:레인10',
    ])
  })
  it('좌석 수가 0 이하인 PC 에서도 임시 팀원은 팀원 뒤에 놓인다', () => {
    const r = assembleRoster({ floors: [floor([seat('o1', 'jji/mac/w1', 'ACTIVE')], [watcher('jji/mac/임시:a·x'), watcher('jji/mac/lead', { slots: 0 })])] })
    expect(r.hosts[0].desks.map(d => d.kind)).toEqual(['lead', 'member', 'temp'])
  })
  it('임시 작업은 타일·에이전트 수·좌석에 섞이지 않는다', () => {
    const r = assembleRoster({ floors: [floor([], [watcher('jji/mac/임시:a·x', { untilLabel: '작업 중' }), watcher('jji/mac/coord', { slots: 3, busy: 3 })])] })
    expect(r.tiles).toEqual({ working: 0, blocked: 0, stale: 0, offline: 0, empty: 0 })
    expect(r.agentCount).toBe(0)
  })
})

const NOW = Date.parse('2026-10-06T09:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const wrow = (agent: string, over: Partial<WatcherRow> = {}): WatcherRow =>
  ({ id: agent, user_id: 'u1', project_id: null, agent, host: null, slots: 2, busy: 0, until_label: null, last_seen_at: ago(60_000), ...over })
const order: OrderRow = {
  id: '11111111-aaaa-4aaa-8aaa-000000000001', project_id: 'p1', wbs_item_id: 'i1', status: 'ready',
  claimed_by: null, claimed_by_user_id: null, claimed_at: null, created_at: ago(7200_000), updated_at: ago(60_000),
  last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, heartbeat_note: null,
}
const rows = (watchers: WatcherRow[]): SeatmapRows => ({
  orders: [order],
  items: [{ id: 'i1', project_id: 'p1', code: 'T', name: 'n', parent_id: 'z1', actual_pct: 0, assignee_member_id: null, tags: ['agent'] }],
  parents: [{ id: 'z1', project_id: 'p1', code: 'WP', name: 'wp', parent_id: null, actual_pct: null, assignee_member_id: null, tags: ['agent'] }],
  reviews: [], watchers, projects: [{ id: 'p1', name: 'mes' }], members: [], predecessors: [],
})

describe('assembleSeatmap — 표시 전용 감시자 제외', () => {
  it('STANDBY 는 일반 감시자(lead·poll·w<N>)만 센다 — coord·임시 팀원은 층 watchers 에는 실리되 세지 않는다', () => {
    const m = assembleSeatmap(rows([
      wrow('jji/mac/lead'), wrow('jji/mac/poll'), wrow('jji/mac/w1'),
      wrow('jji/mac/coord', { slots: 4, busy: 2 }), wrow('jji/mac/coord:r1'), wrow('jji/mac/임시:a·x', { until_label: '작업 중' }), wrow('jji/mac/임시:b·y', { until_label: '끝' }),
    ]), NOW)
    expect(m.counters.standby).toBe(3)
    expect(m.floors[0].watchers).toHaveLength(7) // 에이전트 보기가 책상으로 그린다
  })
  it('일반 감시자만 있을 때는 종전과 같다(회귀)', () => {
    const m = assembleSeatmap(rows([wrow('hong/mbp/lead'), wrow('kim/air/lead')]), NOW)
    expect(m.counters.standby).toBe(2)
  })
  it('내 작업(mine) 필터에서도 같다', () => {
    const m = assembleSeatmap(rows([wrow('me/mbp/lead'), wrow('me/mbp/coord'), wrow('me/mbp/임시:a·x')]), NOW, { mine: { userId: 'u1', memberIds: new Set<string>() } })
    expect(m.counters.standby).toBe(1)
  })
  it('빈자리 대기 사유는 조정 세션·임시 팀원을 「집어갈 에이전트」로 세지 않는다', () => {
    const only = assembleSeatmap(rows([wrow('jji/mac/coord'), wrow('jji/mac/coord:r1'), wrow('jji/mac/임시:a·x')]), NOW)
    expect(only.floors[0].zones[0].seats[0].waitReason?.kind).toBe('agent_off')
    const withLead = assembleSeatmap(rows([wrow('jji/mac/coord'), wrow('jji/mac/lead')]), NOW)
    expect(withLead.floors[0].zones[0].seats[0].waitReason?.kind).toBe('pickup')
  })
  it('임시 팀원은 좌석·구역 요약·주의 띠에 섞이지 않는다', () => {
    const base = assembleSeatmap(rows([]), NOW)
    const withTemp = assembleSeatmap(rows([wrow('jji/mac/임시:a·x', { until_label: '작업 중' }), wrow('jji/mac/coord', { slots: 3, busy: 3 })]), NOW)
    expect(withTemp.floors[0].zones).toEqual(base.floors[0].zones)
    expect(withTemp.attention).toEqual(base.attention)
    expect({ ...withTemp.counters, standby: 0 }).toEqual({ ...base.counters, standby: 0 })
  })
})

describe('assembleAgentHub — 표시 전용 감시자 제외', () => {
  it('허브 감시자 목록에서 coord·임시 팀원을 뺀다', () => {
    const hubRows: AgentHubRows = {
      project: { id: 'p1', name: 'mes' }, agentProject: null, items: [], orders: [], reports: [], approvedItemIds: [],
      members: [], watchers: [wrow('jji/mac/lead'), wrow('jji/mac/coord'), wrow('jji/mac/coord:r1'), wrow('jji/mac/임시:a·x')],
    } as unknown as AgentHubRows
    const hub = assembleAgentHub(hubRows, NOW, { userId: 'u1', isAdmin: false } as never)
    expect(hub.watchers.map(w => w.agent)).toEqual(['jji/mac/lead'])
  })
})
