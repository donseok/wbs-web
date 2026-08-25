import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const OLD = { ...process.env }
beforeEach(() => { process.env.AGENT_API_ENABLED = 'true'; vi.clearAllMocks() })
afterEach(() => { process.env = { ...OLD } })

function useSession(user: { id: string } | null) {
  mocks.createServerClient.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
  })
}
function useAdmin(insertResult: { data?: unknown; error?: { message: string } | null }) {
  const inserted: unknown[] = []
  const b: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'update', 'order', 'is']) b[k] = () => b
  b.insert = (row: unknown) => { inserted.push(row); return b }
  b.maybeSingle = async () => ({ data: insertResult.data ?? null, error: insertResult.error ?? null })
  b.then = (r: (v: unknown) => unknown) =>
    Promise.resolve({ data: insertResult.data ?? null, error: insertResult.error ?? null }).then(r)
  mocks.createAdminClient.mockReturnValue({ from: () => b })
  return inserted
}

describe('createAgentToken', () => {
  it('발급 성공 — 평문은 응답 1회, DB 행에는 hash 만', async () => {
    useSession({ id: 'u-1' })
    const inserted = useAdmin({ data: [{ id: 'r-1' }] })
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'laptop', projectId: null, scopes: ['work:read'], expiresDays: 90 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.token).toMatch(/^dflow_pat_/)
    const row = inserted[0] as Record<string, unknown>
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toContain((r as { token: string }).token)
  })
  it('AGENT_API_ENABLED 미설정이면 발급 거부', async () => {
    delete process.env.AGENT_API_ENABLED
    useSession({ id: 'u-1' })
    useAdmin({})
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'x', projectId: null, scopes: ['work:read'], expiresDays: 90 })
    expect(r.ok).toBe(false)
  })
  it('work:claim 발급 — 신규 토큰에 work:report 를 얹지 않는다(2026-08-25 스코프 폐지)', async () => {
    useSession({ id: 'u-1' })
    const inserted = useAdmin({ data: [{ id: 'r-1' }] })
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({
      name: 'x', projectId: null, scopes: ['work:read', 'work:claim'], expiresDays: 90,
    })
    expect(r.ok).toBe(true)
    const row = inserted[0] as Record<string, unknown>
    expect(row.scopes).toEqual(['work:read', 'work:claim'])
  })
  it('폐지된 work:report 는 발급 거부 — 완료 보고 권한은 work:claim 에 흡수됐다', async () => {
    useSession({ id: 'u-1' })
    useAdmin({})
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({
      name: 'x', projectId: null, scopes: ['work:read', 'work:claim', 'work:report'], expiresDays: 90,
    })
    expect(r.ok).toBe(false)
  })
  it('알 수 없는 스코프는 거부', async () => {
    useSession({ id: 'u-1' })
    useAdmin({})
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'x', projectId: null, scopes: ['work:read', 'admin:all'], expiresDays: 90 })
    expect(r.ok).toBe(false)
  })
  it('비로그인 거부', async () => {
    useSession(null)
    useAdmin({})
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'x', projectId: null, scopes: ['work:read'], expiresDays: 90 })
    expect(r.ok).toBe(false)
  })
})
