import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as meGET } from '@/app/api/v1/agent/me/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
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
const get = (bearer: string) => new NextRequest('http://l/api/v1/agent/me', { headers: { Authorization: `Bearer ${bearer}` } })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('GET /agent/me', () => {
  it('PAT → 소유자·스코프·contract_version + 멤버인 enabled 프로젝트만', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      // enabled 프로젝트 2건 중 멤버는 P1 만
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      projects: [{ data: [{ id: P1, name: '테스트' }, { id: P2, name: '남의것' }] }],
      memberships: [{ data: { is_superuser: false } }, { data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'admin' }] }, { data: [] }],
    })
    const res = await meGET(get(PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user_email).toBe('dev@example.com')
    expect(body.contract_version).toBe('2.2')
    expect(body.projects).toHaveLength(1)
    expect(body.projects[0]).toMatchObject({ id: P1, role: 'admin' })
  })
  it('legacy 시크릿 호출 → 400 identity_required', async () => {
    useAdmin({})
    const res = await meGET(get('legacy-secret'))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
  })
})
