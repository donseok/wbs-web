// 결재 대기 배지(2026-09-18 규칙: 지금 승인할 수 있는 것만)는 스텁 잔존 주문을 세지 않는다(강제 진행 스펙 §3.6).
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActorForView: vi.fn() }))
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: vi.fn() }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: vi.fn() }))
import { countApprovable } from '@/lib/data/agentApprovals'

const items = [
  { id: 'wp', parent_id: null, assignee_member_id: 'lead', stub_for: null, stage: null },
  { id: 'succ', parent_id: 'wp', assignee_member_id: 'dev', stub_for: null, stage: 'im' },
  { id: 's1', parent_id: 'succ', assignee_member_id: 'dev', stub_for: 'm/TSK-01', stage: 'ip' },
  { id: 'other', parent_id: 'wp', assignee_member_id: 'dev', stub_for: null, stage: 'im' },
]
const orders = [{ wbs_item_id: 'succ' }, { wbs_item_id: 'other' }]

describe('countApprovable — 스텁 잔존 주문은 세지 않는다(지금 승인할 수 있는 것만)', () => {
  const stubRows = items.filter(i => i.stub_for)
  it('관리자', () => {
    expect(countApprovable(orders, [], { isAdmin: true, memberIds: [] }, stubRows)).toBe(1)
  })
  it('서브트리 관리자', () => {
    expect(countApprovable(orders, items, { isAdmin: false, memberIds: ['lead'] }, stubRows)).toBe(1)
  })
  it('stubRows 를 안 넘기면 종전과 같다', () => {
    expect(countApprovable(orders, [], { isAdmin: true, memberIds: [] })).toBe(2)
  })
  it('stub 하위 자신의 주문은 후행 담당자가 서브트리 관리자로 세지 않는다(F15)', () => {
    expect(countApprovable([{ wbs_item_id: 's1' }], items, { isAdmin: false, memberIds: ['dev'] }, stubRows)).toBe(0)
    expect(countApprovable([{ wbs_item_id: 's1' }], items, { isAdmin: false, memberIds: ['lead'] }, stubRows)).toBe(1)
  })
})
