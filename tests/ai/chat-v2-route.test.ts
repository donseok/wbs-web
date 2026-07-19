import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { EMPTY_CHAT_TOOL_REGISTRY } from '@/lib/ai/chat/registry'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getMembership: vi.fn(),
  createServerClient: vi.fn(),
  createDefaultRegistry: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession, getMembership: mocks.getMembership }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/ai/chat/default-registry', () => ({ createDefaultChatToolRegistry: mocks.createDefaultRegistry }))

import { POST } from '@/app/api/chat/v2/stream/route'

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/chat/v2/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function client(projects: string[], error: { message: string } | null = null) {
  return {
    from: () => ({ select: async () => ({ data: error ? null : projects.map(id => ({ id })), error }) }),
  }
}

describe('POST /api/chat/v2/stream composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CHAT_V2_ENABLED', 'true')
    mocks.getSession.mockResolvedValue({ id: 'u1' })
    mocks.getMembership.mockResolvedValue(null)
    mocks.createServerClient.mockResolvedValue(client(['p1']))
    mocks.createDefaultRegistry.mockReturnValue(EMPTY_CHAT_TOOL_REGISTRY)
  })

  it('returns 400 before streaming for mismatched page and legacy project context', async () => {
    const response = await POST(request({
      projectId: 'p1', message: '질문', history: [],
      pageContext: {
        contextVersion: 1, pathname: '/p/p2/wbs', domain: 'wbs', projectId: 'p2', timezone: 'Asia/Seoul',
      },
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'PROJECT_CONTEXT_MISMATCH' })
  })

  it('fails closed with 503 when the allowed-project lookup fails', async () => {
    mocks.createServerClient.mockResolvedValue(client([], { message: 'database down' }))
    const response = await POST(request({ projectId: 'p1', message: 'WBS 현황', history: [] }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'ACCESS_SCOPE_UNAVAILABLE' })
  })

  it('returns 403 for a project outside the server-resolved scope', async () => {
    const response = await POST(request({ projectId: 'p2', message: 'WBS 현황', history: [] }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' })
  })

  it('uses NDJSON for a valid stream and ends in one terminal event', async () => {
    const response = await POST(request({
      projectId: 'p1', message: '첨부파일 보여줘', history: [],
      pageContext: {
        contextVersion: 1, pathname: '/p/p1/wbs', domain: 'wbs', projectId: 'p1', timezone: 'Asia/Seoul',
      },
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as { type: string })
    expect(events.filter(e => e.type === 'done' || e.type === 'error')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('done')
  })

  it('returns 501 before streaming for unsupported pages so the client uses legacy chat', async () => {
    const response = await POST(request({
      projectId: null, message: '도와줘', history: [],
      pageContext: {
        contextVersion: 1, pathname: '/projects', domain: 'projects', projectId: null, timezone: 'Asia/Seoul',
      },
    }))
    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({ code: 'CHAT_V2_UNSUPPORTED' })
    expect(mocks.getSession).toHaveBeenCalledOnce()
    expect(mocks.getMembership).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
    expect(mocks.createDefaultRegistry).not.toHaveBeenCalled()
  })

  it('rejects an out-of-scope selected global meeting project before routing', async () => {
    const response = await POST(request({
      projectId: null, message: '그 회의 상세', history: [],
      pageContext: {
        contextVersion: 1, pathname: '/meetings', domain: 'meetings', projectId: null,
        selectedEntity: { type: 'meeting', id: 'm2' },
        selectedProjectId: 'p2', timezone: 'Asia/Seoul',
      },
    }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' })
  })

  it('returns 501 when the explicit v2 kill switch is off', async () => {
    vi.stubEnv('CHAT_V2_ENABLED', 'false')
    const response = await POST(request({ projectId: null, message: '질문', history: [] }))
    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({ code: 'CHAT_V2_DISABLED' })
  })
})
