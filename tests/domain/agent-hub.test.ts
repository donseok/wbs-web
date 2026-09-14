// tests/domain/agent-hub.test.ts
import { describe, expect, it } from 'vitest'
import { OFFLINE_MS, STALE_MS } from '@/lib/domain/seatState'
import type { OrderRow, WatcherRow } from '@/lib/domain/seatmap'
import { assembleAgentHub, type AgentHubRows, type HubItemRow } from '@/lib/domain/agentHub'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const P1 = 'p1'
const item = (over: Partial<HubItemRow>): HubItemRow => ({
  id: 'i1', project_id: P1, parent_id: null, code: 'WP-01', name: '루트', sort_order: 0, milestone: false,
  dev_workflow: false, tags: null, assignee_member_id: null, agent_prompt: null, actual_pct: null, stage: null, ...over,
})
const order = (over: Partial<OrderRow>): OrderRow => ({
  id: '11111111-aaaa-4aaa-8aaa-000000000001', project_id: P1, wbs_item_id: 'i1', status: 'claimed',
  claimed_by: 'claude-mbp', claimed_by_user_id: 'u1', claimed_at: ago(3600_000), created_at: ago(7200_000),
  updated_at: ago(60_000), last_heartbeat_at: ago(1000), heartbeat_phase: 'build', heartbeat_agent: 'hong/mbp/w1',
  heartbeat_note: null, ...over,
})
const VIEWER = { userId: 'u1', userEmail: 'Yoo@Example.com', isAdmin: false }
const rows = (over: Partial<AgentHubRows> = {}): AgentHubRows => ({
  project: { id: P1, name: 'mes-base' }, agentProject: { enabled: true },
  items: [
    item({ id: 'root', code: 'SYS-OP', name: '조업', sort_order: 1 }),
    item({ id: 'b', parent_id: 'root', code: 'SUB-B', name: '둘째', sort_order: 2 }),
    item({ id: 'a', parent_id: 'root', code: 'SUB-A', name: '첫째', sort_order: 1 }),
    item({ id: 'a1', parent_id: 'a', code: 'TSK-A-01', name: '리프1', sort_order: 1, dev_workflow: true, tags: ['agent'], assignee_member_id: 'm1' }),
    item({ id: 'a2', parent_id: 'a', code: 'TSK-A-02', name: '리프2', sort_order: 2, dev_workflow: true, assignee_member_id: 'm9' }),
    item({ id: 'ms', parent_id: 'b', code: 'MS-1', name: '마일스톤', sort_order: 1, milestone: true }),
    item({ id: 'orphan', parent_id: 'ghost', code: 'TSK-X', name: '고아', sort_order: 0 }),
  ],
  orders: [order({ wbs_item_id: 'a1' })],
  reports: [], watchers: [],
  members: [
    { id: 'm1', name: '장종익1', email: 'yoo@example.com', user_id: null },
    { id: 'm9', name: '남', email: 'other@example.com', user_id: 'u9' },
  ],
  ...over,
})

describe('assembleAgentHub — 트리·행', () => {
  it('전위 순서(부모→자식), 형제는 sort_order 오름차순, 고아는 루트 뒤', () => {
    const hub = assembleAgentHub(rows(), NOW, VIEWER)
    expect(hub.rows.map(r => r.code)).toEqual(['SYS-OP', 'SUB-A', 'TSK-A-01', 'TSK-A-02', 'SUB-B', 'MS-1', 'TSK-X'])
    expect(hub.rows.map(r => r.depth)).toEqual([0, 1, 2, 2, 1, 2, 0])
    expect(hub.rows.find(r => r.code === 'SUB-A')!.isLeaf).toBe(false)
    expect(hub.rows.find(r => r.code === 'TSK-A-01')!.isLeaf).toBe(true)
  })
  it('sort_order 가 같으면 code 사전순', () => {
    const hub = assembleAgentHub(rows({ items: [item({ id: 'x', code: 'B' }), item({ id: 'y', code: 'A' })] }), NOW, VIEWER)
    expect(hub.rows.map(r => r.code)).toEqual(['A', 'B'])
  })
  it('canToggle = 리프 && 마일스톤 아님 && (관리자 || 담당자 본인) — 이메일 대소문자 무시', () => {
    const hub = assembleAgentHub(rows(), NOW, VIEWER)
    const by = (c: string) => hub.rows.find(r => r.code === c)!
    expect(by('TSK-A-01').assigneeMine).toBe(true)
    expect(by('TSK-A-01').canToggle).toBe(true)
    expect(by('TSK-A-02').assigneeMine).toBe(false)
    expect(by('TSK-A-02').canToggle).toBe(false)
    expect(by('MS-1').canToggle).toBe(false)
    expect(by('SUB-A').canToggle).toBe(false)
    expect(by('TSK-A-01').assigneeName).toBe('장종익1')
    const admin = assembleAgentHub(rows(), NOW, { ...VIEWER, isAdmin: true })
    expect(admin.rows.find(r => r.code === 'TSK-A-02')!.canToggle).toBe(true)
    expect(admin.viewer.isAdmin).toBe(true)
    expect(hub.viewer.memberIds).toEqual(['m1'])
  })
  it('user_id 링크로도 본인 판정', () => {
    const hub = assembleAgentHub(rows(), NOW, { userId: 'u9', userEmail: null, isAdmin: false })
    expect(hub.rows.find(r => r.code === 'TSK-A-02')!.assigneeMine).toBe(true)
  })
})

