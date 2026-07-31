import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueAnalysisIssueInput } from '@/lib/report/issues/model'

const mocks = vi.hoisted(() => ({
  requireProjectMember: vi.fn(),
  loadIssueAnalysisIssues: vi.fn(),
  ensureIssueAnalysis: vi.fn(),
  diagnoseIssueAnalysisTemplate: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember,
}))
vi.mock('@/lib/data/issueAnalysis', () => ({
  loadIssueAnalysisIssues: mocks.loadIssueAnalysisIssues,
}))
vi.mock('@/lib/ai/issue-analysis', () => ({
  ensureIssueAnalysis: mocks.ensureIssueAnalysis,
}))
vi.mock('@/lib/report/issues/template', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/report/issues/template')>()
  return {
    ...actual,
    diagnoseIssueAnalysisTemplate: mocks.diagnoseIssueAnalysisTemplate,
  }
})

import { ensureIssueAnalysisAction } from '@/app/actions/issueAnalysis'

const readyIssue = (over: Partial<IssueAnalysisIssueInput> = {}): IssueAnalysisIssueInput => ({
  id: '550e8400-e29b-41d4-a716-446655440000',
  issueNo: 1,
  piIssueCode: 'PI-I-00-01',
  projectId: 'project-1',
  megaCode: '00',
  megaSeq: 1,
  title: '기준정보 중복',
  body: '자재 코드가 중복 등록된다.',
  status: 'open',
  severity: 'high',
  assigneeMemberIds: [],
  startDate: null,
  dueDate: null,
  subProcess: '자재 등록',
  ownerDepartment: '기준정보팀',
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
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue({
    ok: true,
    actor: { userId: 'user-1' },
  })
  mocks.loadIssueAnalysisIssues.mockResolvedValue([readyIssue()])
  mocks.diagnoseIssueAnalysisTemplate.mockResolvedValue({
    status: 'ready',
    message: '사용 가능',
    path: '/Users/internal/wbs/src/lib/report/assets/issue-analysis-template.pptx',
  })
})

describe('ensureIssueAnalysisAction', () => {
  it('프로젝트 멤버 가드가 실패하면 원본/AI에 접근하지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    const result = await ensureIssueAnalysisAction('project-1')
    expect(result).toMatchObject({
      ok: false,
      state: 'unavailable',
      error: '권한 없음',
      preflight: null,
    })
    expect(mocks.loadIssueAnalysisIssues).not.toHaveBeenCalled()
    expect(mocks.ensureIssueAnalysis).not.toHaveBeenCalled()
  })

  it('엄격 로더의 부분 조회 실패를 unavailable로 명시하고 AI를 호출하지 않는다', async () => {
    mocks.loadIssueAnalysisIssues.mockRejectedValue(
      new Error('[issue-analysis] 담당자 조회 실패: database unavailable'),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await ensureIssueAnalysisAction('project-1')
    expect(result).toMatchObject({
      ok: false,
      state: 'unavailable',
      preflight: null,
    })
    expect(result.error).toContain('담당자 조회 실패')
    expect(mocks.ensureIssueAnalysis).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('사전 점검 누락을 상세 preflight와 함께 blocked로 반환한다', async () => {
    mocks.loadIssueAnalysisIssues.mockResolvedValue([
      readyIssue({ megaCode: null, megaSeq: null, piIssueCode: null }),
    ])
    const result = await ensureIssueAnalysisAction('project-1')
    expect(result).toMatchObject({
      ok: false,
      state: 'blocked',
      preflight: { totalCount: 1, readyCount: 0, blockedCount: 1 },
    })
    expect(result.preflight?.blockedIssues[0].reasons).toContain(
      'Mega 영역이 지정되지 않았습니다.',
    )
    expect(mocks.ensureIssueAnalysis).not.toHaveBeenCalled()
  })

  it('생성 성공 시 runId/analysis를 전달하고 서버 절대경로를 노출하지 않는다', async () => {
    const analysis = {
      schemaVersion: 'issue-analysis.v1',
      projectId: 'project-1',
      issueCount: 1,
      generatedAt: '2026-07-31T00:00:00Z',
      areas: [],
    }
    mocks.ensureIssueAnalysis.mockResolvedValue({
      state: 'generated',
      runId: 'run-1',
      analysis,
      inputHash: 'a'.repeat(64),
      model: 'test-model',
    })
    const result = await ensureIssueAnalysisAction('project-1')
    expect(result).toMatchObject({
      ok: true,
      state: 'generated',
      runId: 'run-1',
      analysis,
      template: {
        status: 'ready',
        path: 'src/lib/report/assets/issue-analysis-template.pptx',
      },
      pptExport: {
        status: 'ready',
        code: 'PPT_EXPORT_READY',
      },
    })
    expect(result.template.path).not.toContain('/Users/')
    expect(mocks.ensureIssueAnalysis).toHaveBeenCalledWith(
      'project-1',
      expect.any(Array),
      'user-1',
    )
  })

  it('LLM 미설정/생성 실패를 명시적 unavailable로 전달한다', async () => {
    mocks.ensureIssueAnalysis.mockResolvedValue({
      state: 'unavailable',
      reason: 'llm_missing',
      error: 'LLM 설정이 없어 이슈 분석서를 생성할 수 없습니다.',
      inputHash: 'a'.repeat(64),
    })
    const result = await ensureIssueAnalysisAction('project-1')
    expect(result).toMatchObject({
      ok: false,
      state: 'unavailable',
      error: 'LLM 설정이 없어 이슈 분석서를 생성할 수 없습니다.',
      preflight: { readyCount: 1, blockedCount: 0 },
    })
  })
})
