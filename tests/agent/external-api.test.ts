import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('agent externalApi 게이트', () => {
  const OLD = { ...process.env }
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { process.env = { ...OLD } })

  async function load() { return await import('@/lib/agent/externalApi') }
  function req(auth?: string) {
    return new Request('http://localhost/api/v1/agent/work', {
      headers: auth ? { Authorization: auth } : {},
    })
  }

  it('env 미설정이면 닫힘(fail-closed) — 404', async () => {
    delete process.env.AGENT_API_ENABLED
    delete process.env.AGENT_API_SECRET
    const m = await load()
    expect(m.agentApiEnabled()).toBe(false)
    const res = m.gateAgentApi(req('Bearer x'))
    expect(res?.status).toBe(404)
  })
  it('ENABLED=true 면 SECRET 없어도 API 는 열림 — 레거시 분기만 닫힘(계약 v2.0)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    delete process.env.AGENT_API_SECRET
    const m = await load()
    expect(m.agentApiEnabled()).toBe(true)
    expect(m.gateAgentApi(req('Bearer anything'))?.status).toBe(401)
  })
  it('시크릿 불일치 401, 일치 통과(null)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    process.env.AGENT_API_SECRET = 's3cret'
    const m = await load()
    expect(m.gateAgentApi(req('Bearer wrong'))?.status).toBe(401)
    expect(m.gateAgentApi(req())?.status).toBe(401)
    expect(m.gateAgentApi(req('Bearer s3cret'))).toBeNull()
  })
})

describe('isAgentProjectMember — fail-closed', () => {
  function admin(memberships: unknown, roles: unknown, memErr?: unknown, roleErr?: unknown) {
    const builder = (data: unknown, error: unknown) => {
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data, error })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(r)
      return b
    }
    return {
      from: (t: string) => t === 'memberships' ? builder(memberships, memErr ?? null) : builder(roles, roleErr ?? null),
    }
  }
  it('슈퍼유저 통과', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    expect(await isAgentProjectMember(admin({ is_superuser: true }, []) as never, 'u', 'p')).toBe(true)
  })
  it('프로젝트 역할 보유 통과, 없으면 거절', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    expect(await isAgentProjectMember(admin({ is_superuser: false }, [{ role: 'member' }]) as never, 'u', 'p')).toBe(true)
    expect(await isAgentProjectMember(admin({ is_superuser: false }, []) as never, 'u', 'p')).toBe(false)
  })
  it('조회 실패는 거절(fail-closed)', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    expect(await isAgentProjectMember(admin(null, [], { message: 'db down' }) as never, 'u', 'p')).toBe(false)
  })
})
