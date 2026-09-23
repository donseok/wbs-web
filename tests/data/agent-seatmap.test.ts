import { describe, expect, it, vi } from 'vitest'
import { DONE_WINDOW_MS, fetchMyMemberIds, fetchSeatmapRows } from '@/lib/data/agentSeatmap'

const NOW = Date.parse('2026-09-14T09:00:00Z')
type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답 큐 + 호출 기록. 체인은 전부 this 를 돌려주고 await 시 큐를 소비한다. */
function admin(queues: Record<string, Resp[]>, calls: Record<string, unknown[][]> = {}) {
  return {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: [], error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'in', 'eq', 'or', 'gte', 'gt', 'not', 'order', 'limit']) {
        b[k] = (...a: unknown[]) => { (calls[`${table}.${k}`] ??= []).push(a); return b }
      }
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  } as never
}
const O = { id: '11111111-1111-4111-8111-111111111111', project_id: 'p1', wbs_item_id: 'i1', status: 'claimed', claimed_by: 'x', claimed_by_user_id: 'u1', claimed_at: null, created_at: '2026-09-14T08:00:00Z', updated_at: '2026-09-14T08:59:00Z', last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, heartbeat_note: null }

describe('fetchSeatmapRows', () => {
  it('주문 → 항목 → 부모 → 보고 → watcher → 프로젝트 → 팀장 lease 7개 조회를 하고 행 묶음을 돌려준다', async () => {
    const calls: Record<string, unknown[][]> = {}
    const a = admin({
      agent_work_orders: [{ data: [O] }],
      wbs_items: [{ data: [{ id: 'i1', project_id: 'p1', code: 'T', name: 'n', parent_id: 'z1', actual_pct: 25, assignee_member_id: 'm1', tags: ['agent'] }] }, { data: [{ id: 'z1', project_id: 'p1', code: 'Z', name: 'zone', parent_id: null, actual_pct: null, assignee_member_id: null, tags: null }] }],
      agent_work_reports: [{ data: [] }],
      agent_watchers: [{ data: [] }],
      projects: [{ data: [{ id: 'p1', name: 'P' }] }],
    }, calls)
    const rows = await fetchSeatmapRows(a, ['p1'], NOW)
    expect(rows.orders).toHaveLength(1)
    expect(rows.items[0].id).toBe('i1'); expect(rows.parents[0].id).toBe('z1')
    expect(rows.projects[0].name).toBe('P')
    // 담당자 판정에 쓰는 열을 항목 조회에 포함한다
    expect(String(calls['wbs_items.select']?.[0]?.[0] ?? '')).toContain('assignee_member_id')
    expect(String(calls['wbs_items.select']?.[0]?.[0] ?? '')).toContain('tags')
    expect(String(calls['wbs_items.select']?.[0]?.[0] ?? '')).toContain('depends')
    // 로스터는 층 프로젝트 범위로. 선행은 ready 주문이 없으면 조회하지 않는다.
    expect(calls['project_members.in']?.[0]).toEqual(['project_id', ['p1']])
    expect(rows.members).toEqual([]); expect(rows.predecessors).toEqual([])
    // 프로젝트 필터가 걸렸다
    expect(calls['agent_work_orders.in']?.[0]).toEqual(['project_id', ['p1']])
    // DONE 은 7일 창 — approved 는 updated_at >= now-7d 만
    const orFilter = String(calls['agent_work_orders.or']?.[0]?.[0] ?? '')
    expect(orFilter).toContain('status.in.(ready,claimed,reported)')
    expect(orFilter).toContain(`updated_at.gte.${new Date(NOW - DONE_WINDOW_MS).toISOString()}`)
    // 2000건 상한에 걸리면 오름차순은 최신(가장 claimed/ACTIVE 일 가능성이 큰) 주문을 버린다 — 내림차순이어야 한다.
    expect(calls['agent_work_orders.order']?.[0]).toEqual(['created_at', { ascending: false }])
  })
  it('projectIds null(슈퍼유저)이면 프로젝트 필터를 걸지 않는다', async () => {
    const calls: Record<string, unknown[][]> = {}
    await fetchSeatmapRows(admin({ agent_work_orders: [{ data: [] }] }, calls), null, NOW)
    expect(calls['agent_work_orders.in']).toBeUndefined()
  })
  it('projectIds 가 빈 배열이면 조회 없이 빈 묶음', async () => {
    const a = admin({})
    const rows = await fetchSeatmapRows(a, [], NOW)
    expect(rows.orders).toEqual([]); expect((a as { from: { mock: { calls: unknown[] } } }).from.mock.calls).toHaveLength(0)
  })
  it('어느 조회든 error 면 throw — 데이터 없음으로 위장하지 않는다', async () => {
    await expect(fetchSeatmapRows(admin({ agent_work_orders: [{ data: null, error: { message: 'boom' } }] }), ['p1'], NOW))
      .rejects.toThrow(/boom/)
  })
})

