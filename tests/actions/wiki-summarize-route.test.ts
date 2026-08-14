import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getActorViewState: vi.fn(),
  resolveScope: vi.fn(),
  generateAnswer: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({ getActorViewState: mocks.getActorViewState }))
vi.mock('@/lib/authz/accessScope', () => ({
  createSupabaseAccessScopeResolver: () => ({ resolve: mocks.resolveScope }),
}))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: mocks.generateAnswer }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { POST } from '@/app/api/wiki/summarize/route'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

const ONE_SOURCE = [{ n: 1, title: 'MES 권한 신청', snippet: '팀장 승인 후 IT팀이 발급합니다.', domain: 'wiki' }]

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/wiki/summarize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getActorViewState.mockResolvedValue({ actor: { userId: 'u1' }, degraded: false })
  mocks.resolveScope.mockResolvedValue({ ok: true, scope: { allowedProjectIds: [PROJECT] } })
  mocks.generateAnswer.mockResolvedValue('MES 권한은 팀장 승인 후 IT팀이 발급합니다. [1]')
})

describe('POST /api/wiki/summarize', () => {
  it('로그인하지 않았으면 401 — LLM 호출 전에 막는다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: null, degraded: false })
    const res = await POST(request({ projectId: PROJECT, q: '권한', sources: ONE_SOURCE }))
    expect(res.status).toBe(401)
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('actor 조회가 degraded 면 503 — 인증 실패로 위장하지 않는다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: { userId: 'u1' }, degraded: true })
    const res = await POST(request({ projectId: PROJECT, q: '권한', sources: ONE_SOURCE }))
    expect(res.status).toBe(503)
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('허용되지 않은 프로젝트는 403 — LLM 미호출', async () => {
    const res = await POST(request({ projectId: OTHER, q: '권한', sources: ONE_SOURCE }))
    expect(res.status).toBe(403)
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('스코프 조회 실패는 503 — 빈 결과로 위장하지 않는다', async () => {
    mocks.resolveScope.mockResolvedValue({ ok: false, code: 'ACCESS_SCOPE_UNAVAILABLE' })
    const res = await POST(request({ projectId: PROJECT, q: '권한', sources: ONE_SOURCE }))
    expect(res.status).toBe(503)
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('sources 9개는 400 — LLM 미호출', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({
      n: (i % 8) + 1, title: `제목 ${i}`, snippet: '발췌', domain: 'wiki',
    }))
    const res = await POST(request({ projectId: PROJECT, q: '권한', sources: nine }))
    expect(res.status).toBe(400)
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('sources 가 0개면 400', async () => {
    const res = await POST(request({ projectId: PROJECT, q: '권한', sources: [] }))
    expect(res.status).toBe(400)
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('snippet 이 500자를 넘으면 400', async () => {
    const tooLong = [{ n: 1, title: '제목', snippet: 'x'.repeat(501), domain: 'wiki' }]
    const res = await POST(request({ projectId: PROJECT, q: '권한', sources: tooLong }))
    expect(res.status).toBe(400)
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('title 이 120자를 넘으면 400', async () => {
    const tooLong = [{ n: 1, title: 'x'.repeat(121), snippet: '발췌', domain: 'wiki' }]
    const res = await POST(request({ projectId: PROJECT, q: '권한', sources: tooLong }))
    expect(res.status).toBe(400)
  })

  it('n 이 1~8 범위를 벗어나면 400', async () => {
    const bad = [{ n: 9, title: '제목', snippet: '발췌', domain: 'wiki' }]
    const res = await POST(request({ projectId: PROJECT, q: '권한', sources: bad }))
    expect(res.status).toBe(400)
  })

  it('q 가 200자를 넘으면 400', async () => {
    const res = await POST(request({ projectId: PROJECT, q: 'x'.repeat(201), sources: ONE_SOURCE }))
    expect(res.status).toBe(400)
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('q 가 공백뿐이면 400', async () => {
    const res = await POST(request({ projectId: PROJECT, q: '   ', sources: ONE_SOURCE }))
    expect(res.status).toBe(400)
  })

  it('LLM 이 null 을 반환하면 503 SUMMARY_UNAVAILABLE — 빈 답으로 위장하지 않는다', async () => {
    mocks.generateAnswer.mockResolvedValue(null)
    const res = await POST(request({ projectId: PROJECT, q: '권한', sources: ONE_SOURCE }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'SUMMARY_UNAVAILABLE' })
  })

  it('성공하면 200 에 { answer }', async () => {
    const res = await POST(request({ projectId: PROJECT, q: '권한', sources: ONE_SOURCE }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ answer: 'MES 권한은 팀장 승인 후 IT팀이 발급합니다. [1]' })
  })

  it('LLM 호출 메시지에 질문과 근거 번호·도메인·제목·발췌가 들어간다', async () => {
    const sources = [
      { n: 1, title: 'MES 권한 신청', snippet: '팀장 승인 후 발급', domain: 'wiki' },
      { n: 2, title: '접근 정책', snippet: '부서장 승인 필요', domain: 'issue' },
    ]
    await POST(request({ projectId: PROJECT, q: 'MES 권한은 어떻게 신청하지?', sources }))
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(1)
    const [system, messages] = mocks.generateAnswer.mock.calls[0]
    expect(typeof system).toBe('string')
    expect(system).toContain('[근거]')
    expect(messages).toEqual([
      { role: 'user', content: expect.stringContaining('MES 권한은 어떻게 신청하지?') },
    ])
    const content = messages[0].content as string
    expect(content).toContain('[1] (wiki) MES 권한 신청 — 팀장 승인 후 발급')
    expect(content).toContain('[2] (issue) 접근 정책 — 부서장 승인 필요')
  })
})
