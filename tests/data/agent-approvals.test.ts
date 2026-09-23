// 사이드바 결재 대기 배지의 수(2026-09-18) — 내가 승인할 수 있는 것만, 남의 프로젝트 수는 흘리지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  actor: null as unknown,
  orders: [] as Array<{ id?: string; wbs_item_id: string | null }>,
  ordersError: null as { message: string } | null,
  items: [] as Array<{ id: string; parent_id: string | null; assignee_member_id: string | null }>,
  memberIds: [] as string[],
  itemReads: 0,
  reports: [] as Array<{ work_order_id: string; decision_count: number | null; created_at: string }>,
  reportsError: null as { message: string } | null,
  reportReads: 0,
  reportOrderIds: [] as string[],
}))

vi.mock('@/lib/authz', () => ({ getActorForView: async () => m.actor }))
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: async () => 'me@x.com' }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: async () => m.memberIds }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'agent_work_reports') {
        m.reportReads++
        const rc = {
          select: () => rc,
          in: (_col: string, ids: string[]) => { m.reportOrderIds = ids; return rc },
          eq: async () => ({ data: m.reports, error: m.reportsError }),
        }
        return rc
      }
      const chain = {
        select: () => chain, eq: () => chain,
        limit: async () => ({ data: m.orders, error: m.ordersError }),
        then: (res: (v: unknown) => void) => { m.itemReads++; res({ data: m.items, error: null }) },
      }
      if (table !== 'agent_work_orders' && table !== 'wbs_items') throw new Error(`unexpected ${table}`)
      return chain
    },
  }),
}))

import { countApprovable, getPendingApprovalCount, getPendingApprovals, sumLatestDecisions } from '@/lib/data/agentApprovals'

const P = '11111111-1111-4111-8111-111111111111'
const actor = (role?: 'admin' | 'member', superuser = false) => ({
  userId: 'u1', teamCode: null, teamId: null, isSuperuser: superuser,
  projectRoles: new Map(role ? [[P, role]] : []), rosterTeams: new Map(),
})
// 트리: root(담당 m-boss) ─ wp(담당 없음) ─ leaf1(담당 m-dev), leaf2 · other(담당 m-other) ─ leaf3
const ITEMS = [
  { id: 'root', parent_id: null, assignee_member_id: 'm-boss' },
  { id: 'wp', parent_id: 'root', assignee_member_id: null },
  { id: 'leaf1', parent_id: 'wp', assignee_member_id: 'm-dev' },
  { id: 'leaf2', parent_id: 'wp', assignee_member_id: null },
  { id: 'other', parent_id: null, assignee_member_id: 'm-other' },
  { id: 'leaf3', parent_id: 'other', assignee_member_id: null },
]
const ORDERS = [{ wbs_item_id: 'leaf1' }, { wbs_item_id: 'leaf2' }, { wbs_item_id: 'leaf3' }, { wbs_item_id: null }]

describe('countApprovable', () => {
  it('관리자는 결재 대기 전부', () => {
    expect(countApprovable(ORDERS, ITEMS, { isAdmin: true, memberIds: [] })).toBe(4)
  })
  it('서브트리 관리자는 자기 하위만', () => {
    expect(countApprovable(ORDERS, ITEMS, { isAdmin: false, memberIds: ['m-boss'] })).toBe(2)
    expect(countApprovable(ORDERS, ITEMS, { isAdmin: false, memberIds: ['m-other'] })).toBe(1)
  })
  it('리프 담당자 본인은 승인할 수 없으니 세지 않는다', () => {
    expect(countApprovable(ORDERS, ITEMS, { isAdmin: false, memberIds: ['m-dev'] })).toBe(0)
  })
})

describe('getPendingApprovalCount', () => {
  beforeEach(() => {
    m.actor = actor('admin'); m.orders = ORDERS; m.ordersError = null; m.items = ITEMS; m.memberIds = []; m.itemReads = 0
    m.reports = []; m.reportsError = null; m.reportReads = 0; m.reportOrderIds = []
  })
  it('비로그인·잘못된 id 는 0', async () => {
    expect(await getPendingApprovalCount('not-a-uuid')).toBe(0)
    m.actor = null
    expect(await getPendingApprovalCount(P)).toBe(0)
  })
  it('관리자는 항목 트리를 읽지 않고 바로 센다', async () => {
    expect(await getPendingApprovalCount(P)).toBe(4)
    expect(m.itemReads).toBe(0)
  })
  it('슈퍼유저도 관리자와 같다', async () => {
    m.actor = actor(undefined, true)
    expect(await getPendingApprovalCount(P)).toBe(4)
  })
  it('로스터에 없는 사람(남의 프로젝트 id 를 넣은 경우 포함)은 0 — 트리도 읽지 않는다', async () => {
    m.actor = actor()
    expect(await getPendingApprovalCount(P)).toBe(0)
    expect(m.itemReads).toBe(0)
  })
  it('멤버는 서브트리 관리자로서 승인할 수 있는 것만', async () => {
    m.actor = actor('member'); m.memberIds = ['m-boss']
    expect(await getPendingApprovalCount(P)).toBe(2)
  })
  it('결재 대기가 없으면 0', async () => {
    m.orders = []
    expect(await getPendingApprovalCount(P)).toBe(0)
  })
  it('조회 실패는 0 으로 위장하지 않고 throw', async () => {
    m.ordersError = { message: 'boom' }
    await expect(getPendingApprovalCount(P)).rejects.toThrow('결재 대기 조회 실패')
  })
})

