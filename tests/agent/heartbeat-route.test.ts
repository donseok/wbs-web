import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST } from '@/app/api/v1/agent/work/[id]/heartbeat/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix, token_hash: PAT.hash,
  project_id: null, scopes: ['work:claim'], enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
const ORDER = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'pat-r-1', claimed_by_user_id: 'u-1', wbs_item_id: null }

/** 큐 순서(work-routes-pat.test.ts 상세 조회와 같다): agent_runners(조회, last_seen) → 주문 → agent_projects → memberships → project_roles → 주문 update */
function useAdmin(queues: Record<string, Resp[]>, calls: Record<string, unknown[]> = {}) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.update = (payload: unknown) => { (calls[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (calls[`${table}:insert`] ??= []).push(payload); return b }
      for (const k of ['limit', 'order']) b[k] = () => b
      // 가드 조건(.eq('heartbeat_phase', …)·.in('status', …))을 시험이 확인할 수 있게 인자를 남긴다.
      b.eq = (...a: unknown[]) => { (calls[`${table}:eq`] ??= []).push(a); return b }
      b.in = (...a: unknown[]) => { (calls[`${table}:in`] ??= []).push(a); return b }
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
  POST(new NextRequest(`http://l/api/v1/agent/work/${O1}/heartbeat`, {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: O1 }) })
const okQueues = (order = ORDER) => ({
  agent_runners: [{ data: RUNNER }, { data: null }],
  agent_work_orders: [{ data: order }, { data: [{ id: O1 }] }],
  agent_projects: [{ data: { enabled: true } }],
  memberships: [{ data: { is_superuser: false } }],
  project_roles: [{ data: [{ role: 'member' }] }],
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('POST /agent/work/[id]/heartbeat', () => {
  it('200 — 열 4개를 touch 하고 보고 행은 만들지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    const res = await post({ agent: 'hong/mbp/w1', phase: 'build' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.last_heartbeat_at).toBe('string')
    const upd = calls.agent_work_orders?.[0] as Record<string, unknown>
    expect(upd.heartbeat_agent).toBe('hong/mbp/w1')
    expect(upd.heartbeat_phase).toBe('build')
    expect(upd.heartbeat_note).toBeNull()
    expect(upd.last_heartbeat_at).toBe(body.last_heartbeat_at)
    expect(upd.updated_at).toBe(body.last_heartbeat_at)
    // 워커가 되살아나면 사람이 건 재개 요청(0099)은 같은 update 에서 해소된다.
    expect(upd.resume_requested_at).toBeNull()
    expect(upd.resume_requested_by).toBeNull()
    expect(upd.resume_requested_host).toBeNull()
    expect(calls['agent_work_reports:insert']).toBeUndefined()
  })
  it('blocked 는 note 를 저장하고, phase 생략은 phase·note 를 null 로 둔다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    await post({ agent: 'hong/mbp/w1', phase: 'blocked', note: '어느 DB 를 쓸까요?' })
    expect((calls.agent_work_orders[0] as Record<string, unknown>).heartbeat_note).toBe('어느 DB 를 쓸까요?')
    const calls2: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls2)
    await post({ agent: 'hong/mbp/w1' })
    const upd = calls2.agent_work_orders[0] as Record<string, unknown>
    expect(upd.heartbeat_phase).toBeNull(); expect(upd.heartbeat_note).toBeNull()
  })
  it('blocked + 공백뿐인 note 는 heartbeat_note 를 null 로 둔다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    const res = await post({ agent: 'hong/mbp/w1', phase: 'blocked', note: '   ' })
    expect(res.status).toBe(200)
    const upd = calls.agent_work_orders[0] as Record<string, unknown>
    expect(upd.heartbeat_phase).toBe('blocked')
    expect(upd.heartbeat_note).toBeNull()
  })
  it('400 — agent 없음 / 모르는 phase / note 500자 초과', async () => {
    useAdmin(okQueues()); expect((await post({ phase: 'build' })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', phase: 'lunch' })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', phase: 'blocked', note: 'x'.repeat(501) })).status).toBe(400)
  })
  it('model(0100) — 실리면 heartbeat_model 을 덮어쓰고, 생략하면 열을 건드리지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    expect((await post({ agent: 'hong/mbp/w1', phase: 'verify', model: ' haiku ' })).status).toBe(200)
    expect((calls.agent_work_orders[0] as Record<string, unknown>).heartbeat_model).toBe('haiku')
    const calls2: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls2)
    await post({ agent: 'hong/mbp/w1', phase: 'blocked', note: '질문' })
    expect(calls2.agent_work_orders[0] as Record<string, unknown>).not.toHaveProperty('heartbeat_model')
  })
  it('400 — 모델 이름 형식이 아니면 거부한다', async () => {
    useAdmin(okQueues()); expect((await post({ agent: 'a', model: 'x'.repeat(65) })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', model: 'opus 4' })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', model: 42 })).status).toBe(400)
  })
  it('409 — claimed 가 아니면 touch 하지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues({ ...ORDER, status: 'reported' }), calls)
    const res = await post({ agent: 'a', phase: 'build' })
    expect(res.status).toBe(409)
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('409 cancelled — 사람이 중단한 주문이면 code=cancelled 로 워커를 세운다(touch 없음)', async () => {
    const calls: Record<string, unknown[]> = {}
    // 중단은 점유 흔적(claimed_by*)을 지운다 — 소유 판정보다 상태 판정이 먼저여야 403 이 아니라 409 cancelled 가 간다.
    useAdmin(okQueues({ ...ORDER, status: 'cancelled', claimed_by: null, claimed_by_user_id: null } as unknown as typeof ORDER), calls)
    const res = await post({ agent: 'a', phase: 'build' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('cancelled')
    expect(body.error).toBe('작업이 중단되었습니다.')
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('409 conflict — cancelled 가 아닌 다른 상태 불일치는 지금처럼 conflict', async () => {
    useAdmin(okQueues({ ...ORDER, status: 'reported' }))
    expect((await (await post({ agent: 'a', phase: 'build' })).json()).code).toBe('conflict')
  })
  it('403 not_claim_owner — 다른 사용자가 점유한 주문', async () => {
    useAdmin(okQueues({ ...ORDER, claimed_by_user_id: 'u-9' }))
    const res = await post({ agent: 'a', phase: 'build' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
  })
  it('409 conflict — CAS 0행(경합으로 상태가 바뀜)', async () => {
    useAdmin({ ...okQueues(), agent_work_orders: [{ data: ORDER }, { data: [] }] })
    expect((await post({ agent: 'a', phase: 'build' })).status).toBe(409)
  })
  it('403 insufficient_scope — work:read 만 있는 PAT', async () => {
    useAdmin({ ...okQueues(), agent_runners: [{ data: { ...RUNNER, scopes: ['work:read'] } }, { data: null }] })
    expect((await post({ agent: 'a', phase: 'build' })).status).toBe(403)
  })
})

describe('POST heartbeat — 팀장 대리 merge_conflict(2026-09-23 머지 충돌 §7.2)', () => {
  const LEAD = 'hong/mbp/lead'
  const REPORTED = { ...ORDER, status: 'reported' }
  it('reported + merge_conflict → 200, heartbeat_phase·heartbeat_note 두 열만 쓴다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(REPORTED), calls)
    const res = await post({ agent: LEAD, phase: 'merge_conflict', note: '충돌 2개(src/a.ts…) · 해소 대기 1/3' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, phase: 'merge_conflict' })
    // updated_at(승인분 7일 창)·heartbeat_agent(좌석 이름)·last_heartbeat_at·resume_requested_* 는 건드리지 않는다
    expect(calls.agent_work_orders[0]).toEqual({ heartbeat_phase: 'merge_conflict', heartbeat_note: '충돌 2개(src/a.ts…) · 해소 대기 1/3' })
    expect(calls['agent_work_orders:in']).toContainEqual(['status', ['reported', 'approved']])
    expect(calls['agent_work_reports:insert']).toBeUndefined()
  })
  it('approved 도 같다(E9 — 승인분도 자동 해소한다)', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues({ ...ORDER, status: 'approved' }), calls)
    expect((await post({ agent: LEAD, phase: 'merge_conflict', note: '사람 머지 필요: 해소 상한(3/3)' })).status).toBe(200)
    expect((calls.agent_work_orders[0] as Record<string, unknown>).heartbeat_phase).toBe('merge_conflict')
  })
  it('clear → 현재 값이 merge_conflict 일 때만 null 로 되돌린다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(REPORTED), calls)
    const res = await post({ agent: LEAD, clear: 'merge_conflict' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, phase: null, cleared: true })
    expect(calls.agent_work_orders[0]).toEqual({ heartbeat_phase: null, heartbeat_note: null })
    expect(calls['agent_work_orders:eq']).toContainEqual(['heartbeat_phase', 'merge_conflict'])
    expect(calls['agent_work_orders:in']).toContainEqual(['status', ['reported', 'approved']])
  })
  it('clear 인데 바뀐 행이 없으면(다른 phase 이거나 이미 해제) 200 cleared:false — 다른 값을 지우지 않는다', async () => {
    useAdmin({ ...okQueues(REPORTED), agent_work_orders: [{ data: REPORTED }, { data: [] }] })
    const res = await post({ agent: LEAD, clear: 'merge_conflict' })
    expect(res.status).toBe(200)
    expect((await res.json()).cleared).toBe(false)
  })
  it('400 — merge_conflict 에 note 없음 / clear 와 phase 동시 / clear 값이 merge_conflict 아님', async () => {
    useAdmin(okQueues(REPORTED)); expect((await post({ agent: LEAD, phase: 'merge_conflict' })).status).toBe(400)
    useAdmin(okQueues(REPORTED)); expect((await post({ agent: LEAD, phase: 'merge_conflict', note: '  ' })).status).toBe(400)
    useAdmin(okQueues(REPORTED)); expect((await post({ agent: LEAD, phase: 'build', clear: 'merge_conflict' })).status).toBe(400)
    useAdmin(okQueues(REPORTED)); expect((await post({ agent: LEAD, clear: 'blocked' })).status).toBe(400)
  })
  it('400 — claimed 주문에는 merge_conflict 를 받지 않는다(워커 phase 와 섞지 않는다)', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    expect((await post({ agent: LEAD, phase: 'merge_conflict', note: 'x' })).status).toBe(400)
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('409 conflict — reported 에 워커 phase(design) 는 종전대로 / ready 에 merge_conflict', async () => {
    useAdmin(okQueues(REPORTED))
    const r1 = await post({ agent: 'hong/mbp/w1', phase: 'design' })
    expect(r1.status).toBe(409); expect((await r1.json()).code).toBe('conflict')
    useAdmin(okQueues({ ...ORDER, status: 'ready', claimed_by: null, claimed_by_user_id: null } as unknown as typeof ORDER))
    expect((await post({ agent: LEAD, phase: 'merge_conflict', note: 'x' })).status).toBe(409)
  })
  it('409 conflict — 설정 update 가 0행(그사이 상태가 바뀜)', async () => {
    useAdmin({ ...okQueues(REPORTED), agent_work_orders: [{ data: REPORTED }, { data: [] }] })
    expect((await post({ agent: LEAD, phase: 'merge_conflict', note: 'x' })).status).toBe(409)
  })
  it('409 cancelled — 중단된 주문은 표시하지 않는다', async () => {
    useAdmin(okQueues({ ...ORDER, status: 'cancelled', claimed_by: null, claimed_by_user_id: null } as unknown as typeof ORDER))
    expect((await (await post({ agent: LEAD, clear: 'merge_conflict' })).json()).code).toBe('cancelled')
  })
  it('400 identity_required — 레거시 시크릿 principal 은 팀장 표시를 보낼 수 없다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(REPORTED), calls)
    const res = await post({ user_email: 'dev@example.com', agent: 'lead1', phase: 'merge_conflict', note: 'x' }, 'legacy-secret')
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('403 not_claim_owner — 다른 계정이 점유했던 주문', async () => {
    useAdmin(okQueues({ ...REPORTED, claimed_by_user_id: 'u-9' }))
    const res = await post({ agent: LEAD, phase: 'merge_conflict', note: 'x' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
  })
  it('500 — 주문 조회 실패 / 표시 update 실패', async () => {
    useAdmin({ ...okQueues(REPORTED), agent_work_orders: [{ error: { message: 'boom' } }] })
    expect((await post({ agent: LEAD, phase: 'merge_conflict', note: 'x' })).status).toBe(500)
    useAdmin({ ...okQueues(REPORTED), agent_work_orders: [{ data: REPORTED }, { error: { message: 'boom' } }] })
    expect((await post({ agent: LEAD, clear: 'merge_conflict' })).status).toBe(500)
  })
})
