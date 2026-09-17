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
  dev_workflow: false, tags: null, assignee_member_id: null, agent_prompt: null, actual_pct: null, stage: null, external_ref: null, depends: null, ...over,
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
  reports: [], watchers: [], approvedItemIds: [],
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

describe('assembleAgentHub — 카운터·큐·상태', () => {
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
    // assigneeMine — a1 담당(m1)이 뷰어(이메일 일치)라 true, a2 담당(m9)은 남이라 false. 카드의 반려 버튼 노출 축(§11).
    expect(hub.queue[1].assigneeMine).toBe(true)
    expect(hub.queue[0].assigneeMine).toBe(false)
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
  it('위임 주문이 0 이어도 이 프로젝트 감시자는 보이고, 결과에 floor 필드가 없다', () => {
    const noOrders = assembleAgentHub(rows({ orders: [], watchers: [w] }), NOW, VIEWER)
    expect(noOrders.watchers.map(x => x.agent)).toEqual(['hong/mbp'])
    expect('floor' in noOrders).toBe(false)
    const withOrders = assembleAgentHub(rows({ watchers: [w] }), NOW, VIEWER)
    expect(withOrders.watchers.map(x => x.agent)).toEqual(['hong/mbp'])
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

describe('assembleAgentHub — 착수 대기 사유(waitReason)', () => {
  const ready = () => order({ wbs_item_id: 'a1', status: 'ready', claimed_by: null, claimed_by_user_id: null, claimed_at: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null })
  const withDep = (over: Partial<AgentHubRows> = {}) => rows({
    items: [
      item({ id: 'a', code: 'SUB-A', name: '첫째', sort_order: 1 }),
      item({ id: 'a1', parent_id: 'a', code: 'TSK-A-01', name: '리프1', sort_order: 1, dev_workflow: true, tags: ['agent'], depends: ['M/T0', 'M/T9'] }),
      item({ id: 'a0', parent_id: 'a', code: 'TSK-A-00', name: '선행', sort_order: 0, dev_workflow: true, external_ref: 'M/T0', stage: 'ip' }),
    ],
    orders: [ready()], ...over,
  })
  const rowOf = (hub: ReturnType<typeof assembleAgentHub>, code: string) => hub.rows.find(r => r.code === code)!
  it('위임된 리프의 주문이 READY 이고 선행이 im 미만·미승인이면 dependency. 프로젝트에 없는 ref 도 미충족', () => {
    const hub = assembleAgentHub(withDep(), NOW, VIEWER)
    const wr = rowOf(hub, 'TSK-A-01').waitReason!
    expect(wr.kind).toBe('dependency')
    expect(wr.label).toBe('선행 대기')
    expect(wr.text).toContain('TSK-A-00 선행(현재 ip(작업 중)), M/T9(프로젝트에 없는 항목)')
    expect(rowOf(hub, 'TSK-A-00').waitReason).toBeNull()
    expect(rowOf(hub, 'SUB-A').waitReason).toBeNull()
  })
  it('선행이 im 이상이거나 승인 주문(approvedItemIds)이 있으면 dependency 가 아니다', () => {
    const im = assembleAgentHub(withDep({ items: [item({ id: 'a1', code: 'TSK-A-01', dev_workflow: true, tags: ['agent'], depends: ['M/T0'] }), item({ id: 'a0', code: 'TSK-A-00', external_ref: 'M/T0', stage: 'im' })] }), NOW, VIEWER)
    expect(rowOf(im, 'TSK-A-01').waitReason!.kind).not.toBe('dependency')
    const ok = assembleAgentHub(withDep({ items: [item({ id: 'a1', code: 'TSK-A-01', dev_workflow: true, tags: ['agent'], depends: ['M/T0'] }), item({ id: 'a0', code: 'TSK-A-00', external_ref: 'M/T0', stage: 'as' })], approvedItemIds: ['a0'] }), NOW, VIEWER)
    expect(rowOf(ok, 'TSK-A-01').waitReason!.kind).not.toBe('dependency')
  })
  it('주문이 없어도(위임만 켬) 판정하고, 이미 claimed 면 null, 위임이 꺼져 있으면 null', () => {
    const noOrder = assembleAgentHub(withDep({ orders: [] }), NOW, VIEWER)
    expect(rowOf(noOrder, 'TSK-A-01').waitReason!.kind).toBe('dependency')
    const claimed = assembleAgentHub(withDep({ orders: [order({ wbs_item_id: 'a1' })] }), NOW, VIEWER)
    expect(rowOf(claimed, 'TSK-A-01').waitReason).toBeNull()
    const off = assembleAgentHub(withDep({ items: [item({ id: 'a1', code: 'TSK-A-01', dev_workflow: true, tags: [], depends: ['M/T0'] }), item({ id: 'a0', code: 'TSK-A-00', external_ref: 'M/T0', stage: 'ip' })] }), NOW, VIEWER)
    expect(rowOf(off, 'TSK-A-01').waitReason).toBeNull()
  })

  // 선행이 없는 리프 — 나머지 사유 셋(에이전트 꺼짐·바쁨·착수 대기)을 가른다.
  // 담당자 m1 은 PAT 계정(user_id)이 이어져 있어야 그 사람의 감시자만 자격을 얻는다(좌석표와 같은 축).
  const solo = (over: Partial<AgentHubRows> = {}) => rows({
    items: [
      item({ id: 'a', code: 'SUB-A', name: '첫째', sort_order: 1 }),
      item({ id: 'a1', parent_id: 'a', code: 'TSK-A-01', name: '리프1', sort_order: 1, dev_workflow: true, tags: ['agent'], assignee_member_id: 'm1' }),
    ],
    orders: [ready()],
    members: [{ id: 'm1', name: '장종익1', email: 'yoo@example.com', user_id: 'u1' }],
    ...over,
  })
  const watcher = (over: Partial<WatcherRow> = {}): WatcherRow => ({
    id: 'w1', user_id: 'u1', project_id: P1, agent: 'hong/mbp', host: 'mbp', slots: 2, busy: 0, until_label: null, last_seen_at: ago(60_000), ...over,
  })
  it('담당자의 감시자가 하나도 없으면 agent_off — 남의 감시자와 죽은 감시자는 세지 않는다', () => {
    const none = assembleAgentHub(solo({ watchers: [] }), NOW, VIEWER)
    const wr = rowOf(none, 'TSK-A-01').waitReason!
    expect(wr.kind).toBe('agent_off')
    expect(wr.label).toBe('에이전트 꺼짐')
    expect(wr.text).toContain('장종익1')
    const others = assembleAgentHub(solo({ watchers: [watcher({ user_id: 'u9', agent: 'nam/pc' })] }), NOW, VIEWER)
    expect(rowOf(others, 'TSK-A-01').waitReason!.kind).toBe('agent_off')
    const dead = assembleAgentHub(solo({ watchers: [watcher({ last_seen_at: ago(71 * 60_000) })] }), NOW, VIEWER)
    expect(rowOf(dead, 'TSK-A-01').waitReason!.kind).toBe('agent_off')
  })
  it('담당자의 감시자가 켜져 있지만 자리가 다 찼으면 agents_busy', () => {
    const hub = assembleAgentHub(solo({ watchers: [watcher({ slots: 2, busy: 2 })] }), NOW, VIEWER)
    const wr = rowOf(hub, 'TSK-A-01').waitReason!
    expect(wr.kind).toBe('agents_busy')
    expect(wr.label).toBe('에이전트 바쁨')
  })
  it('빈자리가 있으면 pickup — 전역 감시자(project_id null)도 이 프로젝트를 본다', () => {
    const hub = assembleAgentHub(solo({ watchers: [watcher({ slots: 2, busy: 1 })] }), NOW, VIEWER)
    expect(rowOf(hub, 'TSK-A-01').waitReason!.kind).toBe('pickup')
    const global = assembleAgentHub(solo({ watchers: [watcher({ project_id: null })] }), NOW, VIEWER)
    expect(rowOf(global, 'TSK-A-01').waitReason!.kind).toBe('pickup')
    const otherProject = assembleAgentHub(solo({ watchers: [watcher({ project_id: 'p2' })] }), NOW, VIEWER)
    expect(rowOf(otherProject, 'TSK-A-01').waitReason!.kind).toBe('agent_off')
  })
  it('담당자가 없는 리프는 프로젝트를 보는 감시자 아무나로 판정한다', () => {
    const hub = assembleAgentHub(solo({
      items: [item({ id: 'a1', code: 'TSK-A-01', dev_workflow: true, tags: ['agent'] })],
      watchers: [watcher({ user_id: 'u9', agent: 'nam/pc' })],
    }), NOW, VIEWER)
    expect(rowOf(hub, 'TSK-A-01').waitReason!.kind).toBe('pickup')
  })
})

describe('assembleAgentHub — 서브트리 관리자(canManage, 트랙 B 2026-09-15)', () => {
  // root → a(SUB-A, 비리프, 담당자 m1) → a1(TSK-A-01, 리프, 본인 미배정 — 조상 경로로만 canManage)
  // root → b(SUB-B, 비리프, 담당자 없음) → a2(TSK-A-02, 리프, 본인 담당 m1 — 조상엔 없다, "리프 본인만" 경로)
  const withManager = (over: Partial<AgentHubRows> = {}) => rows({
    items: [
      item({ id: 'root', code: 'SYS-OP', name: '조업', sort_order: 1 }),
      item({ id: 'a', parent_id: 'root', code: 'SUB-A', name: '첫째', sort_order: 1, assignee_member_id: 'm1' }),
      item({ id: 'a1', parent_id: 'a', code: 'TSK-A-01', name: '리프1', sort_order: 1, dev_workflow: true, tags: ['agent'] }),
      item({ id: 'b', parent_id: 'root', code: 'SUB-B', name: '둘째', sort_order: 2 }),
      item({ id: 'a2', parent_id: 'b', code: 'TSK-A-02', name: '리프2', sort_order: 1, dev_workflow: true, assignee_member_id: 'm1' }),
    ],
    ...over,
  })
  const by = (hub: ReturnType<typeof assembleAgentHub>, c: string) => hub.rows.find(r => r.code === c)!

  it('조상(비리프)의 담당자 = 나(VIEWER=m1) → 그 하위 리프는 canManage:true — 리프 자신은 미배정이어도(assigneeMine:false)', () => {
    const hub = assembleAgentHub(withManager(), NOW, VIEWER)
    expect(by(hub, 'TSK-A-01').canManage).toBe(true)
    expect(by(hub, 'TSK-A-01').assigneeMine).toBe(false)
  })
  it('리프 본인만 담당(조상 SUB-B 는 미배정) → 그 리프는 canManage:false — assigneeMine 과 분리', () => {
    const hub = assembleAgentHub(withManager(), NOW, VIEWER)
    expect(by(hub, 'TSK-A-02').assigneeMine).toBe(true)
    expect(by(hub, 'TSK-A-02').canManage).toBe(false)
  })
  it('무관한 멤버(조상 SUB-A 의 담당자와 다른 사람, m9) → canManage:false', () => {
    const hub = assembleAgentHub(withManager(), NOW, { userId: 'u9', userEmail: null, isAdmin: false })
    expect(by(hub, 'TSK-A-01').canManage).toBe(false)
  })
  it('strict 조상만 본다 — 자기 자신의 담당은 canManage 에 안 잡힌다(비리프 SUB-A 자신의 행)', () => {
    const hub = assembleAgentHub(withManager(), NOW, VIEWER)
    expect(by(hub, 'SUB-A').canManage).toBe(false)
  })
  it('큐(HubQueueEntry) 도 같은 규칙 — reported 주문의 리프가 서브트리 관리 대상이면 canManage:true', () => {
    const oid = '11111111-aaaa-4aaa-8aaa-000000000009'
    const hub = assembleAgentHub(withManager({ orders: [order({ id: oid, wbs_item_id: 'a1', status: 'reported' })] }), NOW, VIEWER)
    expect(hub.queue).toHaveLength(1)
    expect(hub.queue[0]).toMatchObject({ itemId: 'a1', assigneeMine: false, canManage: true })
  })
  // 순환 parent_id 가드(isSubtreeManagerOf 의 visited Set) 자체는 tests/agent/subtree-manager.test.ts 의
  // isSubtreeManager(assignee.ts, 같은 순회 알고리즘)에서 직접 검증한다. 여기서는 그 가드를 다시 증명하지
  // 않고, assembleAgentHub 가 순환 섞인 items 를 받아도 죽지 않는지만 스모크로 확인한다.
  it('assembleAgentHub 자체는 items 배열에 순환(orphan 가지)이 섞여도 멈추거나 던지지 않는다', () => {
    expect(() => assembleAgentHub(withManager({
      items: [
        item({ id: 'root', code: 'SYS-OP', name: '조업', sort_order: 1 }),
        item({ id: 'x', parent_id: 'y', code: 'SYS-X', name: '순환1' }), // x ↔ y 순환 — 루트에 안 닿는 고아 가지
        item({ id: 'y', parent_id: 'x', code: 'SYS-Y', name: '순환2' }),
      ],
    }), NOW, VIEWER)).not.toThrow()
  })
})

describe('assembleAgentHub — 단계(§11)', () => {
  it('행에 wbs_items.stage 가 그대로 실린다(미지정은 null)', () => {
    const hub = assembleAgentHub(rows({ items: [
      item({ id: 'a', code: 'SYS-A', name: '부모', sort_order: 0 }),
      item({ id: 'a1', parent_id: 'a', code: 'TSK-A-01', name: '리프', sort_order: 0, stage: 'ip' }),
      item({ id: 'a2', parent_id: 'a', code: 'TSK-A-02', name: '리프2', sort_order: 1 }),
    ] }), NOW, VIEWER)
    expect(hub.rows.find(r => r.code === 'TSK-A-01')?.stage).toBe('ip')
    expect(hub.rows.find(r => r.code === 'TSK-A-02')?.stage).toBeNull()
    expect(hub.rows.find(r => r.code === 'SYS-A')?.stage).toBeNull()
  })
})

describe('assembleAgentHub — 단계 잠금(stageLocked, 스펙 2026-09-15 §3.5)', () => {
  const idle = { claimed_by: null, claimed_by_user_id: null, claimed_at: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null }
  const lockRows = (orders: OrderRow[]) => rows({
    items: [
      item({ id: 'a', code: 'SUB-A', name: '부모', sort_order: 0 }),
      item({ id: 'd1', parent_id: 'a', code: 'TSK-D', name: '위임 ready', sort_order: 0, dev_workflow: true, tags: ['agent'] }),
      item({ id: 'h1', parent_id: 'a', code: 'TSK-H', name: '사람 ready', sort_order: 1, dev_workflow: true, tags: [] }),
      item({ id: 'h2', parent_id: 'a', code: 'TSK-R', name: '위임 끔 reported', sort_order: 2, dev_workflow: true, tags: [] }),
      item({ id: 'h3', parent_id: 'a', code: 'TSK-N', name: '주문 없음', sort_order: 3, dev_workflow: true, tags: [] }),
    ],
    orders,
  })
  it('위임 행은 잠기고, 미위임은 claimed·reported 주문일 때만 잠긴다(ready 는 dev_workflow 리프마다 상주하므로 제외)', () => {
    const hub = assembleAgentHub(lockRows([
      order({ id: '11111111-aaaa-4aaa-8aaa-00000000000a', wbs_item_id: 'd1', status: 'ready', ...idle }),
      order({ id: '11111111-aaaa-4aaa-8aaa-00000000000b', wbs_item_id: 'h1', status: 'ready', ...idle }),
      order({ id: '11111111-aaaa-4aaa-8aaa-00000000000c', wbs_item_id: 'h2', status: 'reported' }),
    ]), NOW, VIEWER)
    const locked = (code: string) => hub.rows.find(r => r.code === code)!.stageLocked
    expect(locked('TSK-D')).toBe(true)
    expect(locked('TSK-H')).toBe(false)
    expect(locked('TSK-R')).toBe(true)
    expect(locked('TSK-N')).toBe(false)
  })
})
