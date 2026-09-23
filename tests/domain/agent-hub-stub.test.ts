// 허브의 스텁 잔존(강제 진행 스펙 F9·F13) — stub 하위는 후행을 부모로 만들지 않고, 행·큐가 잔존 목록을 싣는다.
import { describe, expect, it } from 'vitest'
import type { OrderRow } from '@/lib/domain/seatmap'
import { assembleAgentHub, type AgentHubRows, type HubItemRow } from '@/lib/domain/agentHub'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const P1 = 'p1'
const item = (over: Partial<HubItemRow>): HubItemRow => ({
  id: 'i1', project_id: P1, parent_id: null, code: 'WP-01', name: '루트', sort_order: 0, milestone: false,
  dev_workflow: false, tags: null, assignee_member_id: null, agent_prompt: null, actual_pct: null, stage: null, external_ref: null, depends: null, ...over,
})
const order = (over: Partial<OrderRow>): OrderRow => ({
  id: '11111111-aaaa-4aaa-8aaa-000000000001', project_id: P1, wbs_item_id: 'succ', status: 'reported',
  claimed_by: 'claude-mbp', claimed_by_user_id: 'u1', claimed_at: ago(3600_000), created_at: ago(7200_000),
  updated_at: ago(60_000), last_heartbeat_at: ago(1000), heartbeat_phase: 'build', heartbeat_agent: 'hong/mbp/w1',
  heartbeat_note: null, ...over,
})
const rows = (): AgentHubRows => ({
  project: { id: P1, name: 'mes' }, agentProject: { enabled: true },
  items: [
    item({ id: 'wp', code: 'WP-01', sort_order: 1 }),
    item({ id: 'succ', parent_id: 'wp', code: 'TSK-02', name: '후행', sort_order: 1, dev_workflow: true, tags: ['agent'], stage: 'im', external_ref: 'm/TSK-02' }),
    item({ id: 's1', parent_id: 'succ', code: 'TSK-01', name: '스텁 제거', sort_order: 1, dev_workflow: true, tags: ['agent'], stage: 'ip', stub_for: 'm/TSK-01', external_ref: 'm/TSK-02.stub.TSK-01' }),
  ],
  orders: [order({})],
  reports: [{ work_order_id: order({}).id, percent: 100, summary: '완료', links: [], agent: 'a', review_action: null, review_note: null, created_at: ago(1000) }],
  watchers: [], approvedItemIds: [], members: [],
})

describe('assembleAgentHub — 스텁 잔존', () => {
  const hub = assembleAgentHub(rows(), NOW, { userId: 'u1', userEmail: null, isAdmin: true })
  it('후행은 stub 하위가 있어도 리프다', () => {
    expect(hub.rows.find(r => r.itemId === 'succ')!.isLeaf).toBe(true)
  })
  it('행과 큐에 잔존 목록이 실린다', () => {
    expect(hub.rows.find(r => r.itemId === 'succ')!.stubPending).toEqual([{ subTaskId: 's1', label: '스텁 잔존: TSK-01 대체' }])
    expect(hub.queue.find(q => q.itemId === 'succ')!.stubPending).toEqual([{ subTaskId: 's1', label: '스텁 잔존: TSK-01 대체' }])
  })
})
