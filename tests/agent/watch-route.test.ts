import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST } from '@/app/api/v1/agent/watch/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '99999999-9999-4999-8999-999999999999'
type Resp = { data?: unknown; error?: { message: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix, token_hash: PAT.hash,
  project_id: null as string | null, scopes: ['work:claim'], enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}

function useAdmin(queues: Record<string, Resp[]>, calls: Record<string, unknown[]> = {}) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.upsert = (payload: unknown, opts: unknown) => { (calls[`${table}:upsert`] ??= []).push([payload, opts]); return b }
      b.delete = () => { (calls[`${table}:delete`] ??= []).push(true); return b }
      b.update = () => b
      b.in = (col: string, vals: unknown) => { (calls[`${table}:in`] ??= []).push([col, vals]); return b }
      for (const k of ['eq', 'lt', 'gt', 'limit', 'order', 'not', 'range']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (body: unknown, bearer = PAT.token) =>
  POST(new NextRequest('http://l/api/v1/agent/watch', {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
const runnerQueues = (runner = RUNNER) => ({ agent_runners: [{ data: runner }, { data: null }], agent_watchers: [{ data: null }, { data: null }] })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('POST /agent/watch', () => {
  it('200 — (user_id, agent) 로 upsert 하고 expires_at = last_seen_at + 70분', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, until: '18:00' })
    expect(res.status).toBe(200)
    const body = await res.json()
    const [payload, opts] = calls['agent_watchers:upsert'][0] as [Record<string, unknown>, Record<string, unknown>]
    expect(payload).toMatchObject({ user_id: 'u-1', agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, until_label: '18:00', project_id: null })
    expect(opts).toEqual({ onConflict: 'user_id,agent' })
    expect(Date.parse(body.expires_at) - Date.parse(payload.last_seen_at as string)).toBe(WATCHER_TTL_MS)
  })
  it('오래된 행(7일)을 같은 호출에서 지운다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    await post({ agent: 'hong/mbp/lead' })
    expect(calls['agent_watchers:delete']).toHaveLength(1)
  })
  it('stop: true — 행을 지우고 stopped 로 답한다(upsert 없음)', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'hong/mbp/lead', stop: true })
    expect((await res.json())).toEqual({ ok: true, stopped: true })
    expect(calls['agent_watchers:upsert']).toBeUndefined()
    expect(calls['agent_watchers:delete']).toHaveLength(1)
  })
  it('프로젝트 한정 PAT 는 project_id 를 강제하고, 다른 값이면 403 forbidden_role', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues({ ...RUNNER, project_id: P1 }), calls)
    const ok = await post({ agent: 'a' })
    expect(ok.status).toBe(200)
    expect((calls['agent_watchers:upsert'][0] as [Record<string, unknown>])[0].project_id).toBe(P1)
    useAdmin(runnerQueues({ ...RUNNER, project_id: P1 }))
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(403)
  })
  it('400 — agent 없음 / project_id 형식 오류 / slots 음수', async () => {
    useAdmin(runnerQueues()); expect((await post({})).status).toBe(400)
    useAdmin(runnerQueues()); expect((await post({ agent: 'a', project_id: 'nope' })).status).toBe(400)
    useAdmin(runnerQueues()); expect((await post({ agent: 'a', slots: -1 })).status).toBe(400)
  })
  it('레거시 시크릿 → 400 identity_required (PAT 전용)', async () => {
    useAdmin(runnerQueues())
    const res = await post({ agent: 'a' }, 'legacy-secret')
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
  })
  it('403 insufficient_scope — work:read 만 있는 PAT', async () => {
    useAdmin(runnerQueues({ ...RUNNER, scopes: ['work:read'] }))
    expect((await post({ agent: 'a' })).status).toBe(403)
  })
})

