import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as mineGET } from '@/app/api/v1/agent/work/mine/route'
import { accessibleProjectIds } from '@/lib/agent/mineShared'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null }

const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat' as const, owner_user_id: 'u-1', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}

function useAdmin(queues: Record<string, Resp[]>) {
  const selects: Record<string, string[]> = {}
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['update', 'eq', 'in', 'limit', 'order']) b[k] = () => b
      b.select = (cols: string) => { (selects[table] ??= []).push(cols); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return Object.assign(admin, { selects })
}

const get = (url: string, bearer: string) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${bearer}` } })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('GET /agent/work/mine', () => {
  it('scope 기본(available) — 멤버 프로젝트의 ready 주문만, priority desc 정렬', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [{ data: [
        { id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('available')
    expect(body.available).toHaveLength(1)
    expect(body.claimed).toBeUndefined()
  })

  it('항목 컨텍스트에 external_ref 를 싣는다(task scaffold 스펙 §5)', async () => {
    const admin = useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [{ data: [
        { id: 'o-9', project_id: P1, status: 'ready', priority: 0, instructions: '', claimed_at: null, wbs_item_id: 'w-1', created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [{ id: 'w-1', code: '1.1', name: 't', planned_start: null, planned_end: null, external_ref: 'MDM/TSK-01-01' }] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    const body = await res.json()
    expect(admin.selects.wbs_items.at(-1)).toContain('external_ref')
    expect(body.available[0].item.external_ref).toBe('MDM/TSK-01-01')
  })

  it('scope=claimed — 본인 점유(claimed_by_user_id) 주문만', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [{ data: [
        { id: 'o-2', project_id: P1, status: 'claimed', priority: 0, instructions: '', claimed_at: '2026-08-01T00:00:00Z', wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=claimed', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('claimed')
    expect(body.claimed).toHaveLength(1)
    expect(body.available).toBeUndefined()
  })

  it('scope=all — claimed → assigned → available 순으로 구획을 채운다', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [{ id: 'o-2', project_id: P1, status: 'claimed', priority: 0, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' }] },
        { data: [{ id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' }] },
      ],
      project_members: [{ data: [] }], // myMemberIdsAcrossProjects — 배정 없음
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=all', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['ok', 'scope', 'claimed', 'assigned', 'available'])
    expect(body.claimed).toHaveLength(1)
    expect(body.assigned).toHaveLength(0)
    expect(body.available).toHaveLength(1)
  })

  it('지원하지 않는 scope → 400 unsupported_scope', async () => {
    useAdmin({ agent_runners: [{ data: RUNNER }, { data: null }] })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=bogus', PAT.token))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('unsupported_scope')
  })

  it('legacy 호출 400 identity_required', async () => {
    useAdmin({})
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', 'legacy-secret'))
    expect(res.status).toBe(400)
  })

  it('limit 상한 100 초과 → 400', async () => {
    useAdmin({ agent_runners: [{ data: RUNNER }, { data: null }] })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?limit=999', PAT.token))
    expect(res.status).toBe(400)
  })

  // accessibleProjectIds 교차(intersection) 회귀 테스트
  it('enabled 프로젝트 P1·P2, PAT 소유자 P1만 멤버 → P1 주문만, P2 배제', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      memberships: [
        { data: { is_superuser: false } }, // P1 멤버십 체크
        { data: { is_superuser: false } }, // P2 멤버십 체크
      ],
      project_roles: [
        { data: [{ role: 'member' }] }, // P1: 멤버
        { data: [] }, // P2: 비멤버 → accessibleProjectIds 루프에서 배제됨
      ],
      agent_work_orders: [{ data: [
        { id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.available).toHaveLength(1)
    expect(body.available[0].id).toBe('o-1')
    expect(body.available[0].project_id).toBe(P1)
  })

  it('PAT project_id 한정 P1 → P2 멤버여도 patProjectAllowed 에서 배제', async () => {
    const RUNNER_P1 = { ...RUNNER, project_id: P1 } // P1로만 제한됨
    useAdmin({
      agent_runners: [{ data: RUNNER_P1 }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      memberships: [
        { data: { is_superuser: false } }, // P1 멤버십 체크만 필요 (P2는 patProjectAllowed 에서 배제)
      ],
      project_roles: [
        { data: [{ role: 'member' }] }, // P1: 멤버
      ],
      agent_work_orders: [{ data: [
        { id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.available).toHaveLength(1)
    expect(body.available[0].id).toBe('o-1')
  })

  it('fail-closed: 멤버십 조회 실패 시 그 프로젝트 배제', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      memberships: [
        { data: { is_superuser: false } }, // P1 멤버십 체크: 성공
        { error: { message: 'DB error' } }, // P2 멤버십 체크: 실패 → fail-closed 로 배제
      ],
      project_roles: [
        { data: [{ role: 'member' }] }, // P1: 멤버
      ],
      agent_work_orders: [{ data: [
        { id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.available).toHaveLength(1)
    expect(body.available[0].id).toBe('o-1')
  })

  it('판단 칸(action·mine·설계 상태)을 싣는다 — 팀장 요청(lead=1)은 거르기와 팀원 라벨을 본다(계약 2.11)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [
          { id: 'o-r', project_id: P1, status: 'ready', priority: 0, instructions: '', claimed_at: null, wbs_item_id: 'w-r', created_at: '2026-08-01T00:00:00Z',
            claimed_by: null, claimed_by_user_id: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, design_state: null, claim_scope: null, design_note: null, runner: null, runner_seen_at: null },
        ] },
        { data: [] },   // loadItemFacts — 항목의 approved 주문 없음
      ],
      wbs_items: [{ data: [{ id: 'w-r', project_id: P1, code: '1', name: 'r', planned_start: null, planned_end: null, external_ref: 'M/TSK-02-01',
        stage: 'as', actual_pct: 0, tags: ['agent'], depends: [], depends_waived: [], design_mode: 'review' }] }],
    })
    const res = await mineGET(get(`http://l/api/v1/agent/work/mine?agent=hong/mbp/lead&require_tag=agent&wp=WP-02&lead=1`, PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.available[0]).toMatchObject({ design_mode: 'review', design_state: null, action: 'design', action_reason: '설계만', deps_unmet: false, mine: true })
  })
  it('M-1(리뷰 수정 1회차) — lead=1 인데 claimed 주문의 점유 라벨이 팀원(/w<n>)이 아니면 mine:false(Y9)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [
          { id: 'o-c', project_id: P1, status: 'claimed', priority: 0, instructions: '', claimed_at: null, wbs_item_id: 'w-c', created_at: '2026-08-01T00:00:00Z',
            claimed_by: 'hong/mbp', claimed_by_user_id: 'u-1', last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, design_state: null, claim_scope: 'full', design_note: null, runner: null, runner_seen_at: null },
        ] },
        { data: [] },   // loadItemFacts — 항목의 approved 주문 없음
      ],
      wbs_items: [{ data: [{ id: 'w-c', project_id: P1, code: '1', name: 'c', planned_start: null, planned_end: null, external_ref: 'M/TSK-02-01',
        stage: 'ds', actual_pct: 0, tags: ['agent'], depends: [], depends_waived: [], design_mode: 'auto' }] }],
    })
    const res = await mineGET(get(`http://l/api/v1/agent/work/mine?scope=claimed&agent=hong/mbp/lead&require_tag=agent&lead=1`, PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.claimed[0].mine).toBe(false)
  })
  it('Important 2(최종 수정) — agent 를 보내지 않은 요청의 claimed mine 은 종전 뜻(점유 사용자 일치), 라벨을 보내면 5.3 mine', async () => {
    const fresh = new Date(Date.now() - 60_000).toISOString()
    const queues = () => ({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [
          // 다른 PC(pc2)가 30분 안에 신호를 낸 claimed 주문 — 라벨이 있으면 mine 이 아니다.
          { id: 'o-c', project_id: P1, status: 'claimed', priority: 0, instructions: '', claimed_at: null, wbs_item_id: 'w-c', created_at: '2026-08-01T00:00:00Z',
            claimed_by: 'hong/mbp/w1', claimed_by_user_id: 'u-1', last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, design_state: null, claim_scope: 'full', design_note: null, runner: 'hong/pc2/w1', runner_seen_at: fresh },
        ] },
        { data: [] },
      ],
      wbs_items: [{ data: [{ id: 'w-c', project_id: P1, code: '1', name: 'c', planned_start: null, planned_end: null, external_ref: 'M/TSK-02-01',
        stage: 'ds', actual_pct: 0, tags: ['agent'], depends: [], depends_waived: [], design_mode: 'auto' }] }],
    })
    useAdmin(queues())
    const legacy = await (await mineGET(get('http://l/api/v1/agent/work/mine?scope=claimed', PAT.token))).json()
    expect(legacy.claimed[0].mine).toBe(true) // 옛 킷(라벨 없음) — 점유 사용자가 호출자다
    useAdmin(queues())
    const labelled = await (await mineGET(get('http://l/api/v1/agent/work/mine?scope=claimed&agent=hong/mbp/w1', PAT.token))).json()
    expect(labelled.claimed[0].mine).toBe(false) // 새 킷 — 다른 PC 가 도는 중
  })
  it('M-1(리뷰 수정 1회차) — require_tag 불일치는 ready 주문도 mine:false(거르기 실패)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [
          { id: 'o-nt', project_id: P1, status: 'ready', priority: 0, instructions: '', claimed_at: null, wbs_item_id: 'w-nt', created_at: '2026-08-01T00:00:00Z',
            claimed_by: null, claimed_by_user_id: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, design_state: null, claim_scope: null, design_note: null, runner: null, runner_seen_at: null },
        ] },
        { data: [] },
      ],
      wbs_items: [{ data: [{ id: 'w-nt', project_id: P1, code: '1', name: 'n', planned_start: null, planned_end: null, external_ref: 'M/TSK-03-01',
        stage: 'as', actual_pct: 0, tags: [], depends: [], depends_waived: [], design_mode: 'auto' }] }],
    })
    const res = await mineGET(get(`http://l/api/v1/agent/work/mine?require_tag=agent`, PAT.token))
    const body = await res.json()
    expect(body.available[0].mine).toBe(false)
  })
  it('M-2(리뷰 수정 1회차) — loadItemFacts 실패는 500 이지 빈 목록으로 위장하지 않는다', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [
          { id: 'o-f', project_id: P1, status: 'ready', priority: 0, instructions: '', claimed_at: null, wbs_item_id: 'w-f', created_at: '2026-08-01T00:00:00Z',
            claimed_by: null, claimed_by_user_id: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, design_state: null, claim_scope: null, design_note: null, runner: null, runner_seen_at: null },
        ] },
        { data: null, error: { message: 'boom' } },   // loadItemFacts approvedItemIds 실패
      ],
      wbs_items: [{ data: [{ id: 'w-f', project_id: P1, code: '1', name: 'f', planned_start: null, planned_end: null, external_ref: 'M/TSK-04-01',
        stage: 'as', actual_pct: 0, tags: ['agent'], depends: [], depends_waived: [], design_mode: 'auto' }] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    expect(res.status).toBe(500)
  })
  it('M-3(리뷰 수정 1회차) — 판단 재료로만 쓰는 원시 열은 응답에 새지 않는다', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [
          { id: 'o-m3', project_id: P1, status: 'ready', priority: 0, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z',
            claimed_by: null, claimed_by_user_id: 'u-9', last_heartbeat_at: '2026-09-27T00:00:00Z', heartbeat_phase: 'build', heartbeat_agent: 'hong/mbp/w1',
            design_state: null, claim_scope: null, design_note: null, runner: null, runner_seen_at: null },
        ] },
        { data: [] },
      ],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    const row = (await res.json()).available[0]
    for (const k of ['claimed_by_user_id', 'last_heartbeat_at', 'heartbeat_phase', 'heartbeat_agent']) {
      expect(row, k).not.toHaveProperty(k)
    }
  })
  it('wp 형식 오류는 400', async () => {
    useAdmin({ agent_runners: [{ data: RUNNER }, { data: null }] })
    expect((await mineGET(get('http://l/api/v1/agent/work/mine?wp=WP-x', PAT.token))).status).toBe(400)
  })
})

