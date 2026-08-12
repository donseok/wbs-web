import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as listGET } from '@/app/api/v1/agent/work/route'
import { GET as detailGET } from '@/app/api/v1/agent/work/[id]/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const P2 = '99999999-9999-4999-8999-999999999999'
type Resp = { data?: unknown; error?: { message: string } | null }

const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}

function useAdmin(queues: Record<string, Resp[]>) {
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
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const get = (url: string, bearer: string) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${bearer}` } })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('GET /agent/work — PAT 멤버십 게이트', () => {
  it('PAT + 멤버 → 200 (agent_runners → last_seen → agent_projects → 멤버십 → 주문)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }], // 조회, last_seen update
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [{ data: [] }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, PAT.token))
    expect(res.status).toBe(200)
  })
  it('PAT + 비멤버 → 404 (존재 은닉)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [] }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, PAT.token))
    expect(res.status).toBe(404)
  })
  it('PAT project_id 한정 위반 → 404', async () => {
    useAdmin({
      agent_runners: [{ data: { ...RUNNER, project_id: P2 } }, { data: null }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, PAT.token))
    expect(res.status).toBe(404)
  })
  it('PAT 스코프 부족 → 403 insufficient_scope', async () => {
    useAdmin({
      agent_runners: [{ data: { ...RUNNER, scopes: [] } }, { data: null }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, PAT.token))
    expect(res.status).toBe(403)
  })
  it('레거시 시크릿 → 멤버십 검사 없이 v1 동작(회귀 기준선)', async () => {
    useAdmin({
      agent_projects: [{ data: { enabled: true } }],
      agent_work_orders: [{ data: [] }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, 'legacy-secret'))
    expect(res.status).toBe(200)
  })
})

const detail = (bearer: string) =>
  detailGET(get(`http://l/api/v1/agent/work/${O1}`, bearer), { params: Promise.resolve({ id: O1 }) })

describe('GET /agent/work/[id] — PAT 멤버십 게이트', () => {
  it('PAT + 멤버 → 200 (agent_runners → last_seen → 주문 → 멤버십 검사)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{
        data: {
          id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
          claimed_by: null, claimed_at: null, wbs_item_id: null,
        },
      }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_reports: [{ data: [] }],
    })
    const res = await detail(PAT.token)
    expect(res.status).toBe(200)
  })
  it('PAT + 비멤버 → 404 (존재 은닉)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{
        data: {
          id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
          claimed_by: null, claimed_at: null, wbs_item_id: null,
        },
      }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [] }],
    })
    const res = await detail(PAT.token)
    expect(res.status).toBe(404)
  })
  it('PAT project_id 한정 위반 → 404 (주문의 project_id 로 판정)', async () => {
    useAdmin({
      agent_runners: [{ data: { ...RUNNER, project_id: P2 } }, { data: null }],
      agent_work_orders: [{
        data: {
          id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
          claimed_by: null, claimed_at: null, wbs_item_id: null,
        },
      }],
    })
    const res = await detail(PAT.token)
    expect(res.status).toBe(404)
  })
  it('레거시 시크릿 → 멤버십 검사 없이 v1 동작(회귀 기준선)', async () => {
    useAdmin({
      agent_work_orders: [{
        data: {
          id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
          claimed_by: null, claimed_at: null, wbs_item_id: null,
        },
      }],
      agent_projects: [{ data: { enabled: true } }],
      agent_work_reports: [{ data: [] }],
    })
    const res = await detail('legacy-secret')
    expect(res.status).toBe(200)
  })
  it('PAT — claimed_by_user_email 은 게이팅 없이 타인 점유에도 노출된다(계약 원문)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{
        data: {
          id: O1, project_id: P1, status: 'claimed', priority: 0, instructions: '',
          claimed_by: 'other-cli', claimed_by_user_id: 'u-2', claimed_at: null, wbs_item_id: null,
        },
      }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_reports: [{ data: [] }],
    })
    const res = await detail(PAT.token)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.mine).toBe(false) // u-1(호출자) != u-2(점유자)
    expect(body.order.claimed_by_user_email).toBe('dev@example.com') // 타인 점유라도 노출
  })

  it('PAT + wbs_item_id 있음 → item 이 ITEM_DETAIL_COLUMNS 로 확장 + depends_evidence 포함', async () => {
    const W1 = '33333333-3333-4333-8333-333333333333'
    const DEP_ID = '44444444-4444-4444-8444-444444444444'
    const DEP_REF = 'MES/TSK-01-00'
    const ITEM = {
      id: W1, code: 'C1', name: '항목1', external_ref: 'MES/TSK-02-00', stage: 'fp',
      category: 'dev', domain: 'd', priority: 'high', model: 'm', tags: ['t'], depends: [DEP_REF],
      prd_ref: 'p', entry_point: 'e', acceptance: [], spec: 's', assignee_member_id: 'm1',
      planned_start: null, planned_end: null,
    }
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [
        {
          data: {
            id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
            claimed_by: null, claimed_by_user_id: null, claimed_at: null, wbs_item_id: W1,
          },
        }, // 주문 로드
        { data: null }, // loadDependsInfo — 선행의 approved 주문 없음
      ],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_reports: [{ data: [] }],
      wbs_items: [
        { data: [ITEM] }, // ITEM_DETAIL_COLUMNS 로드(.in('id', [wbs_item_id]))
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'im' }] }, // loadDependsInfo 의 선행 조회
      ],
    })
    const res = await detail(PAT.token)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.item).toEqual(ITEM) // ITEM_DETAIL_COLUMNS 전 필드 — v1(id,code,name,biz,deliverable,planned_*)보다 확장됨
    expect(body.depends_evidence).toEqual([{ external_ref: DEP_REF, stage: 'im', branch: null, head_sha: null }])
  })

  it('레거시 시크릿 + wbs_item_id 있음 → item 은 v1 컬럼 그대로, depends_evidence 없음(회귀 기준선)', async () => {
    const W1 = '33333333-3333-4333-8333-333333333333'
    const LEGACY_ITEM = { id: W1, code: 'C1', name: '항목1', biz: null, deliverable: null, planned_start: null, planned_end: null }
    useAdmin({
      agent_work_orders: [{
        data: {
          id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
          claimed_by: null, claimed_at: null, wbs_item_id: W1,
        },
      }],
      agent_projects: [{ data: { enabled: true } }],
      agent_work_reports: [{ data: [] }],
      wbs_items: [{ data: [LEGACY_ITEM] }],
    })
    const res = await detail('legacy-secret')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.item).toEqual(LEGACY_ITEM)
    expect(body.depends_evidence).toBeUndefined()
  })
})
