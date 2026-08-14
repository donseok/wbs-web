import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolve: vi.fn(),
  searchWikiKnowledge: vi.fn(),
  documentRows: [] as Array<Record<string, unknown>>,
  documentError: null as { code?: string; message?: string } | null,
  questionRows: [] as Array<Record<string, unknown>>,
  questionError: null as { code?: string; message?: string } | null,
  from: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: mocks.from }) }))
vi.mock('@/lib/authz/accessScope', () => ({
  createSupabaseAccessScopeResolver: () => ({ resolve: mocks.resolve }),
}))
vi.mock('@/lib/repositories/supabase/wiki', () => ({
  createSupabaseWikiRepository: () => ({ searchWikiKnowledge: mocks.searchWikiKnowledge }),
}))

import { POST } from '@/app/api/wiki/ask/route'
import { wikiAskTokens } from '@/lib/domain/wikiAsk'

const request = (body: unknown) => new Request('http://localhost/api/wiki/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}) as never

const record = {
  id: 'item-1', projectId: 'project-1', topicId: 'topic-1', topicTitle: 'ERP 연계',
  kind: 'decision', statement: 'ERP 연계 방식은 REST API로 확정했다.',
  lifecycleState: 'active', certainty: 'explicit', decisionState: 'confirmed',
  ownerTeam: 'ERP', dueDate: null, observedAt: null, updatedAt: '2026-08-13T00:00:00Z',
  sourceMinuteIds: ['minute-1'], evidenceExcerpt: 'REST API 연계로 확정한다.',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.documentRows = []
  mocks.documentError = null
  mocks.questionRows = []
  mocks.questionError = null
  mocks.from.mockImplementation((table: string) => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'not', 'or', 'order']) {
      builder[method] = vi.fn(() => builder)
    }
    builder.limit = vi.fn(async () => table === 'wiki_questions'
      ? { data: mocks.questionRows, error: mocks.questionError }
      : { data: mocks.documentRows, error: mocks.documentError })
    return builder
  })
  mocks.getSession.mockResolvedValue({ id: 'user-1' })
  mocks.resolve.mockResolvedValue({
    ok: true,
    scope: { allowedProjectIds: ['project-1'], capabilities: ['wiki:read'] },
  })
  mocks.searchWikiKnowledge.mockResolvedValue({
    ok: true,
    data: { items: [record], scanTruncated: false },
  })
})

