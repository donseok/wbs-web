import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

/** GET /api/v1/wbs/structure — PL 스킬의 서버 직조회 원천(스펙 §import 계약 v2.2).
 *  levels 정본 + 얕은 노드(기본 depth≤2 = Phase·System)를 돌려준다. */

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as structureGET } from '@/app/api/v1/wbs/structure/route'

type Resp = { data?: unknown; error?: { message: string } | null }

function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'pl@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}

const PROJECT_ID = '87654321-4321-4321-4321-987654321def'

function patRow(scopes: string[] = ['work:read']) {
  const { token, prefix, hash } = generateAgentToken()
  return {
    token,
    row: {
      id: 'runner-1', kind: 'user_pat' as const, owner_user_id: 'u-1',
      token_prefix: prefix, token_hash: hash, project_id: null,
      scopes, enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
    },
  }
}

function get(qs: string, bearer: string) {
  return new NextRequest(`http://l/api/v1/wbs/structure?${qs}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  })
}

/** 골격 트리 픽스처 — PH-03(depth0) > SYS-OP(depth1) > SUB-OP-EV(depth2) > TSK(depth3) */
const TREE = [
  { id: 'n1', parent_id: null, name: '구축', external_ref: 'mes-skel/PH-03', level_idx: 0, sort_order: 2 },
  { id: 'n2', parent_id: 'n1', name: '조업', external_ref: 'mes-skel/SYS-OP', level_idx: 1, sort_order: 3 },
  { id: 'n3', parent_id: 'n2', name: '조업이벤트', external_ref: 'mes-op/SUB-OP-EV', level_idx: 2, sort_order: 0 },
  { id: 'n4', parent_id: 'n3', name: '수집 프로세스', external_ref: 'mes-op/TSK-OP-EV-PR-01', level_idx: 5, sort_order: 1 },
]

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  delete process.env.AGENT_API_SECRET
  vi.clearAllMocks()
})

describe('GET /wbs/structure', () => {
  it('PAT 멤버 → levels + depth≤1(기본) 노드, parent 는 external_ref 로', async () => {
    const { token, row } = patRow()
    useAdmin({
      agent_runners: [{ data: row }, { data: null }],
      agent_projects: [{ data: { enabled: true } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_settings: [{ data: { level_labels: ['Phase', 'System', 'Subsystem', 'WP', 'Activity', 'Task', 'SubTask'], max_depth: 7 } }],
      wbs_items: [{ data: TREE }],
    })
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.levels).toEqual(['Phase', 'System', 'Subsystem', 'WP', 'Activity', 'Task', 'SubTask'])
    expect(json.nodes).toEqual([
      { id: 'n1', external_ref: 'mes-skel/PH-03', name: '구축', parent_external_ref: null, depth: 0, level_idx: 0 },
      { id: 'n2', external_ref: 'mes-skel/SYS-OP', name: '조업', parent_external_ref: 'mes-skel/PH-03', depth: 1, level_idx: 1 },
    ])
  })

  it('max_depth=2 → Subsystem 층까지 확장', async () => {
    const { token, row } = patRow()
    useAdmin({
      agent_runners: [{ data: row }, { data: null }],
      agent_projects: [{ data: { enabled: true } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_settings: [{ data: { level_labels: ['A', 'B', 'C'], max_depth: 3 } }],
      wbs_items: [{ data: TREE }],
    })
    const res = await structureGET(get(`project_id=${PROJECT_ID}&max_depth=2`, token))
    const json = await res.json()
    expect(json.nodes).toHaveLength(3)
    expect(json.nodes[2]).toMatchObject({ external_ref: 'mes-op/SUB-OP-EV', depth: 2 })
  })

  it('비멤버 PAT → 404 (존재 은닉)', async () => {
    const { token, row } = patRow()
    useAdmin({
      agent_runners: [{ data: row }, { data: null }],
      agent_projects: [{ data: { enabled: true } }],
      project_roles: [{ data: [] }],
      memberships: [{ data: { is_superuser: false } }],
    })
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    expect(res.status).toBe(404)
  })

  it('work:read 스코프 없음 → 403 insufficient_scope', async () => {
    const { token, row } = patRow(['work:report'])
    useAdmin({ agent_runners: [{ data: row }, { data: null }] })
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('insufficient_scope')
  })

  it('project_id 없음 → 400', async () => {
    const { token } = patRow()
    const res = await structureGET(get('', token))
    expect(res.status).toBe(400)
  })
})
