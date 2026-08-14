import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getActorViewState: vi.fn(),
  resolveScope: vi.fn(),
  embedDocuments: vi.fn(),
  lexical: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({ getActorViewState: mocks.getActorViewState }))
vi.mock('@/lib/authz/accessScope', () => ({
  createSupabaseAccessScopeResolver: () => ({ resolve: mocks.resolveScope }),
}))
vi.mock('@/lib/ai/embeddings', () => ({ embedDocuments: mocks.embedDocuments }))
vi.mock('@/lib/ai/index/lexical', () => ({ createLexicalSearch: () => mocks.lexical }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))
// Task 7 exports toFusionCandidate
vi.mock('@/lib/ai/index/lexical', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/index/lexical')>('@/lib/ai/index/lexical')
  return {
    ...actual,
    createLexicalSearch: () => mocks.lexical,
  }
})

import { POST } from '@/app/api/wiki/search/route'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/wiki/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getActorViewState.mockResolvedValue({ actor: { userId: 'u1' }, degraded: false })
  mocks.resolveScope.mockResolvedValue({ ok: true, scope: { allowedProjectIds: [PROJECT] } })
  mocks.embedDocuments.mockResolvedValue([[0.1, 0.2]])
  mocks.lexical.mockResolvedValue({ ok: true, candidates: [] })
  mocks.rpc.mockResolvedValue({ data: [], error: null })
})

describe('POST /api/wiki/search', () => {
  it('허용되지 않은 프로젝트는 403 — 비공개 프로젝트 유출을 막는다', async () => {
    const res = await POST(request({ projectId: OTHER, q: '권한' }))
    expect(res.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.lexical).not.toHaveBeenCalled()
  })

  it('로그인하지 않았으면 401', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: null, degraded: false })
    expect((await POST(request({ projectId: PROJECT, q: '권한' }))).status).toBe(401)
  })

  it('스코프 조회 실패는 503 — 빈 결과로 위장하지 않는다', async () => {
    mocks.resolveScope.mockResolvedValue({ ok: false, code: 'ACCESS_SCOPE_UNAVAILABLE' })
    expect((await POST(request({ projectId: PROJECT, q: '권한' }))).status).toBe(503)
  })

  it('벡터 RPC 에 서버가 확정한 projectIds 만 넘긴다', async () => {
    await POST(request({ projectId: PROJECT, q: '권한', projectIds: [OTHER] }))
    expect(mocks.rpc).toHaveBeenCalledWith('match_ai_documents', expect.objectContaining({
      p_project_ids: [PROJECT], p_include_global: false,
    }))
  })

  it('임베딩이 실패하면 어휘 다리만으로 답하고 degraded 를 알린다', async () => {
    mocks.embedDocuments.mockResolvedValue(null)
    const res = await POST(request({ projectId: PROJECT, q: '권한' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ degraded: true })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.lexical).toHaveBeenCalled()
  })

  it('빈 질의는 200 에 빈 결과', async () => {
    const res = await POST(request({ projectId: PROJECT, q: '  ' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ results: [] })
  })

  it('actor 조회가 degraded 면 503', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: { userId: 'u1' }, degraded: true })
    expect((await POST(request({ projectId: PROJECT, q: '권한' }))).status).toBe(503)
  })

  it('긴 자연어 질의는 토큰 배열로 어휘 검색을 한다', async () => {
    await POST(request({ projectId: PROJECT, q: 'MES 권한은 어떻게 신청하지?' }))
    // createLexicalSearch 호출 시 tokens 인자가 배열이어야 한다.
    // deriveSearchKeywords() 가 토큰화하고, 0084 의 unnest join 으로 각각 OR 매칭한다.
    expect(mocks.lexical).toHaveBeenCalled()
    const call = mocks.lexical.mock.calls[0][0]
    expect(Array.isArray(call.tokens)).toBe(true)
    expect(call.tokens.length).toBeGreaterThan(0)
  })

  it('키워드가 없으면 어휘 검색을 건너뛴다', async () => {
    // 불용어만 있는 질의
    mocks.embedDocuments.mockResolvedValue(null)
    await POST(request({ projectId: PROJECT, q: '는 을 를' }))
    // 키워드가 0개면 lexical을 부르지 않는다.
    expect(mocks.lexical).not.toHaveBeenCalled()
  })

  it('어휘 검색 실패는 degraded 로 처리한다(503 아님)', async () => {
    mocks.lexical.mockResolvedValue({ ok: false, errorCode: 'LEXICAL_SEARCH_FAILED' })
    const res = await POST(request({ projectId: PROJECT, q: '권한' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ degraded: true })
  })
})
