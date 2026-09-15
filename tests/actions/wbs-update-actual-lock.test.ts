// 수기 실적 100 잠금(스펙 2026-09-15 §3.6 / D7) — 에이전트 관할 작업(위임됨 ∨ 주문 claimed·reported)은 99 까지.
// ready 주문은 dev_workflow 리프마다 상주하므로 잠금이 아니다. D-CUBE(dev_workflow=false)는 종전대로 0~100.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  requireProjectMember: vi.fn(),
  requireProjectAdmin: vi.fn(),
  resolveProjectId: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})
vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember, requireProjectAdmin: mocks.requireProjectAdmin,
  requireSuperuser: vi.fn(), resolveProjectId: mocks.resolveProjectId, getActor: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(), getMembership: vi.fn(), getDisplayName: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: vi.fn(async () => ({ count: 0 })) }))

import { updateActual } from '@/app/actions/wbs'

const W1 = '33333333-3333-4333-8333-333333333333'
type Resp = { data?: unknown; error?: { message: string } | null }
const ADMIN = { ok: true, actor: { userId: 'u1', isSuperuser: false, projectRoles: new Map([['p1', 'admin']]), rosterTeams: new Map(), teamCode: null, teamId: null } }
const LOCKED_MSG = '완료는 승인 버튼으로 처리합니다 — 에이전트 관할 작업(위임됨·작업 중·검수 대기)은 99% 까지 입력할 수 있습니다. 직접 완료하려면 위임을 끄세요.'

/** 세션 클라이언트 흉내 — 테이블별 순차 응답, update·insert payload 와 호출 테이블을 기록한다. */
function server(queues: Record<string, Resp[]>) {
  const calls: string[] = []
  const writes: Array<{ table: string; payload: unknown }> = []
  const client = {
    from: (table: string) => {
      calls.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit', 'order']) b[k] = () => b
      b.update = (payload: unknown) => { writes.push({ table, payload }); return b }
      b.insert = (payload: unknown) => { writes.push({ table, payload }); return b }
      b.single = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.maybeSingle = b.single
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    },
  }
  mocks.createServerClient.mockResolvedValue(client)
  return { calls, writes }
}
const item = (over: Record<string, unknown> = {}) => ({ data: { id: W1, actual_pct: 40, project_id: 'p1', dev_workflow: true, tags: [], ...over } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  mocks.requireProjectMember.mockResolvedValue(ADMIN)
})

describe('updateActual — 에이전트 관할 작업의 100 잠금(D7)', () => {
  it('위임된 dev_workflow 항목은 100 거부 — 주문 조회 없이, 쓰기 없음', async () => {
    const { calls, writes } = server({ wbs_items: [item({ tags: ['agent'] }), { data: null }] })
    expect(await updateActual(W1, 100, 40)).toEqual({ ok: false, error: LOCKED_MSG })
    expect(calls).not.toContain('agent_work_orders')
    expect(writes).toHaveLength(0)
  })
  it('위임은 꺼졌지만 reported 주문이 남아 있으면 100 거부', async () => {
    const { writes } = server({ wbs_items: [item(), { data: null }], agent_work_orders: [{ data: { status: 'reported' } }] })
    expect(await updateActual(W1, 100, 40)).toEqual({ ok: false, error: LOCKED_MSG })
    expect(writes).toHaveLength(0)
  })
  it('사람이 하는 dev_workflow 항목(ready 주문만 상주)은 100 저장', async () => {
    const { writes } = server({
      wbs_items: [item(), { data: null }, { data: [{ id: W1 }] }],
      agent_work_orders: [{ data: null }],
    })
    expect(await updateActual(W1, 100, 40)).toEqual({ ok: true })
    expect(writes[0]).toMatchObject({ table: 'wbs_items', payload: { actual_pct: 100 } })
  })
  it('위임돼 있어도 99 는 저장된다 — 사람의 수기 입력은 막지 않는다(D3)', async () => {
    const { calls, writes } = server({ wbs_items: [item({ tags: ['agent'] }), { data: null }, { data: [{ id: W1 }] }] })
    expect(await updateActual(W1, 99, 40)).toEqual({ ok: true })
    expect(calls).not.toContain('agent_work_orders')
    expect(writes[0]).toMatchObject({ table: 'wbs_items', payload: { actual_pct: 99 } })
  })
  it('dev_workflow=false(D-CUBE)는 100 도 그대로 — 주문 조회를 하지 않는다', async () => {
    const { calls } = server({ wbs_items: [item({ dev_workflow: false, tags: ['agent'] }), { data: null }, { data: [{ id: W1 }] }] })
    expect(await updateActual(W1, 100, 40)).toEqual({ ok: true })
    expect(calls).not.toContain('agent_work_orders')
  })
  it('주문 조회가 실패하면 거부 — 모르는 채로 100 을 쓰지 않는다', async () => {
    const { writes } = server({ wbs_items: [item(), { data: null }], agent_work_orders: [{ data: null, error: { message: 'boom' } }] })
    expect(await updateActual(W1, 100, 40)).toEqual({ ok: false, error: '에이전트 주문 확인 실패: boom' })
    expect(writes).toHaveLength(0)
  })
})