describe('POST /agent/watch — 재개 요청 전달(0099)', () => {
  const ORDER = {
    id: '44444444-4444-4444-8444-444444444441', project_id: P1, wbs_item_id: 'item-1',
    claimed_by: 'claude-jji-mac', claimed_by_user_id: 'u-1', resume_requested_at: '2026-09-18T00:00:00.000Z', resume_requested_host: 'jji-mac',
  }

  it('내 신원이 점유한 멈춤 작업의 요청을 TSK 코드와 함께 싣는다', async () => {
    useAdmin({
      ...runnerQueues(),
      agent_work_orders: [{ data: [ORDER] }],
      wbs_items: [{ data: [{ id: 'item-1', code: 'TSK-04-02', name: '주문 상세' }] }],
    })
    const res = await post({ agent: 'hong/mbp/lead' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resume_requests).toEqual([{
      order_id: ORDER.id, id8: '44444444', project_id: P1, wbs_item_id: 'item-1',
      code: 'TSK-04-02', name: '주문 상세', host: 'jji-mac',
      claimed_by: 'claude-jji-mac', requested_at: ORDER.resume_requested_at,
      mine: true, design_state: null,
    }])
    expect(body.resume_requests_error).toBeUndefined()
  })

  it('요청이 없으면 빈 배열이다 — 항목 조회를 부르지 않는다', async () => {
    useAdmin({ ...runnerQueues(), agent_work_orders: [{ data: [] }] })
    const body = await (await post({ agent: 'a' })).json()
    expect(body.resume_requests).toEqual([])
  })

  it('조회에 실패하면 빈 배열로 위장하지 않고 null 과 사유를 준다(에러 3원칙)', async () => {
    useAdmin({ ...runnerQueues(), agent_work_orders: [{ data: null, error: { message: 'boom' } }] })
    const res = await post({ agent: 'a' })
    expect(res.status).toBe(200) // 존재 신호 자체는 기록됐다 — 팀장의 하트비트를 500 으로 끊지 않는다
    const body = await res.json()
    expect(body.resume_requests).toBeNull()
    expect(body.resume_requests_error).toBe('재개 요청 조회에 실패했습니다.')
  })
})

describe('holder — lease 쥔 프로젝트의 재개 요청만', () => {
  const H = '0123abcd-0000-4000-8000-00000000abcd:12345'
  const order = (pid: string) => ({
    id: `${pid.slice(0, 8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, project_id: pid, wbs_item_id: null,
    claimed_by: 'claude-mbp', resume_requested_at: '2026-09-23T00:00:00Z', resume_requested_host: 'mbp',
  })
  it('lease 가 있는 프로젝트의 요청만 남긴다', async () => {
    useAdmin({ ...runnerQueues(), agent_lead_leases: [{ data: [{ project_id: P1 }] }], agent_work_orders: [{ data: [order(P1), order(P2)] }] })
    const res = await post({ agent: 'hong/mbp/lead', holder: H })
    const body = await res.json()
    expect(body.resume_requests.map((r: { project_id: string }) => r.project_id)).toEqual([P1])
  })
  it('lease 조회가 실패하면 resume_requests·build_ready 둘 다 null 이다(M-2, 요청 없음으로 위장하지 않는다)', async () => {
    useAdmin({ ...runnerQueues(), agent_lead_leases: [{ error: { message: 'boom' } }], agent_work_orders: [{ data: [order(P1)] }] })
    const body = await (await post({ agent: 'hong/mbp/lead', holder: H })).json()
    expect(body.resume_requests).toBeNull()
    expect(body.resume_requests_error).toBeTruthy()
    expect(body.build_ready).toBeNull()
    expect(body.build_ready_error).toBeTruthy()
  })
  it('holder 형식이 틀리면 400', async () => {
    useAdmin(runnerQueues())
    expect((await post({ agent: 'a', holder: 'mbp' })).status).toBe(400)
  })
  it('holder 가 없으면 기존 동작(프로젝트를 가리지 않음)', async () => {
    useAdmin({ ...runnerQueues(), agent_work_orders: [{ data: [order(P1), order(P2)] }] })
    const body = await (await post({ agent: 'hong/mbp/lead' })).json()
    expect(body.resume_requests).toHaveLength(2)
  })
  it('lease 가 있으면 orders 조회에 project_id in 필터를 건다(held 아닌 프로젝트가 limit 을 먹지 않게)', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin({ ...runnerQueues(), agent_lead_leases: [{ data: [{ project_id: P1 }] }], agent_work_orders: [{ data: [order(P1)] }] }, calls)
    await post({ agent: 'hong/mbp/lead', holder: H })
    // 첫 in 호출이 재개 요청 조회다(뒤의 in 호출은 build 목록 조회 — 계약 2.11).
    expect(calls['agent_work_orders:in']?.[0]).toEqual(['project_id', [P1]])
  })
  it('lease 가 하나도 없으면 orders 를 조회하지 않고 즉시 빈 배열이다', async () => {
    const admin = useAdmin({ ...runnerQueues(), agent_lead_leases: [{ data: [] }] })
    const res = await post({ agent: 'hong/mbp/lead', holder: H })
    const body = await res.json()
    expect(body.resume_requests).toEqual([])
    expect(admin.from.mock.calls.some((c: unknown[]) => c[0] === 'agent_work_orders')).toBe(false)
  })
})

describe('POST /agent/watch — 계약 2.11', () => {
  it('build_ready — 승인·확정된 주문 중 action build ∧ mine 만 싣는다(D22)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_watchers: [{ data: null }, { data: null }],
      // holder 없음 — I-1(리뷰 수정 1회차) 이후 build_ready 는 accessibleProjectIds(PAT 가 접근 가능한 프로젝트)로 좁힌다.
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [] },   // 재개 요청 없음
        { data: [{ id: '22222222-2222-4222-8222-222222222222', project_id: P1, wbs_item_id: 'w-1', status: 'ready',
          claimed_by: null, claimed_by_user_id: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null,
          design_state: 'accepted', claim_scope: null, design_note: null, runner: null, runner_seen_at: null }] },
        { data: [] },   // loadItemFacts approved
      ],
      wbs_items: [{ data: [{ id: 'w-1', project_id: P1, code: '1.1', name: 'x', external_ref: 'M/TSK-01-01', stage: 'dd', actual_pct: 20,
        tags: ['agent'], depends: [], depends_waived: [], design_mode: 'human' }] }],
    })
    const res = await post({ agent: 'hong/mbp/lead', project_id: P1, require_tag: 'agent' })
    expect(res.status).toBe(200)
    expect((await res.json()).build_ready).toEqual([{ order_id: '22222222-2222-4222-8222-222222222222', id8: '22222222', code: '1.1', name: 'x', status: 'ready' }])
  })
  it('build_ready — require_tag 불일치면 빠진다(M-1)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_watchers: [{ data: null }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [] },
        { data: [{ id: '22222222-2222-4222-8222-222222222222', project_id: P1, wbs_item_id: 'w-1', status: 'ready',
          claimed_by: null, claimed_by_user_id: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null,
          design_state: 'accepted', claim_scope: null, design_note: null, runner: null, runner_seen_at: null }] },
        { data: [] },
      ],
      wbs_items: [{ data: [{ id: 'w-1', project_id: P1, code: '1.1', name: 'x', external_ref: 'M/TSK-01-01', stage: 'dd', actual_pct: 20,
        tags: ['agent'], depends: [], depends_waived: [], design_mode: 'human' }] }],
    })
    const res = await post({ agent: 'hong/mbp/lead', project_id: P1, require_tag: 'other-tag' })
    expect((await res.json()).build_ready).toEqual([])
  })
  it('I-1(리뷰 수정 1회차) — holder·project_id 없음: build 목록은 이 PAT 가 접근 가능한 프로젝트로만 좁힌다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin({
      ...runnerQueues(),
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      memberships: [
        { data: { is_superuser: false } }, // P1 체크
        { data: { is_superuser: false } }, // P2 체크
      ],
      project_roles: [
        { data: [{ role: 'member' }] }, // P1: 멤버
        { data: [] }, // P2: 비멤버 — accessibleProjectIds 에서 배제
      ],
    }, calls)
    await post({ agent: 'hong/mbp/lead' })
    const projectIdCalls = (calls['agent_work_orders:in'] as Array<[string, unknown]> | undefined ?? [])
      .filter(([col]) => col === 'project_id')
    expect(projectIdCalls.at(-1)).toEqual(['project_id', [P1]])
  })
  it('I-1(리뷰 수정 1회차) — holder 있음 + projectId 한정: build 목록 조회는 leased 와 projectId 의 교집합만 본다', async () => {
    const H = '0123abcd-0000-4000-8000-00000000abcd:99999'
    const calls: Record<string, unknown[]> = {}
    useAdmin({
      ...runnerQueues(),
      agent_lead_leases: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }], // 둘 다 켜져 있음(A1)
    }, calls)
    await post({ agent: 'hong/mbp/lead', project_id: P1, holder: H })
    const projectIdCalls = (calls['agent_work_orders:in'] as Array<[string, unknown]> | undefined ?? [])
      .filter(([col]) => col === 'project_id')
    expect(projectIdCalls.at(-1)).toEqual(['project_id', [P1]])
  })
  it('A1(최종 수정) — holder 있음: lease 는 enabled 를 보지 않고 발급되므로 build 목록은 켜진(enabled) 프로젝트와 교집합한다', async () => {
    const H = '0123abcd-0000-4000-8000-00000000abcd:99999'
    const calls: Record<string, unknown[]> = {}
    useAdmin({
      ...runnerQueues(),
      agent_lead_leases: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      agent_projects: [{ data: [{ project_id: P1 }] }], // P2 는 중지됨
    }, calls)
    await post({ agent: 'hong/mbp/lead', holder: H })
    expect(calls['agent_projects:in']).toContainEqual(['project_id', [P1, P2]])
    const projectIdCalls = (calls['agent_work_orders:in'] as Array<[string, unknown]> | undefined ?? [])
      .filter(([col]) => col === 'project_id')
    expect(projectIdCalls.at(-1)).toEqual(['project_id', [P1]])
  })
  it('A1(최종 수정) — holder 있음: 켜진 프로젝트 조회가 실패하면 build_ready:null + 사유(위장 금지)', async () => {
    const H = '0123abcd-0000-4000-8000-00000000abcd:99999'
    useAdmin({
      ...runnerQueues(),
      agent_lead_leases: [{ data: [{ project_id: P1 }] }],
      agent_work_orders: [{ data: [] }], // 재개 요청 없음
      agent_projects: [{ data: null, error: { message: 'boom' } }],
    })
    const body = await (await post({ agent: 'hong/mbp/lead', holder: H })).json()
    expect(body.build_ready).toBeNull()
    expect(body.build_ready_error).toBe('구현 대기 목록 조회에 실패했습니다.')
  })
  it('D23(최종 수정) — holder 없음: 접근 가능 프로젝트 조회(accessibleProjectIds)가 throw 하면 build_ready:null + 사유', async () => {
    useAdmin({
      ...runnerQueues(),
      agent_work_orders: [{ data: [] }], // 재개 요청 없음
      agent_projects: [{ data: null, error: { message: 'boom' } }],
    })
    const body = await (await post({ agent: 'hong/mbp/lead' })).json()
    expect(body.build_ready).toBeNull()
    expect(body.build_ready_error).toBe('구현 대기 목록 조회에 실패했습니다.')
  })
  it('build 목록 조회 실패 → build_ready:null + 사유(에러 3원칙, M-2)', async () => {
    useAdmin({
      ...runnerQueues(),
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [] },   // 재개 요청 없음
        { data: null, error: { message: 'boom' } },   // build 목록 조회 실패
      ],
    })
    const body = await (await post({ agent: 'hong/mbp/lead' })).json()
    expect(body.build_ready).toBeNull()
    expect(body.build_ready_error).toBe('구현 대기 목록 조회에 실패했습니다.')
  })
  it('재개 요청에 mine·design_state 를 싣는다 — 다른 PC 가 30분 안에 신호를 낸 주문은 mine 이 아니다(12절 Y10)', async () => {
    const fresh = new Date(Date.now() - 60_000).toISOString()
    const req = (id: string, over: Record<string, unknown>) => ({
      id, project_id: P1, wbs_item_id: null, claimed_by: 'hong/mbp/w1', claimed_by_user_id: 'u-1',
      runner: null, runner_seen_at: null, design_state: null,
      resume_requested_at: '2026-09-27T00:00:00Z', resume_requested_host: 'mbp', ...over,
    })
    useAdmin({
      ...runnerQueues(),
      agent_work_orders: [{ data: [
        req('55555555-5555-4555-8555-555555555555', { design_state: 'accepted' }),
        req('66666666-6666-4666-8666-666666666666', { runner: 'hong/pc2/w1', runner_seen_at: fresh }),
      ] }],
    })
    const body = await (await post({ agent: 'hong/mbp/lead' })).json()
    expect(body.resume_requests.map((r: { id8: string; mine: boolean; design_state: string | null }) => [r.id8, r.mine, r.design_state]))
      .toEqual([['55555555', true, 'accepted'], ['66666666', false, null]])
  })
})