describe('assembleAgentHub — 주문 상태', () => {
  const by = (hub: ReturnType<typeof assembleAgentHub>, c: string) => hub.rows.find(r => r.code === c)!
  it('claimed + 신호 5분 이내 → ACTIVE, 에이전트·마지막 신호', () => {
    const r = by(assembleAgentHub(rows(), NOW, VIEWER), 'TSK-A-01')
    expect(r.order?.state).toBe('ACTIVE')
    expect(r.order?.agent).toBe('hong/mbp/w1')
    expect(r.order?.lastSignalAt).toBe(ago(1000))
    expect(r.delegated).toBe(true)
  })
  it('무응답 5분·30분, blocked, reported, ready, approved 7일 이내', () => {
    const mk = (o: Partial<OrderRow>) => by(assembleAgentHub(rows({ orders: [order({ wbs_item_id: 'a1', ...o })] }), NOW, VIEWER), 'TSK-A-01').order
    expect(mk({ last_heartbeat_at: ago(STALE_MS + 1), updated_at: ago(STALE_MS + 1) })?.state).toBe('STALE')
    expect(mk({ last_heartbeat_at: ago(OFFLINE_MS + 1), updated_at: ago(OFFLINE_MS + 1) })?.state).toBe('OFFLINE')
    expect(mk({ heartbeat_phase: 'blocked' })?.state).toBe('BLOCKED')
    expect(mk({ status: 'reported' })?.state).toBe('WAIT')
    expect(mk({ status: 'ready', claimed_by: null, last_heartbeat_at: null })?.state).toBe('READY')
    expect(mk({ status: 'ready', claimed_by: null, last_heartbeat_at: null })?.lastSignalAt).toBeNull()
    expect(mk({ status: 'approved' })?.state).toBe('DONE')
  })
  it('마지막 completion 보고가 reject 면 claimed 는 REJECTED', () => {
    const hub = assembleAgentHub(rows({ reports: [{ work_order_id: '11111111-aaaa-4aaa-8aaa-000000000001', percent: 40, summary: '1차', links: [], agent: 'hong/mbp/w1', review_action: 'reject', review_note: '다시', created_at: ago(30_000) }] }), NOW, VIEWER)
    expect(by(hub, 'TSK-A-01').order?.state).toBe('REJECTED')
  })
  it('살아 있는 주문이 둘이면 updated_at 최신, 주문 없는 리프는 order null', () => {
    const hub = assembleAgentHub(rows({ orders: [
      order({ id: '11111111-aaaa-4aaa-8aaa-000000000001', wbs_item_id: 'a1', updated_at: ago(600_000), status: 'ready', claimed_by: null }),
      order({ id: '11111111-aaaa-4aaa-8aaa-000000000002', wbs_item_id: 'a1', updated_at: ago(10_000) }),
    ] }), NOW, VIEWER)
    expect(by(hub, 'TSK-A-01').order?.id).toBe('11111111-aaaa-4aaa-8aaa-000000000002')
    expect(by(hub, 'TSK-A-02').order).toBeNull()
  })
})

