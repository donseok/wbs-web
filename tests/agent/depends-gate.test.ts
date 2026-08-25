import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'
import { stageAtLeast } from '@/lib/domain/agentWork'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))

import { loadDependsInfo } from '@/lib/agent/depends'
import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const DEP_ID = '44444444-4444-4444-8444-444444444444'
const DEP_REF = 'MES/TSK-01-00'
type Resp = { data?: unknown; error?: { message: string } | null }

const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat' as const, owner_user_id: 'u-1', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read', 'work:claim'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: W1 }
const TARGET_ITEM = {
  id: W1, code: 'C1', name: '항목1', external_ref: null, stage: null, category: null, domain: null,
  priority: null, model: null, tags: null, depends: [DEP_REF], prd_ref: null, entry_point: null,
  acceptance: [], spec: null, assignee_member_id: null, planned_start: null, planned_end: null,
}
const ctx = { params: Promise.resolve({ id: O1 }) }

function useAdmin(queues: Record<string, Resp[]>, users: Array<{ id: string; email: string; user_metadata: unknown }> = []) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'limit', 'order']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })),
        listUsers: vi.fn(async () => ({ data: { users }, error: null })), // resolveUserByEmail(레거시 경로)
      },
    },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
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
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('stageAtLeast', () => {
  it("im·xx 만 통과, null·todo~ip·미지 값은 false(fail-closed)", () => {
    expect(stageAtLeast('im', 'im')).toBe(true)
    expect(stageAtLeast('xx', 'im')).toBe(true)
    for (const s of [null, 'todo', 'as', 'fp', 'ip', 'dd']) expect(stageAtLeast(s, 'im')).toBe(false)
  })
})

describe('claim 선행 게이트', () => {
  it('선행 stage=im → 통과(CAS 진행)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [
        { data: ORDER }, // 주문 로드
        { data: null }, // 선행의 approved 주문 없음
        { data: [{ id: O1 }] }, // CAS 성공
      ],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [
        { data: TARGET_ITEM },
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'im' }] },
      ],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.depends_evidence).toEqual([{ external_ref: DEP_REF, stage: 'im', branch: null, head_sha: null, order_approved: false }])
  })

  it('선행 stage=ip → 403 dependency_not_met + unmet 배열', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [
        { data: ORDER },
        { data: null },
      ],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [
        { data: TARGET_ITEM },
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'ip' }] },
      ],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('dependency_not_met')
    expect(body.unmet).toEqual([{ external_ref: DEP_REF, stage: 'ip' }])
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('레거시 경로 + 선행 stage=ip → 403 dependency_not_met(동일 게이트 적용)', async () => {
    useAdmin({
      agent_work_orders: [
        { data: ORDER }, // 로드
        { data: null }, // 선행의 approved 주문 없음
      ],
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [
        { data: TARGET_ITEM },
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'ip' }] },
      ],
    }, [{ id: 'u-legacy', email: 'dev@example.com', user_metadata: {} }])
    const res = await claimPOST(
      post(`http://l/api/v1/agent/work/${O1}/claim`, { user_email: 'dev@example.com', agent: 'claude-cli-dev1' }, 'legacy-secret'),
      ctx,
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('dependency_not_met')
    expect(body.unmet).toEqual([{ external_ref: DEP_REF, stage: 'ip' }])
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('선행 ref 가 프로젝트에 없음 → 미충족(403) — fail-closed', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: ORDER }], // depends 조회에서 ref 미발견 → 추가 주문 조회 없음
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [
        { data: TARGET_ITEM },
        { data: [] }, // 프로젝트에 해당 external_ref 없음
      ],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('dependency_not_met')
    expect(body.unmet).toEqual([{ external_ref: DEP_REF, stage: null }])
  })

  it('depends 빈 배열·null → 게이트 없이 통과', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [{ data: { ...TARGET_ITEM, depends: null } }],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(200)

    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [{ data: { ...TARGET_ITEM, depends: [] } }],
    })
    const res2 = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res2.status).toBe(200)
  })
})

// 승인이 반쪽으로 끝난 선행(approved 인데 stage 미전이)이 후속을 영구히 막던 교착 —
// 자동 루프가 스스로 못 푸는 조건이었다(2026-08-25 mes-runlog 리허설 3회 재발).
describe('선행 게이트 — approved 주문을 도달로 인정', () => {
  it("선행 stage='fp' 인데 approved 주문 있음 → claim 통과", async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [
        { data: ORDER },                    // 대상 주문
        { data: { id: 'ao-approved' } },    // loadDependsInfo 의 선행 approved 주문 조회
        { data: [{ id: O1 }] },             // claim CAS
      ],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [
        { data: TARGET_ITEM },
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'fp' }] },
      ],
      agent_work_reports: [{ data: { evidence: {} } }],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).not.toBe(403)
  })
})

describe('depends_evidence', () => {
  it('선행의 최근 approved 주문 completion evidence 에서 branch·head_sha 추출, 없으면 null', async () => {
    const HEAD_SHA = 'a'.repeat(40)
    useAdmin({
      wbs_items: [{ data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'im' }] }],
      agent_work_orders: [{ data: { id: 'ao-1' } }],
      agent_work_reports: [{ data: { evidence: { branch: 'main', head_sha: HEAD_SHA } } }],
    })
    const result1 = await loadDependsInfo(mocks.createAdminClient(), { projectId: P1, depends: [DEP_REF] })
    expect(result1).toEqual([{ external_ref: DEP_REF, stage: 'im', branch: 'main', head_sha: HEAD_SHA, order_approved: true }])

    useAdmin({
      wbs_items: [{ data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'im' }] }],
      agent_work_orders: [{ data: null }], // approved 주문 없음
    })
    const result2 = await loadDependsInfo(mocks.createAdminClient(), { projectId: P1, depends: [DEP_REF] })
    expect(result2).toEqual([{ external_ref: DEP_REF, stage: 'im', branch: null, head_sha: null, order_approved: false }])
  })
})
