import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueAnalysisIssueInput } from '@/lib/report/issues/model'

const mocks = vi.hoisted(() => ({
  generateAnswer: vi.fn(),
  hasLLM: vi.fn(() => true),
  llmConfig: vi.fn(() => ({ model: 'test-model', apiKey: 'test-key' })),
  createAdminClient: vi.fn(),
  cached: null as null | { id: string; analysis_json: unknown; model: string },
  upserts: [] as Record<string, unknown>[],
  cacheReads: 0,
}))

vi.mock('@/lib/ai/llm', () => ({ generateAnswer: mocks.generateAnswer }))
vi.mock('@/lib/ai/provider', () => ({
  hasLLM: mocks.hasLLM,
  llmConfig: mocks.llmConfig,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))

import { ensureIssueAnalysis } from '@/lib/ai/issue-analysis'

function adminClient() {
  return {
    from: () => ({
      select: () => {
        const query = {
          eq: () => query,
          maybeSingle: async () => {
            mocks.cacheReads += 1
            return { data: mocks.cached, error: null }
          },
        }
        return query
      },
      upsert: (payload: Record<string, unknown>) => {
        mocks.upserts.push(payload)
        return {
          select: () => ({
            single: async () => ({ data: { id: 'generated-run' }, error: null }),
          }),
        }
      },
    }),
  }
}

const issue = (
  megaCode: '00' | '01' | '02',
  index: number,
): IssueAnalysisIssueInput => ({
  id: `550e8400-e29b-41d4-a716-44665544${megaCode}${index}`,
  issueNo: index,
  piIssueCode: `PI-I-${megaCode}-01`,
  projectId: 'project-1',
  megaCode,
  megaSeq: 1,
  title: `${megaCode} 영역 이슈`,
  body: '업무 처리 기준이 표준화되어 있지 않다.',
  status: index % 2 ? 'resolved' : 'open',
  severity: 'medium',
  assigneeMemberIds: [],
  startDate: null,
  dueDate: null,
  subProcess: '업무 처리',
  ownerDepartment: 'PI팀',
  relatedSystems: ['ERP'],
  sourceType: 'interview',
  sourceDetail: '현업 인터뷰',
  minuteSources: [],
  resolutionNote: '',
  resolvedAt: null,
  createdBy: 'user-1',
  createdByName: '테스터',
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-30T00:00:00Z',
})

function opportunityResponse(prompt: string): string {
  const match = prompt.match(/<issue_data_json>\n([\s\S]+)\n<\/issue_data_json>/)
  if (!match) throw new Error('prompt payload missing')
  const payload = JSON.parse(match[1]) as {
    issues: Array<{ id: string; title: string }>
  }
  return JSON.stringify({
    opportunities: payload.issues.map(item => ({
      title: `${item.title} 개선`,
      description: '표준 절차와 통제 기준을 정립한다.',
      issueIds: [item.id],
    })),
  })
}

function causeResponse(prompt: string): string {
  const match = prompt.match(/<issue_data_json>\n([\s\S]+)\n<\/issue_data_json>/)
  if (!match) throw new Error('prompt payload missing')
  const payload = JSON.parse(match[1]) as {
    issues: Array<{ id: string; title: string }>
  }
  return JSON.stringify({
    causeAnalyses: payload.issues.map(item => ({
      issueId: item.id,
      causes: [{
        category: 'process',
        directCause: `${item.title}의 처리 절차와 기준이 표준화되어 있지 않다.`,
        rootCause: '업무 기준의 관리 책임과 정기 검토 체계가 정의되지 않았다.',
      }],
    })),
  })
}

function analysisResponse(system: string, prompt: string): string {
  return system.includes('causeAnalyses')
    ? causeResponse(prompt)
    : opportunityResponse(prompt)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cached = null
  mocks.upserts.length = 0
  mocks.cacheReads = 0
  mocks.hasLLM.mockReturnValue(true)
  mocks.llmConfig.mockReturnValue({ model: 'test-model', apiKey: 'test-key' })
  mocks.createAdminClient.mockImplementation(adminClient)
})