describe('Wiki Ask 결정형 폴백', () => {
  it('한국어 질문에서 조사·일반어를 제거하고 검색 단위를 만든다', () => {
    expect(wikiAskTokens('ERP 연계 방식은 어떻게 결정했나요?')).toEqual(['ERP', '연계', '방식', '결정했'])
  })

  it('프로젝트 접근 범위 밖이면 저장소를 호출하지 않는다', async () => {
    mocks.resolve.mockResolvedValue({
      ok: true,
      scope: { allowedProjectIds: [], capabilities: ['wiki:read'] },
    })
    const response = await POST(request({ projectId: 'project-1', question: '결정 사항은?' }))
    expect(response.status).toBe(403)
    expect(mocks.searchWikiKnowledge).not.toHaveBeenCalled()
  })

  it('현재 지식과 번호가 1:1로 연결된 Wiki 근거를 반환한다', async () => {
    const response = await POST(request({ projectId: 'project-1', question: 'ERP 연계 결정은?' }))
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.answer).toContain('REST API')
    expect(payload.answer).toContain('• [1] [현재 유효]')
    expect(payload.grounded).toBe(true)
    expect(payload.sources).toEqual([expect.objectContaining({
      domain: 'wiki', entityType: 'wiki_item', title: '[1] ERP 연계',
    })])
    expect(mocks.searchWikiKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      kind: 'decision',
    }))
  })

  it('결과가 없으면 추측하지 않고 빈 근거를 반환한다', async () => {
    mocks.searchWikiKnowledge.mockResolvedValue({
      ok: true,
      data: { items: [], scanTruncated: false },
    })
    const response = await POST(request({ projectId: 'project-1', question: '없는 절차는?' }))
    const payload = await response.json()
    expect(payload).toMatchObject({ answer: '', sources: [], grounded: false })
  })

  it('사람이 쓴 정본 문서 본문을 먼저 찾고 검증 상태와 문서 출처를 표시한다', async () => {
    mocks.documentRows = [{
      id: 'topic-doc', title: '야간 장애 대응',
      body_md: '## 절차\n\n야간 장애는 당직자가 우선 복구하고 운영팀에 알린다.',
      body_updated_at: '2026-08-13T00:00:00Z', updated_at: '2026-08-13T00:00:00Z',
      verified_at: '2026-08-12T00:00:00Z', review_due_at: '2099-01-01T00:00:00Z',
    }]
    mocks.searchWikiKnowledge.mockResolvedValue({
      ok: true,
      data: { items: [], scanTruncated: false },
    })

    const response = await POST(request({ projectId: 'project-1', question: '야간 장애 대응 절차는?' }))
    const payload = await response.json()
    expect(payload.answer).toContain('[검증됨] 야간 장애 대응')
    expect(payload.answer).toContain('당직자가 우선 복구')
    expect(payload.sources).toEqual([expect.objectContaining({
      domain: 'wiki', entityType: 'wiki_topic', entityId: 'topic-doc',
    })])
    expect(payload.grounded).toBe(true)
  })

  it('0079 문서 컬럼이 아직 없으면 기존 지식 검색으로 안전하게 폴백한다', async () => {
    mocks.documentError = { code: 'PGRST204', message: "Could not find the 'body_md' column" }
    mocks.questionError = { code: '42P01', message: 'relation wiki_questions does not exist' }
    const response = await POST(request({ projectId: 'project-1', question: 'ERP 연계 결정은?' }))
    const payload = await response.json()
    expect(payload.answer).toContain('REST API')
    expect(payload.grounded).toBe(true)
  })

  it('지식 공백에 사람이 남긴 답변을 다음 Ask의 출처 있는 지식으로 재사용한다', async () => {
    mocks.questionRows = [{
      id: 'question-1', topic_id: null, question: '야간 장애는 누가 처리하나요?',
      answer: '당직자가 먼저 복구하고 운영팀에 알립니다.', updated_at: '2026-08-13T00:00:00Z',
    }]
    mocks.searchWikiKnowledge.mockResolvedValue({
      ok: true,
      data: { items: [], scanTruncated: false },
    })

    const response = await POST(request({ projectId: 'project-1', question: '야간 장애 처리 담당은?' }))
    const payload = await response.json()
    expect(payload.answer).toContain('당직자가 먼저 복구')
    expect(payload.sources).toEqual([expect.objectContaining({
      domain: 'wiki', entityType: 'wiki_question', entityId: 'question-1',
      href: '/p/project-1/wiki?question=question-1#wiki-question-question-1',
    })])
    expect(payload.grounded).toBe(true)
  })

  it('의미 토큰이나 지원 intent가 없는 질문에는 최신 문서를 임의 답변하지 않는다', async () => {
    mocks.documentRows = [{
      id: 'unrelated', title: '무관한 최신 문서', body_md: '질문과 관계없는 내용',
      body_updated_at: '2026-08-13T00:00:00Z', updated_at: '2026-08-13T00:00:00Z',
      verified_at: '2026-08-12T00:00:00Z', review_due_at: '2099-01-01T00:00:00Z',
    }]

    const response = await POST(request({ projectId: 'project-1', question: '뭐?' }))
    expect(await response.json()).toMatchObject({ answer: '', sources: [], grounded: false })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.searchWikiKnowledge).not.toHaveBeenCalled()
  })

  it('한국어·영어 최근 변경 intent는 최신 지식 조회로 라우팅한다', async () => {
    for (const question of ['최근에 바뀐 내용은?', 'What changed recently?']) {
      mocks.searchWikiKnowledge.mockClear()
      const response = await POST(request({ projectId: 'project-1', question }))
      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(payload.answer).toContain('최근 업데이트된 프로젝트 Wiki')
      expect(mocks.searchWikiKnowledge).toHaveBeenCalledWith(expect.objectContaining({ query: null }))
    }
  })

  it('추천하는 열린 질문 문구는 텍스트 검색이 아니라 question 유형 조회로 라우팅한다', async () => {
    const response = await POST(request({ projectId: 'project-1', question: '아직 해결되지 않은 질문은?' }))
    expect(response.status).toBe(200)
    expect(mocks.searchWikiKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'question',
      query: null,
    }))
  })

  it('상충·잠정 지식을 확인된 사실처럼 표시하지 않는다', async () => {
    mocks.searchWikiKnowledge.mockResolvedValue({
      ok: true,
      data: {
        items: [
          { ...record, id: 'conflict', lifecycleState: 'conflicted' },
          { ...record, id: 'tentative', decisionState: 'tentative', certainty: 'tentative' },
        ],
        scanTruncated: false,
      },
    })

    const response = await POST(request({ projectId: 'project-1', question: 'ERP 연계 결정은?' }))
    const payload = await response.json()
    expect(payload.answer).toContain('[상충 확인 필요]')
    expect(payload.answer).toContain('[잠정]')
    expect(payload.sources).toHaveLength(2)
  })
})