describe('accessibleProjectIds — 직접 단위 테스트', () => {
  const patPrincipal = {
    kind: 'pat' as const, runnerId: 'r-1', userId: 'u-1', userEmail: 'dev@example.com',
    scopes: ['work:read'], projectId: null, runnerKind: 'user_pat' as const,
    tokenExpiresAt: '2099-01-01T00:00:00Z', runnerName: 'n', tokenPrefix: 'p',
  }

  it('(a) enabled 프로젝트 P1·P2, PAT 소유자 P1만 멤버 → ["P1"] (P2 부재 직접 단언)', async () => {
    useAdmin({
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      memberships: [
        { data: { is_superuser: false } }, // P1 체크
        { data: { is_superuser: false } }, // P2 체크
      ],
      project_roles: [
        { data: [{ role: 'member' }] }, // P1: 멤버
        { data: [] }, // P2: 비멤버
      ],
    })
    const admin = mocks.createAdminClient()
    const result = await accessibleProjectIds(admin, patPrincipal)
    expect(result).toEqual([P1])
    expect(result).not.toContain(P2)
  })

  it('(b) PAT project_id 한정 P1 → ["P1"] (P2 멤버여도 patProjectAllowed 배제)', async () => {
    const patP1Scoped = { ...patPrincipal, projectId: P1 }
    useAdmin({
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      memberships: [
        { data: { is_superuser: false } }, // P1 체크만 필요 (P2는 patProjectAllowed 에서 스킵)
      ],
      project_roles: [
        { data: [{ role: 'member' }] }, // P1: 멤버
      ],
    })
    const admin = mocks.createAdminClient()
    const result = await accessibleProjectIds(admin, patP1Scoped)
    expect(result).toEqual([P1])
    expect(result).not.toContain(P2)
  })

  it('(c) P2 멤버십 조회 실패 → ["P1"] (fail-closed 로 P2 배제)', async () => {
    useAdmin({
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      memberships: [
        { data: { is_superuser: false } }, // P1: 성공
        { error: { message: 'DB error' } }, // P2: 실패
      ],
      project_roles: [
        { data: [{ role: 'member' }] }, // P1: 멤버
      ],
    })
    const admin = mocks.createAdminClient()
    const result = await accessibleProjectIds(admin, patPrincipal)
    expect(result).toEqual([P1])
    expect(result).not.toContain(P2)
  })
})