describe('ensureIssueAnalysis', () => {
  it('Mega 호출을 최대 2개로 제한하고 동일 project+hash 동시 요청을 한 실행으로 합친다', async () => {
    let active = 0
    let maxActive = 0
    mocks.generateAnswer.mockImplementation(async (
      _system: string,
      messages: Array<{ content: string }>,
    ) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      const response = analysisResponse(_system, messages[0].content)
      active -= 1
      return response
    })
    const issues = [issue('00', 1), issue('01', 2), issue('02', 3)]

    const [first, duplicate] = await Promise.all([
      ensureIssueAnalysis('project-1', issues, 'user-1'),
      ensureIssueAnalysis('project-1', issues, 'user-2'),
    ])

    expect(first).toMatchObject({ state: 'generated', runId: 'generated-run' })
    expect(duplicate).toEqual(first)
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(6)
    expect(maxActive).toBe(2)
    expect(mocks.cacheReads).toBe(1)
    expect(mocks.upserts).toHaveLength(1)
    expect(mocks.upserts[0]).toMatchObject({
      issue_count: 3,
      created_by: 'user-1',
      status: 'ready',
      prompt_version: 'issue-causes-opportunities-defs-v3',
    })
    expect(mocks.upserts[0]).toMatchObject({
      analysis_json: {
        areas: expect.arrayContaining([
          expect.objectContaining({
            megaCode: '00',
            causeAnalyses: [expect.objectContaining({
              issueId: issues[0].id,
              causes: [expect.objectContaining({ category: 'process' })],
            })],
          }),
        ]),
      },
    })
  })

  it('같은 입력의 검증된 DB 실행 행을 재사용하고 LLM을 다시 호출하지 않는다', async () => {
    mocks.generateAnswer.mockImplementation(async (
      _system: string,
      messages: Array<{ content: string }>,
    ) => analysisResponse(_system, messages[0].content))
    const issues = [issue('00', 1)]
    const generated = await ensureIssueAnalysis('project-1', issues, 'user-1')
    expect(generated.state).toBe('generated')
    const saved = mocks.upserts[0]
    mocks.cached = {
      id: 'cached-run',
      analysis_json: saved.analysis_json,
      model: 'test-model',
    }
    mocks.generateAnswer.mockClear()

    const cached = await ensureIssueAnalysis('project-1', issues, 'user-1')
    expect(cached).toMatchObject({
      state: 'ready',
      runId: 'cached-run',
      model: 'test-model',
    })
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('현재 prompt 버전 캐시에 원인분석이 없으면 원인 없는 결과로 재사용하지 않는다', async () => {
    mocks.generateAnswer.mockImplementation(async (
      system: string,
      messages: Array<{ content: string }>,
    ) => analysisResponse(system, messages[0].content))
    const issues = [issue('00', 1)]
    const generated = await ensureIssueAnalysis('project-1', issues, 'user-1')
    expect(generated.state).toBe('generated')
    const legacyAnalysis = JSON.parse(JSON.stringify(mocks.upserts[0].analysis_json)) as {
      areas: Array<Record<string, unknown>>
    }
    legacyAnalysis.areas.forEach(area => delete area.causeAnalyses)
    mocks.cached = {
      id: 'legacy-cache',
      analysis_json: legacyAnalysis,
      model: 'test-model',
    }
    mocks.generateAnswer.mockClear()

    const cached = await ensureIssueAnalysis('project-1', issues, 'user-1')

    expect(cached).toMatchObject({ state: 'unavailable', reason: 'storage_failed' })
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('현재 설정 모델과 다른 캐시는 miss로 보고 같은 unique 행을 새 모델 결과로 교체한다', async () => {
    mocks.generateAnswer.mockImplementation(async (
      _system: string,
      messages: Array<{ content: string }>,
    ) => analysisResponse(_system, messages[0].content))
    const issues = [issue('00', 1)]
    const first = await ensureIssueAnalysis('project-1', issues, 'user-1')
    expect(first.state).toBe('generated')
    mocks.cached = {
      id: 'old-model-run',
      analysis_json: mocks.upserts[0].analysis_json,
      model: 'old-model',
    }
    mocks.generateAnswer.mockClear()

    const regenerated = await ensureIssueAnalysis('project-1', issues, 'user-1')
    expect(regenerated).toMatchObject({ state: 'generated', model: 'test-model' })
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(2)
    expect(mocks.upserts).toHaveLength(2)
    expect(mocks.upserts[1]).toMatchObject({ model: 'test-model' })
  })

  it('어느 Mega라도 생성 실패하면 부분 결과를 저장하지 않는다', async () => {
    mocks.generateAnswer.mockImplementation(async (
      _system: string,
      messages: Array<{ content: string }>,
    ) => {
      if (messages[0].content.includes('"megaCode":"01"')) return null
      await new Promise(resolve => setTimeout(resolve, 5))
      return analysisResponse(_system, messages[0].content)
    })
    const result = await ensureIssueAnalysis('project-1', [
      issue('00', 1),
      issue('01', 2),
      issue('02', 3),
    ], 'user-1')
    expect(result).toMatchObject({ state: 'unavailable', reason: 'llm_failed' })
    expect(mocks.upserts).toHaveLength(0)
  })

  it('한 Mega의 원인분석을 최대 3개 이슈 chunk로 나누고 전체 UUID를 한 번씩 저장한다', async () => {
    const causeChunkSizes: number[] = []
    mocks.generateAnswer.mockImplementation(async (
      system: string,
      messages: Array<{ content: string }>,
    ) => {
      if (system.includes('causeAnalyses')) {
        const match = messages[0].content.match(/<issue_data_json>\n([\s\S]+)\n<\/issue_data_json>/)
        const payload = JSON.parse(match?.[1] ?? '{}') as { issues?: unknown[] }
        causeChunkSizes.push(payload.issues?.length ?? 0)
      }
      return analysisResponse(system, messages[0].content)
    })
    const issues = Array.from({ length: 4 }, (_, index) => ({
      ...issue('00', index + 1),
      id: `550e8400-e29b-41d4-a716-4466554400${index}`,
      issueNo: index + 1,
      megaSeq: index + 1,
      piIssueCode: `PI-I-00-${String(index + 1).padStart(2, '0')}`,
      title: `기준관리 이슈 ${index + 1}`,
    }))

    const result = await ensureIssueAnalysis('project-1', issues, 'user-1')

    expect(result).toMatchObject({ state: 'generated' })
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(3)
    expect(causeChunkSizes).toEqual([3, 1])
    expect(mocks.upserts).toHaveLength(1)
    const analysis = mocks.upserts[0].analysis_json as {
      areas: Array<{ megaCode: string; causeAnalyses?: Array<{ issueId: string }> }>
    }
    expect(analysis.areas.find(area => area.megaCode === '00')?.causeAnalyses?.map(item => item.issueId))
      .toEqual(issues.map(item => item.id))
  })

  it('원인분석 chunk가 이슈를 누락하면 개선기회만 부분 저장하지 않는다', async () => {
    mocks.generateAnswer.mockImplementation(async (
      system: string,
      messages: Array<{ content: string }>,
    ) => {
      if (system.includes('causeAnalyses')) return JSON.stringify({ causeAnalyses: [] })
      return opportunityResponse(messages[0].content)
    })

    const result = await ensureIssueAnalysis('project-1', [issue('00', 1)], 'user-1')

    expect(result).toMatchObject({ state: 'unavailable', reason: 'invalid_response' })
    expect(mocks.upserts).toHaveLength(0)
  })
})