describe('assembleAgentHub — 카운터·큐·층·상태', () => {
  it('counters: delegated(agent 태그 리프)·ready·working·waiting', () => {
    const hub = assembleAgentHub(rows({ orders: [
      order({ id: '11111111-aaaa-4aaa-8aaa-000000000001', wbs_item_id: 'a1' }),
      order({ id: '11111111-aaaa-4aaa-8aaa-000000000002', wbs_item_id: 'a2', status: 'reported' }),
    ] }), NOW, VIEWER)
    expect(hub.counters).toEqual({ delegated: 1, ready: 0, working: 1, waiting: 1 })
  })
  it('queue: reported 주문마다 최신 completion 보고 1건, 오래된 것 먼저, 보고 없으면 빈 요약', () => {
    const o1 = '11111111-aaaa-4aaa-8aaa-000000000001', o2 = '11111111-aaaa-4aaa-8aaa-000000000002'
    const hub = assembleAgentHub(rows({
      orders: [order({ id: o1, wbs_item_id: 'a1', status: 'reported', updated_at: ago(1000) }), order({ id: o2, wbs_item_id: 'a2', status: 'reported', updated_at: ago(5000) })],
      reports: [
        { work_order_id: o1, percent: 90, summary: '옛', links: [], agent: 'x', review_action: null, review_note: null, created_at: ago(9000) },
        { work_order_id: o1, percent: 100, summary: '최신', links: [{ url: 'https://x' }], agent: 'x', review_action: null, review_note: null, created_at: ago(2000) },
      ],
    }), NOW, VIEWER)
    expect(hub.queue.map(q => q.orderId)).toEqual([o2, o1])
    expect(hub.queue[1]).toMatchObject({ code: 'TSK-A-01', summary: '최신', percent: 100, agent: 'x', reportedAt: ago(2000) })
    expect(hub.queue[0]).toMatchObject({ code: 'TSK-A-02', summary: '', percent: 0 })
  })
  it('floor: agent 태그 항목의 주문만 좌석이 된다. 없으면 null', () => {
    const withTag = assembleAgentHub(rows(), NOW, VIEWER)
    expect(withTag.floor?.name).toBe('mes-base')
    expect(withTag.floor?.seatCount).toBe(1)
    const noTag = assembleAgentHub(rows({ orders: [order({ wbs_item_id: 'a2' })] }), NOW, VIEWER)
    expect(noTag.floor).toBeNull()
  })
  it('registered·enabled·projectName·fetchedAt', () => {
    const on = assembleAgentHub(rows(), NOW, VIEWER)
    expect(on).toMatchObject({ registered: true, enabled: true, projectId: P1, projectName: 'mes-base', fetchedAt: new Date(NOW).toISOString() })
    const off = assembleAgentHub(rows({ agentProject: null, project: null }), NOW, VIEWER)
    expect(off).toMatchObject({ registered: false, enabled: false, projectName: '' })
  })
})

describe('assembleAgentHub — 감시자', () => {
  const w: WatcherRow = { id: 'w1', user_id: 'u1', project_id: P1, agent: 'hong/mbp', host: 'mbp', slots: 2, busy: 1, until_label: '18:00', last_seen_at: ago(60_000) }
  it('층이 없어도(위임 주문 0) 이 프로젝트 감시자는 보인다', () => {
    const noFloor = assembleAgentHub(rows({ orders: [], watchers: [w] }), NOW, VIEWER)
    expect(noFloor.floor).toBeNull()
    expect(noFloor.watchers.map(x => x.agent)).toEqual(['hong/mbp'])
    const withFloor = assembleAgentHub(rows({ watchers: [w] }), NOW, VIEWER)
    expect(withFloor.watchers.map(x => x.agent)).toEqual(['hong/mbp'])
  })
  it('다른 프로젝트 감시자·70분 지난 감시자는 빠지고, 전역(project_id null)은 보인다', () => {
    const hub = assembleAgentHub(rows({ orders: [], watchers: [
      { ...w, id: 'w2', agent: 'other', project_id: 'p2' },
      { ...w, id: 'w3', agent: 'old', last_seen_at: ago(71 * 60_000) },
      { ...w, id: 'w4', agent: 'global', project_id: null },
    ] }), NOW, VIEWER)
    expect(hub.watchers.map(x => x.agent)).toEqual(['global'])
  })
})
