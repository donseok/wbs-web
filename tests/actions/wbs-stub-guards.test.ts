// 강제 진행(스펙 2026-09-23) 서버 가드 — 스텁 잔존이면 실적 100 거부(F6), stub 하위는 리프 판정에 투명(F9),
// stub 하위가 있는 후행·stub 하위 아래에는 일반 하위 추가 금지(F11).
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

import { addWbsItem, updateActual } from '@/app/actions/wbs'

const W1 = '33333333-3333-4333-8333-333333333333'
type Resp = { data?: unknown; error?: { message: string } | null }
const ADMIN = { ok: true, actor: { userId: 'u1', isSuperuser: false, projectRoles: new Map([['p1', 'admin']]), rosterTeams: new Map(), teamCode: null, teamId: null } }

/** 세션 클라이언트 흉내 — 테이블별 순차 응답, update·insert payload 와 호출 테이블을 기록한다. */
function server(queues: Record<string, Resp[]>) {
  const calls: string[] = []
  const writes: Array<{ table: string; payload: unknown }> = []
  const client = {
    from: (table: string) => {
      calls.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit', 'order', 'is', 'not']) b[k] = () => b
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

describe('updateActual — 스텁 잔존이면 100 거부(F6)', () => {
  it('stub 하위가 xx 가 아니면 사람 Task 라도 100 을 거부한다', async () => {
    const { writes } = server({
      wbs_items: [item({ tags: [] }), { data: null }, { data: [{ id: 's1', stub_for: 'm/TSK-01', external_ref: 'm/TSK-02.stub.TSK-01', stage: 'ip' }] }],
      agent_work_orders: [{ data: null }],
    })
    const r = await updateActual(W1, 100)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('스텁이 남아 있어')
    expect(writes).toHaveLength(0)
  })
  it('stub 하위가 모두 xx 면 100 저장', async () => {
    const { writes } = server({
      wbs_items: [item({ tags: [] }), { data: null }, { data: [{ id: 's1', stub_for: 'm/TSK-01', external_ref: null, stage: 'xx' }] }, { data: [{ id: W1 }] }],
      agent_work_orders: [{ data: null }],
    })
    expect((await updateActual(W1, 100)).ok).toBe(true)
    expect(writes[0]).toMatchObject({ table: 'wbs_items', payload: { actual_pct: 100 } })
  })
  it('stub 하위만 있으면 리프로 본다 — 99 는 저장된다(자식 질의가 stub 을 뺀다)', async () => {
    const { writes } = server({ wbs_items: [item({ tags: [] }), { data: null }, { data: [{ id: W1 }] }] })
    expect((await updateActual(W1, 99)).ok).toBe(true)
    expect(writes.some(w => w.table === 'wbs_items')).toBe(true)
  })
  it('stub 하위 조회 실패는 거부(쓰기 전 선행 조회 실패 = 중단)', async () => {
    const { writes } = server({ wbs_items: [item({ tags: [] }), { data: null }, { error: { message: 'db down' } }] })
    const r = await updateActual(W1, 100)
    expect(r).toEqual({ ok: false, error: '스텁 하위 확인 실패: db down' })
    expect(writes).toHaveLength(0)
  })
})

describe('addWbsItem — F11', () => {
  it('stub 하위가 있는 후행에는 일반 하위를 추가할 수 없다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue(ADMIN)
    server({ wbs_items: [{ data: [{ sort_order: 1, is_owner_split: false, stub_for: 'm/TSK-01' }] }] })
    const r = await addWbsItem('p1', W1, '새 항목')
    expect(r).toEqual({ ok: false, error: '스텁 제거 작업이 있는 Task 에는 하위 항목을 추가할 수 없습니다' })
  })
  it('stub 하위 아래에는 추가할 수 없다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue(ADMIN)
    server({ wbs_items: [{ data: [] }, { data: { stub_for: 'm/TSK-01' } }] })
    const r = await addWbsItem('p1', 'sub-id', '새 항목')
    expect(r).toEqual({ ok: false, error: '스텁 제거 작업 아래에는 하위 항목을 둘 수 없습니다' })
  })
})