describe('fetchMyMemberIds', () => {
  it('내 user_id 또는 이메일(대소문자 무시)과 맞는 로스터 행 id 를 프로젝트 범위 안에서 모은다', async () => {
    const calls: Record<string, unknown[][]> = {}
    const a = admin({ project_members: [{ data: [{ id: 'm1', user_id: 'u1', email: 'A@x.com' }, { id: 'm2', user_id: null, email: 'a@X.com' }, { id: 'm3', user_id: 'u2', email: 'b@x.com' }] }] }, calls)
    const ids = await fetchMyMemberIds(a, { userId: 'u1', userEmail: 'a@x.com' }, ['p1'])
    expect(ids).toEqual(['m1', 'm2'])
    expect(calls['project_members.in']?.[0]).toEqual(['project_id', ['p1']])
  })
  it('projectIds null(슈퍼유저)이면 프로젝트 필터 없이, 이메일이 없으면 user_id 만으로 맞춘다', async () => {
    const calls: Record<string, unknown[][]> = {}
    const a = admin({ project_members: [{ data: [{ id: 'm1', user_id: 'u1', email: 'a@x.com' }, { id: 'm2', user_id: null, email: 'a@x.com' }] }] }, calls)
    expect(await fetchMyMemberIds(a, { userId: 'u1', userEmail: null }, null)).toEqual(['m1'])
    expect(calls['project_members.in']).toBeUndefined()
  })
  it('조회 실패는 throw', async () => {
    await expect(fetchMyMemberIds(admin({ project_members: [{ data: null, error: { message: 'roster boom' } }] }), { userId: 'u1', userEmail: null }, ['p1'])).rejects.toThrow(/roster boom/)
  })
})

describe('fetchSeatmapRows — 선행 항목(predecessors)', () => {
  const READY = { ...O, status: 'ready', claimed_by: null, claimed_by_user_id: null }
  const ITEM = { id: 'i1', project_id: 'p1', code: 'T', name: 'n', parent_id: null, actual_pct: 0, assignee_member_id: null, tags: ['agent'], depends: ['M/T1', 'M/T2'] }
  it('ready 주문 항목의 depends 가 있으면 프로젝트 안 external_ref 로 선행 항목 1회, 그 id 의 approved 주문 1회를 더 조회한다', async () => {
    const calls: Record<string, unknown[][]> = {}
    const a = admin({
      agent_work_orders: [{ data: [READY] }, { data: [{ wbs_item_id: 'x1' }] }],
      wbs_items: [{ data: [ITEM] }, { data: [
        { id: 'x1', project_id: 'p1', external_ref: 'M/T1', code: 'X1', name: 'x1', stage: 'ip' },
        { id: 'x2', project_id: 'p1', external_ref: 'M/T2', code: 'X2', name: 'x2', stage: null, actual_pct: 100 },
      ] }],
    }, calls)
    const rows = await fetchSeatmapRows(a, ['p1'], NOW)
    expect(calls['wbs_items.in']?.[1]).toEqual(['project_id', ['p1']])
    expect(calls['wbs_items.in']?.[2]).toEqual(['external_ref', ['M/T1', 'M/T2']])
    expect(calls['agent_work_orders.in']?.[1]).toEqual(['wbs_item_id', ['x1', 'x2']])
    expect(calls['agent_work_orders.eq']?.[0]).toEqual(['status', 'approved'])
    expect(rows.predecessors).toEqual([
      { id: 'x1', project_id: 'p1', external_ref: 'M/T1', code: 'X1', name: 'x1', stage: 'ip', order_approved: true },
      { id: 'x2', project_id: 'p1', external_ref: 'M/T2', code: 'X2', name: 'x2', stage: null, actual_pct: 100, order_approved: false },
    ])
  })
  it('depends 가 있어도 그 항목의 주문이 ready 가 아니면 선행을 조회하지 않는다', async () => {
    const calls: Record<string, unknown[][]> = {}
    const rows = await fetchSeatmapRows(admin({ agent_work_orders: [{ data: [O] }], wbs_items: [{ data: [ITEM] }] }, calls), ['p1'], NOW)
    expect(calls['wbs_items.in']).toHaveLength(1)
    expect(calls['agent_work_orders.in']).toHaveLength(1)
    expect(rows.predecessors).toEqual([])
  })
  it('선행 조회가 error 면 throw — 미충족으로 위장하지 않는다', async () => {
    const a = admin({ agent_work_orders: [{ data: [READY] }], wbs_items: [{ data: [ITEM] }, { data: null, error: { message: 'boom' } }] })
    await expect(fetchSeatmapRows(a, ['p1'], NOW)).rejects.toThrow('선행 항목')
  })
})