describe('sumLatestDecisions — 주문마다 최신 completion 만', () => {
  it('반려된 옛 회차는 합산하지 않는다', () => {
    expect(sumLatestDecisions(['o1'], [
      { work_order_id: 'o1', decision_count: 3, created_at: '2026-09-23T01:00:00Z' },
      { work_order_id: 'o1', decision_count: 1, created_at: '2026-09-23T02:00:00Z' },
    ])).toEqual({ known: 1, partial: false })
  })
  it('구 CLI(null)·보고 없음은 0 으로 세지 않고 partial 로 알린다', () => {
    expect(sumLatestDecisions(['o1', 'o2', 'o3'], [
      { work_order_id: 'o1', decision_count: null, created_at: '2026-09-23T01:00:00Z' },
      { work_order_id: 'o2', decision_count: 2, created_at: '2026-09-23T01:00:00Z' },
    ])).toEqual({ known: 2, partial: true })
  })
})

describe('getPendingApprovals — 확인 필요 결정 수', () => {
  const OIDS = [{ id: 'o1', wbs_item_id: 'leaf1' }, { id: 'o2', wbs_item_id: 'leaf2' }, { id: 'o3', wbs_item_id: 'leaf3' }]
  beforeEach(() => {
    m.actor = actor('admin'); m.orders = OIDS; m.ordersError = null; m.items = ITEMS; m.memberIds = []; m.itemReads = 0
    m.reports = []; m.reportsError = null; m.reportReads = 0; m.reportOrderIds = []
  })
  it('관리자 — 승인 가능 주문의 최신 completion 결정 수를 더한다', async () => {
    m.reports = [
      { work_order_id: 'o1', decision_count: 2, created_at: '2026-09-23T02:00:00Z' },
      { work_order_id: 'o2', decision_count: 0, created_at: '2026-09-23T02:00:00Z' },
      { work_order_id: 'o3', decision_count: 1, created_at: '2026-09-23T02:00:00Z' },
    ]
    expect(await getPendingApprovals(P)).toEqual({ count: 3, decisions: 3, decisionsPartial: false })
  })
  it('구 CLI 보고가 섞이면 아는 수 + partial — "2건 이상 · 일부 구버전" 의 재료', async () => {
    m.reports = [
      { work_order_id: 'o1', decision_count: 2, created_at: '2026-09-23T02:00:00Z' },
      { work_order_id: 'o2', decision_count: null, created_at: '2026-09-23T02:00:00Z' },
      { work_order_id: 'o3', decision_count: 0, created_at: '2026-09-23T02:00:00Z' },
    ]
    expect(await getPendingApprovals(P)).toEqual({ count: 3, decisions: 2, decisionsPartial: true })
  })
  it('서브트리 관리자는 자기 하위 주문의 결정만 센다 — 남의 서브트리 결정을 읽지 않는다', async () => {
    m.actor = actor('member'); m.memberIds = ['m-boss']
    m.reports = [
      { work_order_id: 'o1', decision_count: 1, created_at: '2026-09-23T02:00:00Z' },
      { work_order_id: 'o2', decision_count: 1, created_at: '2026-09-23T02:00:00Z' },
    ]
    expect(await getPendingApprovals(P)).toEqual({ count: 2, decisions: 2, decisionsPartial: false })
    expect(m.reportOrderIds).toEqual(['o1', 'o2'])
  })
  it('승인할 것이 없으면(리프 담당자 본인) 보고를 읽지 않는다', async () => {
    m.actor = actor('member'); m.memberIds = ['m-dev']
    expect(await getPendingApprovals(P)).toEqual({ count: 0, decisions: 0, decisionsPartial: false })
    expect(m.reportReads).toBe(0)
  })
  it('결정 수 조회만 실패하면 건수는 유지하고 decisions:null — 0 으로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.reportsError = { message: 'boom' }
    expect(await getPendingApprovals(P)).toEqual({ count: 3, decisions: null, decisionsPartial: false })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
