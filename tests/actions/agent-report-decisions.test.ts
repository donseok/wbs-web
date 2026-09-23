// 결정 목록 조회 액션(과제 C, 스펙 §7.2·§7.3·§8). 세션 클라이언트 + requireProjectMember — 새 service_role 경로를 만들지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: mocks.requireProjectMember,
}))
vi.mock('@/lib/agent/delegation', () => ({ requireDelegationRight: vi.fn() }))
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: vi.fn() }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: vi.fn(), isSubtreeManager: vi.fn() }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn(async () => {}) }))
vi.mock('next/server', async orig => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/agent/ensureOrder', () => ({ backfillProjectOrders: vi.fn() }))

import { getAgentOrderForItem, getReportDecisions } from '@/app/actions/agentWork'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
type R = { data: unknown; error: { message: string } | null }

/** 테이블별 응답 하나 + select·eq 인자 기록. maybeSingle 과 await(then) 둘 다 같은 응답을 준다. */
function session(byTable: Record<string, R>) {
  const selects: Record<string, string> = {}
  const eqs: Array<[string, string, unknown]> = []
  const sb = {
    from: vi.fn((table: string) => {
      const resp = byTable[table] ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      b.select = (cols: string) => { selects[table] = cols; return b }
      b.eq = (col: string, v: unknown) => { eqs.push([table, col, v]); return b }
      for (const k of ['order', 'limit', 'in']) b[k] = () => b
      b.maybeSingle = async () => resp
      b.then = (r: (v: unknown) => unknown) => Promise.resolve(resp).then(r)
      return b
    }),
  }
  mocks.createServerClient.mockResolvedValue(sb)
  return { selects, eqs }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'u-1' } })
})

describe('getReportDecisions', () => {
  it('비형식 id 는 거부', async () => {
    expect(await getReportDecisions('nope')).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
  it('주문이 없으면 대상 없음', async () => {
    session({ agent_work_orders: { data: null, error: null } })
    expect(await getReportDecisions(O1)).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
  })
  it('프로젝트 멤버가 아니면 가드의 사유로 거부 — 보고를 읽지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
    const { selects } = session({ agent_work_orders: { data: { project_id: P1 }, error: null } })
    expect(await getReportDecisions(O1)).toEqual({ ok: false, error: '멤버 아님' })
    expect(mocks.requireProjectMember).toHaveBeenCalledWith(P1)
    expect(selects.agent_work_reports).toBeUndefined()
  })
  it('최신 completion 의 decisions 원본을 돌려준다(null 도 그대로)', async () => {
    const { eqs } = session({
      agent_work_orders: { data: { project_id: P1 }, error: null },
      agent_work_reports: { data: { decisions: null, created_at: '2026-09-23T00:00:00Z' }, error: null },
    })
    expect(await getReportDecisions(O1)).toEqual({ ok: true, decisions: null })
    expect(eqs).toContainEqual(['agent_work_reports', 'kind', 'completion'])
  })
  it('보고 조회 실패는 빈 목록이 아니라 오류로 올린다', async () => {
    session({
      agent_work_orders: { data: { project_id: P1 }, error: null },
      agent_work_reports: { data: null, error: { message: 'db down' } },
    })
    expect(await getReportDecisions(O1)).toEqual({ ok: false, error: '보고 조회 실패: db down' })
  })
  it('completion 이 없으면 없다고 말한다', async () => {
    session({ agent_work_orders: { data: { project_id: P1 }, error: null }, agent_work_reports: { data: null, error: null } })
    expect(await getReportDecisions(O1)).toEqual({ ok: false, error: '완료 보고가 없습니다.' })
  })
})

describe('getAgentOrderForItem — 보고 이력에 decisions', () => {
  it('보고 select 에 decisions 를 싣는다', async () => {
    const { selects } = session({
      wbs_items: { data: { project_id: P1 }, error: null },
      agent_work_orders: { data: [{ id: O1, status: 'reported', claimed_by: 'a', claimed_at: null, updated_at: '2026-09-23T00:00:00Z' }], error: null },
      agent_work_reports: { data: [], error: null },
    })
    const r = await getAgentOrderForItem(W1)
    expect(r.ok).toBe(true)
    expect(selects.agent_work_reports).toContain('decisions')
  })
})
