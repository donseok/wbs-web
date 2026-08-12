import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const OLD = { ...process.env }
beforeEach(() => { vi.resetModules() })
afterEach(() => { process.env = { ...OLD } })

function req(auth?: string) {
  return new Request('http://l/api/v1/agent/work', { headers: auth ? { Authorization: auth } : {} })
}
// agent_runners 1행 + auth.admin.getUserById 를 흉내내는 admin 목
function adminWith(row: unknown, user = { id: 'u-1', email: 'dev@example.com' }) {
  const b: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'update']) b[k] = () => b
  b.maybeSingle = async () => ({ data: row, error: null })
  b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: row, error: null }).then(r)
  return {
    from: () => b,
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user }, error: null })) } },
  }
}
async function load() { return await import('@/lib/agent/externalApi') }

describe('resolveAgentPrincipal', () => {
  it('킬스위치: ENABLED 아니면 404 — 시크릿 존재와 무관', async () => {
    delete process.env.AGENT_API_ENABLED
    process.env.AGENT_API_SECRET = 's'
    const m = await load()
    const r = await m.resolveAgentPrincipal(req('Bearer s'), adminWith(null) as never)
    expect((r as NextResponse).status).toBe(404)
  })
  it('시크릿 일치 → legacy principal. 시크릿 미설정이면 레거시 분기 자체가 없음(401)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    process.env.AGENT_API_SECRET = 's3cret'
    const m = await load()
    expect(await m.resolveAgentPrincipal(req('Bearer s3cret'), adminWith(null) as never)).toEqual({ kind: 'legacy' })
    delete process.env.AGENT_API_SECRET
    vi.resetModules()
    const m2 = await load()
    const r = await m2.resolveAgentPrincipal(req('Bearer s3cret'), adminWith(null) as never)
    expect((r as NextResponse).status).toBe(401)
  })
  it('PAT 정상 → pat principal(스코프·프로젝트 한정 재료 포함)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const { token, prefix, hash } = generateAgentToken()
    const row = {
      id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: prefix, token_hash: hash,
      project_id: null, scopes: ['work:read'], enabled: true, revoked_at: null,
      expires_at: '2099-01-01T00:00:00Z',
    }
    const m = await load()
    const p = await m.resolveAgentPrincipal(req(`Bearer ${token}`), adminWith(row) as never)
    expect(p).toMatchObject({ kind: 'pat', userId: 'u-1', userEmail: 'dev@example.com', scopes: ['work:read'] })
  })
  it('PAT 폐기·만료·비활성·해시 불일치 → 전부 401', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const { token, prefix, hash } = generateAgentToken()
    const base = {
      id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: prefix, token_hash: hash,
      project_id: null, scopes: ['work:read'], enabled: true, revoked_at: null,
      expires_at: '2099-01-01T00:00:00Z',
    }
    const m = await load()
    for (const row of [
      { ...base, enabled: false },
      { ...base, revoked_at: '2026-01-01T00:00:00Z' },
      { ...base, expires_at: '2020-01-01T00:00:00Z' },
      { ...base, token_hash: 'f'.repeat(64) },
      null, // prefix 미존재
    ]) {
      const r = await m.resolveAgentPrincipal(req(`Bearer ${token}`), adminWith(row) as never)
      expect((r as NextResponse).status).toBe(401)
    }
  })
  it('시크릿이 설정돼 있어도 PAT 형식 bearer 는 legacy 매칭에 걸리지 않고 PAT 경로로 판별된다(공존)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    process.env.AGENT_API_SECRET = 's3cret'
    const { token, prefix, hash } = generateAgentToken()
    const row = {
      id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: prefix, token_hash: hash,
      project_id: null, scopes: ['work:read'], enabled: true, revoked_at: null,
      expires_at: '2099-01-01T00:00:00Z',
    }
    const m = await load()
    const p = await m.resolveAgentPrincipal(req(`Bearer ${token}`), adminWith(row) as never)
    expect(p).toMatchObject({ kind: 'pat', userId: 'u-1' })
  })
  it('requireScope — pat 부족 403 insufficient_scope, legacy 통과', async () => {
    const m = await load()
    const pat = {
      kind: 'pat', runnerId: 'r', userId: 'u', userEmail: 'e', scopes: ['work:read'],
      projectId: null, runnerKind: 'user_pat', tokenExpiresAt: '2099-01-01T00:00:00Z',
    } as const
    expect(m.requireScope({ kind: 'legacy' }, 'work:report')).toBeNull()
    expect(m.requireScope(pat, 'work:read')).toBeNull()
    expect(m.requireScope(pat, 'work:report')?.status).toBe(403)
  })
})
