import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { POST as reportPOST } from '@/app/api/v1/agent/work/[id]/report/route'
import { POST as releasePOST } from '@/app/api/v1/agent/work/[id]/release/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const P2 = '99999999-9999-4999-8999-999999999999'
type Resp = { data?: unknown; error?: { message: string } | null }

const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat' as const, owner_user_id: 'u-1', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: [] as string[], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
const CLAIM_SCOPES = { ...RUNNER, scopes: ['work:read', 'work:claim'] }
const REPORT_SCOPES = { ...RUNNER, scopes: ['work:read', 'work:claim', 'work:report'] }
const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: null }
// P2 한정 PAT — 주문은 P1 소속. 멤버십 조회까지 가지 않고 주문 로드 직후 404 여야 한다(C1).
const CLAIM_SCOPES_P2 = { ...CLAIM_SCOPES, project_id: P2 }
const REPORT_SCOPES_P2 = { ...REPORT_SCOPES, project_id: P2 }
const ctx = { params: Promise.resolve({ id: O1 }) }

function useAdmin(queues: Record<string, Resp[]>) {
  const captured: unknown[] = []
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'insert', 'delete', 'eq', 'in', 'limit', 'order']) b[k] = () => b
      b.update = (p: unknown) => { captured.push(p); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })),
        listUsers: vi.fn(async () => ({ data: { users: [{ id: 'u-1', email: 'dev@example.com', user_metadata: {} }] }, error: null })),
      },
    },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, captured }
}
const post = (url: string, body: unknown, bearer: string) => new NextRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  body: JSON.stringify(body),
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('PAT 쓰기 루프', () => {
  it('PAT claim 성공 → claimed_by_user_id 서버 유도 기록 (body 값 아님)', async () => {
    const { captured } = useAdmin({
      agent_runners: [{ data: CLAIM_SCOPES }, { data: null }], // 조회, last_seen
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }], // 로드, CAS
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [{ data: null }], // 배정 확인(무배정) — Task 15 이후에도 이 큐가 유효
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'claude-pc1', claimed_by_user_id: 'attacker' }, PAT.token), ctx)
    expect(res.status).toBe(200)
    const cas = captured.find(p => (p as Record<string, unknown>).status === 'claimed') as Record<string, unknown>
    expect(cas.claimed_by_user_id).toBe('u-1') // principal 유도값 — body 의 'attacker' 무시
  })

  it('PAT + body user_email 불일치 → 400 identity_mismatch', async () => {
    useAdmin({ agent_runners: [{ data: CLAIM_SCOPES }, { data: null }] })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a', user_email: 'other@example.com' }, PAT.token), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_mismatch')
  })

  it('PAT 가 레거시 점유(claimed_by_user_id=null) 주문 report → 403 not_claim_owner', async () => {
    useAdmin({
      agent_runners: [{ data: REPORT_SCOPES }, { data: null }],
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'legacy-cli', claimed_by_user_id: null } }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, { agent: 'a', kind: 'progress', percent: 10, summary: 's' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
  })

  it('PAT + work:claim 스코프 없음 → 403 insufficient_scope', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }], // scopes: [] — work:claim 없음
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('insufficient_scope')
  })

  it('레거시가 PAT 점유 주문 report → 403 not_claim_owner', async () => {
    useAdmin({
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'x', claimed_by_user_id: 'u-1' } }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, { agent: 'a', user_email: 'dev@example.com', kind: 'progress', percent: 10, summary: 's' }, 'legacy-secret'), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
  })

  it('PAT 본인 점유 report(progress) → 200 + applied_to_wbs', async () => {
    useAdmin({
      agent_runners: [{ data: REPORT_SCOPES }, { data: null }],
      agent_work_orders: [
        { data: { ...ORDER, status: 'claimed', claimed_by: 'pat-r1', claimed_by_user_id: 'u-1', wbs_item_id: W1 } }, // 로드
        { data: [{ id: O1 }] }, // updated_at 갱신(progress)
      ],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [
        { data: { id: W1, actual_pct: 0, project_id: P1 } }, // actual_pct 조회
        { data: null }, // 자식 없음
        { data: [{ id: W1 }] }, // update
      ],
      agent_work_reports: [{ data: [{ id: 'r-1' }] }], // 보고 insert
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, { agent: 'a', kind: 'progress', percent: 10, summary: 's' }, PAT.token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.applied_to_wbs).toBe(true)
  })

  it('completion + evidence 형식 위반(head_sha 39자) → 400', async () => {
    useAdmin({ agent_runners: [{ data: REPORT_SCOPES }, { data: null }] })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, {
      agent: 'a', kind: 'completion', percent: 100, summary: 's', evidence: { head_sha: 'a'.repeat(39) },
    }, PAT.token), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('validation_failed')
  })

  it('PAT release — 타 사용자 점유 403, 본인 점유 200', async () => {
    const { admin: admin1 } = useAdmin({
      agent_runners: [{ data: CLAIM_SCOPES }, { data: null }],
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'x', claimed_by_user_id: 'u-2' } }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    void admin1
    const res1 = await releasePOST(post(`http://l/api/v1/agent/work/${O1}/release`, { agent: 'a' }, PAT.token), ctx)
    expect(res1.status).toBe(403)
    expect((await res1.json()).code).toBe('not_claim_owner')

    useAdmin({
      agent_runners: [{ data: CLAIM_SCOPES }, { data: null }],
      agent_work_orders: [
        { data: { ...ORDER, status: 'claimed', claimed_by: 'pat-r1', claimed_by_user_id: 'u-1' } },
        { data: [{ id: O1 }] }, // CAS
      ],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res2 = await releasePOST(post(`http://l/api/v1/agent/work/${O1}/release`, { agent: 'a' }, PAT.token), ctx)
    expect(res2.status).toBe(200)
  })

  it('C1: 프로젝트 한정(P2) PAT 로 "멤버인" 타 프로젝트(P1) 주문 claim → 404(존재 은닉)', async () => {
    // 멤버십 큐(agent_projects/memberships/project_roles)를 채워둔다 — patProjectAllowed 가 없다면
    // 이 멤버십 판정까지 통과해 200이 나온다(회귀 시 이 테스트가 실패로 그것을 잡는다).
    useAdmin({
      agent_runners: [{ data: CLAIM_SCOPES_P2 }, { data: null }], // 조회, last_seen
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }], // 로드(P1), CAS
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [{ data: null }], // 배정 확인(무배정)
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(404)
  })

  it('C1: 프로젝트 한정(P2) PAT 로 "멤버인" 타 프로젝트(P1) 주문 report → 404(존재 은닉)', async () => {
    useAdmin({
      agent_runners: [{ data: REPORT_SCOPES_P2 }, { data: null }],
      agent_work_orders: [
        { data: { ...ORDER, status: 'claimed', claimed_by: 'pat-r1', claimed_by_user_id: 'u-1' } }, // 로드
        { data: [{ id: O1 }] }, // updated_at 갱신(progress)
      ],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, { agent: 'a', kind: 'progress', percent: 10, summary: 's' }, PAT.token), ctx)
    expect(res.status).toBe(404)
  })
})
