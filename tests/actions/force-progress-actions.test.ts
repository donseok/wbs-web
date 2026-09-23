// 면제·해제·하위 취소 액션 — 가드(관리자·서브트리 관리자)·사유 필수·RPC 사유 문구·하위 주문 보장·취소 거부.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveProjectId: vi.fn(), requireSubtreeManagerOrAdmin: vi.fn(), createAdminClient: vi.fn(), ensureOrder: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ resolveProjectId: mocks.resolveProjectId }))
vi.mock('@/lib/agent/subtreeManager', () => ({ requireSubtreeManagerOrAdmin: mocks.requireSubtreeManagerOrAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureOrderForWorkflowLeaf: mocks.ensureOrder }))

import { cancelStubTask, setDependencyWaiver } from '@/app/actions/forceProgress'

const ITEM = '44444444-4444-4444-8444-444444444444'
const SUB = '55555555-5555-4555-8555-555555555555'

function adminWith(opts: { rpc?: unknown; tables?: Record<string, Array<{ data?: unknown; error?: unknown }>> }) {
  const rpc = vi.fn(async () => ({ data: opts.rpc ?? null, error: null }))
  const writes: Array<{ table: string; op: string; payload?: unknown }> = []
  const from = (t: string) => {
    const resp = (opts.tables?.[t] ?? []).shift() ?? { data: null, error: null }
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in', 'is', 'not', 'limit']) b[k] = () => b
    b.update = (payload: unknown) => { writes.push({ table: t, op: 'update', payload }); return b }
    b.delete = () => { writes.push({ table: t, op: 'delete' }); return b }
    b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
    b.single = b.maybeSingle
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
    return b
  }
  mocks.createAdminClient.mockReturnValue({ rpc, from })
  return { rpc, writes }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  mocks.requireSubtreeManagerOrAdmin.mockResolvedValue({ ok: true, actor: { userId: 'u1' }, isAdmin: true })
  mocks.ensureOrder.mockResolvedValue({ ok: true, created: true })
})

describe('setDependencyWaiver', () => {
  it('가드가 거부하면 RPC 를 부르지 않는다', async () => {
    mocks.requireSubtreeManagerOrAdmin.mockResolvedValue({ ok: false, error: '관리자 또는 서브트리 관리자만 할 수 있습니다.' })
    const { rpc } = adminWith({})
    expect(await setDependencyWaiver(ITEM, 'm/TSK-01', true, '병목')).toEqual({ ok: false, error: '관리자 또는 서브트리 관리자만 할 수 있습니다.' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('사유가 비면 거부한다', async () => {
    adminWith({})
    expect(await setDependencyWaiver(ITEM, 'm/TSK-01', true, '  ')).toEqual({ ok: false, error: '사유를 입력하세요.' })
  })
  it('면제 성공 — 하위가 새로 생기면 그 주문을 보장한다', async () => {
    const { rpc } = adminWith({ rpc: { ok: true, changed: true, sub_task_id: SUB, sub_task_created: true } })
    expect(await setDependencyWaiver(ITEM, 'm/TSK-01', true, '병목')).toEqual({ ok: true, subTaskId: SUB, subTaskCreated: true })
    expect(rpc).toHaveBeenCalledWith('set_dependency_waiver', { p_item_id: ITEM, p_pred_ref: 'm/TSK-01', p_waive: true, p_reason: '병목', p_actor: 'u1' })
    expect(mocks.ensureOrder).toHaveBeenCalledWith(expect.anything(), { projectId: 'p1', wbsItemId: SUB, actorUserId: 'u1' })
  })
  it('하위 주문 보장 실패는 면제를 되돌리지 않고 warning 으로 드러낸다', async () => {
    adminWith({ rpc: { ok: true, changed: true, sub_task_id: SUB, sub_task_created: true } })
    mocks.ensureOrder.mockResolvedValue({ ok: false, error: 'db down' })
    const r = await setDependencyWaiver(ITEM, 'm/TSK-01', true, '병목')
    expect(r).toEqual(expect.objectContaining({ ok: true, warning: expect.stringContaining('db down') }))
  })
  it('RPC 거부 사유는 사람 문구로', async () => {
    adminWith({ rpc: { ok: false, reason: 'no_contract' } })
    expect(await setDependencyWaiver(ITEM, 'm/TSK-01', true, '병목')).toEqual({ ok: false, error: '선행 계약 없음' })
  })
})

describe('cancelStubTask', () => {
  it('stub 하위가 아니면 거부한다', async () => {
    adminWith({ tables: { wbs_items: [{ data: { id: SUB, parent_id: ITEM, stub_for: null } }] } })
    expect(await cancelStubTask(SUB)).toEqual({ ok: false, error: '스텁 제거 작업이 아닙니다.' })
  })
  it('에이전트가 쥔 주문(claimed·reported)이 있으면 거부한다', async () => {
    adminWith({ tables: {
      wbs_items: [{ data: { id: SUB, parent_id: ITEM, stub_for: 'm/TSK-01' } }],
      agent_work_orders: [{ data: [{ id: 'o1', status: 'claimed' }] }],
    } })
    expect(await cancelStubTask(SUB)).toEqual({ ok: false, error: '에이전트가 작업 중이거나 보고한 스텁 제거 작업은 취소할 수 없습니다 — 중단·반려로 먼저 정리하세요.' })
  })
  it('ready 주문을 취소하고 행을 지운다(가드는 후행 기준)', async () => {
    const { writes } = adminWith({ tables: {
      wbs_items: [{ data: { id: SUB, parent_id: ITEM, stub_for: 'm/TSK-01' } }, { data: [{ id: SUB }] }],
      agent_work_orders: [{ data: [{ id: 'o1', status: 'ready' }] }, { data: [{ id: 'o1' }] }],
    } })
    expect(await cancelStubTask(SUB)).toEqual({ ok: true })
    expect(mocks.requireSubtreeManagerOrAdmin).toHaveBeenCalledWith(ITEM, 'p1')
    expect(writes.map(w => `${w.table}:${w.op}`)).toEqual(['agent_work_orders:update', 'wbs_items:delete'])
  })
})
