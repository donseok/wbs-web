// tests/data/agent-hub.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
import { fetchAgentHubRows, getAgentHub } from '@/lib/data/agentHub'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const P1 = 'p1'
type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답 큐 + 호출 기록(select 컬럼·필터). 체인은 전부 자기 자신, await 시 큐 응답. */
function admin(queues: Record<string, Resp[]>, userEmail: string | null = 'yoo@example.com') {
  const calls: Array<{ table: string; select?: string; filters: Array<[string, unknown[]]> }> = []
  const client = {
    from: vi.fn((table: string) => {
      const rec = { table, filters: [] as Array<[string, unknown[]]> } as (typeof calls)[number]
      calls.push(rec)
      const resp = (queues[table] ?? []).shift() ?? { data: [], error: null }
      const b: Record<string, unknown> = {}
      b.select = (cols: string) => { rec.select = cols; return b }
      for (const k of ['eq', 'in', 'or', 'gte', 'order', 'limit']) b[k] = (...a: unknown[]) => { rec.filters.push([k, a]); return b }
      b.maybeSingle = async () => ({ data: Array.isArray(resp.data) ? (resp.data[0] ?? null) : (resp.data ?? null), error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? [], error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: userEmail ? { email: userEmail } : null }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { client, calls }
}

beforeEach(() => vi.clearAllMocks())

describe('fetchAgentHubRows', () => {
  it('1차 6건(항목·등록·주문·감시자·로스터·프로젝트) 병렬 + 2차 보고 1건, 컬럼·필터가 계약대로', async () => {
    const { client, calls } = admin({
      wbs_items: [{ data: [{ id: 'i1', project_id: P1, parent_id: null, code: 'T', name: 'n', sort_order: 0, milestone: false, dev_workflow: true, tags: ['agent'], assignee_member_id: null, agent_prompt: null, actual_pct: 0, stage: null }] }],
      agent_projects: [{ data: [{ enabled: true }] }],
      agent_work_orders: [{ data: [{ id: 'o1', project_id: P1, wbs_item_id: 'i1', status: 'reported', claimed_by: 'a', claimed_by_user_id: null, claimed_at: null, created_at: 'x', updated_at: 'x', last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, heartbeat_note: null }] }],
      agent_work_reports: [{ data: [{ work_order_id: 'o1', percent: 100, summary: 's', links: [], agent: 'a', review_action: null, review_note: null, created_at: 'x' }] }],
      agent_watchers: [{ data: [] }],
      project_members: [{ data: [{ id: 'm1', name: '장', email: 'yoo@example.com', user_id: null }] }],
      projects: [{ data: [{ id: P1, name: 'mes-base' }] }],
    })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    expect(rows.project).toEqual({ id: P1, name: 'mes-base' })
    expect(rows.agentProject).toEqual({ enabled: true })
    expect(rows.reports).toHaveLength(1)
    const c = (t: string) => calls.find(x => x.table === t)!
    expect(c('wbs_items').select).toBe('id, project_id, parent_id, code, name, sort_order, milestone, dev_workflow, tags, assignee_member_id, agent_prompt, actual_pct, stage, external_ref, depends')
    expect(rows.approvedItemIds).toEqual([]) // depends 가 없으면 선행 승인 조회도 없다
    expect(c('agent_work_orders').select).toContain('last_heartbeat_at')
    expect(c('agent_work_orders').filters.find(f => f[0] === 'or')?.[1][0]).toContain('status.in.(ready,claimed,reported)')
    expect(c('agent_work_reports').filters).toEqual(expect.arrayContaining([['in', ['work_order_id', ['o1']]], ['eq', ['kind', 'completion']]]))
    expect(c('project_members').select).toBe('id, name, email, user_id')
    expect(calls.map(x => x.table).sort()).toEqual(['agent_projects', 'agent_watchers', 'agent_work_orders', 'agent_work_reports', 'project_members', 'projects', 'wbs_items'])
  })
  it('살아 있는 주문이 없으면 보고 조회를 생략한다(2차 0건)', async () => {
    const { client, calls } = admin({ agent_work_orders: [{ data: [] }], projects: [{ data: [{ id: P1, name: 'x' }] }] })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    expect(rows.reports).toEqual([])
    expect(calls.some(x => x.table === 'agent_work_reports')).toBe(false)
  })
  it('어느 조회든 실패하면 throw — 데이터 없음으로 위장하지 않는다', async () => {
    const { client } = admin({ wbs_items: [{ data: null, error: { message: 'boom' } }] })
    await expect(fetchAgentHubRows(client as never, P1, NOW)).rejects.toThrow(/항목 조회 실패: boom/)
  })
  it('agent_projects 가 없으면 null(미등록)', async () => {
    const { client } = admin({ agent_projects: [{ data: [] }], projects: [{ data: [{ id: P1, name: 'x' }] }] })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    expect(rows.agentProject).toBeNull()
  })
})

describe('getAgentHub', () => {
  it('뷰어 이메일을 auth 로 읽어 본인 판정에 쓴다(로스터 email 매칭)', async () => {
    const { client } = admin({
      wbs_items: [{ data: [{ id: 'i1', project_id: P1, parent_id: null, code: 'T', name: 'n', sort_order: 0, milestone: false, dev_workflow: true, tags: [], assignee_member_id: 'm1', agent_prompt: null, actual_pct: 0, stage: null }] }],
      project_members: [{ data: [{ id: 'm1', name: '장', email: 'YOO@example.com', user_id: null }] }],
      projects: [{ data: [{ id: P1, name: 'x' }] }],
    })
    const hub = await getAgentHub(P1, { userId: 'u1', isAdmin: false }, NOW)
    expect(client.auth.admin.getUserById).toHaveBeenCalledWith('u1')
    expect(hub.rows[0].assigneeMine).toBe(true)
    expect(hub.rows[0].canToggle).toBe(true)
  })
  it('뷰어 조회 실패는 throw', async () => {
    const { client } = admin({ projects: [{ data: [{ id: P1, name: 'x' }] }] })
    client.auth.admin.getUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'nope' } } as never)
    await expect(getAgentHub(P1, { userId: 'u1', isAdmin: false }, NOW)).rejects.toThrow(/뷰어 조회 실패/)
  })
})

describe('fetchAgentHubRows — 선행 승인 주문(approvedItemIds)', () => {
  const base = { id: 'i1', project_id: P1, parent_id: null, code: 'T', name: 'n', sort_order: 0, milestone: false, dev_workflow: true, tags: ['agent'], assignee_member_id: null, agent_prompt: null, actual_pct: 0, stage: null, external_ref: null, depends: null }
  it('위임 항목의 depends 가 가리키는 항목 id 로 approved 주문을 1회 더 조회한다', async () => {
    const { client, calls } = admin({
      wbs_items: [{ data: [{ ...base, depends: ['M/T0'] }, { ...base, id: 'i0', code: 'T0', tags: [], external_ref: 'M/T0', stage: 'ip' }] }],
      agent_work_orders: [{ data: [] }, { data: [{ wbs_item_id: 'i0' }] }],
    })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    const orderCalls = calls.filter(x => x.table === 'agent_work_orders')
    expect(orderCalls).toHaveLength(2)
    expect(orderCalls[1].select).toBe('wbs_item_id')
    expect(orderCalls[1].filters).toEqual([['in', ['wbs_item_id', ['i0']]], ['eq', ['status', 'approved']]])
    expect(rows.approvedItemIds).toEqual(['i0'])
  })
  it('depends 가 가리키는 external_ref 가 프로젝트에 없으면 조회하지 않는다', async () => {
    const { client, calls } = admin({ wbs_items: [{ data: [{ ...base, depends: ['M/T9'] }] }], agent_work_orders: [{ data: [] }] })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    expect(calls.filter(x => x.table === 'agent_work_orders')).toHaveLength(1)
    expect(rows.approvedItemIds).toEqual([])
  })
})
