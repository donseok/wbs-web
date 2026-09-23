// 사이드바 결재 대기 배지의 수(2026-09-18) — 내가 승인할 수 있는 것만, 남의 프로젝트 수는 흘리지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  actor: null as unknown,
  orders: [] as Array<{ wbs_item_id: string | null }>,
  ordersError: null as { message: string } | null,
  items: [] as Array<{ id: string; parent_id: string | null; assignee_member_id: string | null }>,
  memberIds: [] as string[],
  itemReads: 0,
  stubs: [] as Array<{ id: string; parent_id: string | null; stub_for: string | null; stage: string | null }>,
  stubReads: 0,
}))

vi.mock('@/lib/authz', () => ({ getActorForView: async () => m.actor }))
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: async () => 'me@x.com' }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: async () => m.memberIds }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      // .in('parent_id', …).not('stub_for', …) = 주문 항목들의 stub 하위(0103) 조회 — 트리 조회와 따로 센다.
      let stubQuery = false
      const chain = {
        select: () => chain, eq: () => chain,
        in: () => { stubQuery = true; return chain }, not: () => chain,
        limit: async () => ({ data: m.orders, error: m.ordersError }),
        then: (res: (v: unknown) => void) => {
          if (stubQuery) { m.stubReads++; res({ data: m.stubs, error: null }); return }
          m.itemReads++; res({ data: m.items, error: null })
        },
      }
      if (table !== 'agent_work_orders' && table !== 'wbs_items') throw new Error(`unexpected ${table}`)
      return chain
    },
  }),
}))

import { countApprovable, getPendingApprovalCount } from '@/lib/data/agentApprovals'

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
    m.stubs = []; m.stubReads = 0
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
  it('스텁 잔존 주문은 세지 않는다 — 주문 항목들의 stub 하위만 좁게 한 번 읽는다(강제 진행 §3.6)', async () => {
    m.stubs = [{ id: 's1', parent_id: 'leaf1', stub_for: 'm/TSK-01', stage: 'ip' }]
    expect(await getPendingApprovalCount(P)).toBe(3)
    expect(m.stubReads).toBe(1)
    expect(m.itemReads).toBe(0)
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
