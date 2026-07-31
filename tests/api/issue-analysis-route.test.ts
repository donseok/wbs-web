import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { IssueAnalysisIssueInput } from '@/lib/report/issues/model'
import {
  buildIssueAnalysisInputSnapshot,
  buildIssueAnalysisReport,
} from '@/lib/report/issues/model'

const mocks = vi.hoisted(() => ({
  requireProjectMember: vi.fn(),
  getDisplayName: vi.fn(),
  loadSavedIssueAnalysisRun: vi.fn(),
  getDiagnostic: vi.fn(),
  renderIssueAnalysisPpt: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember,
}))
vi.mock('@/lib/auth', () => ({
  getDisplayName: mocks.getDisplayName,
}))
vi.mock('@/lib/data/issueAnalysis', () => ({
  loadSavedIssueAnalysisRun: mocks.loadSavedIssueAnalysisRun,
}))
vi.mock('@/lib/report/issues/export', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/report/issues/export')>()
  return {
    ...actual,
    getIssueAnalysisPptExportDiagnostic: mocks.getDiagnostic,
    renderIssueAnalysisPpt: mocks.renderIssueAnalysisPpt,
  }
})
import { GET } from '@/app/api/issue-analysis/route'

function request(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/issue-analysis${query}`)
}

function issue(): IssueAnalysisIssueInput {
  return {
    id: 'issue-1',
    issueNo: 1,
    projectId: 'project-1',
    title: '기준정보 중복',
    body: '동일 자재가 여러 코드로 관리된다.',
    status: 'open',
    severity: 'high',
    assigneeMemberIds: [],
    startDate: null,
    dueDate: null,
    minuteSources: [],
    resolutionNote: '',
    resolvedAt: null,
    createdBy: 'user-1',
    createdByName: '테스터',
    createdAt: '2026-07-30T00:00:00Z',
    updatedAt: '2026-07-30T00:00:00Z',
    megaCode: '00',
    megaSeq: 1,
    piIssueCode: 'PI-I-00-01',
    subProcess: '자재 등록',
    ownerDepartment: '기준정보팀',
    relatedSystems: ['ERP'],
    sourceType: 'interview',
    sourceDetail: '기준정보팀 인터뷰',
  }
}

function report() {
  const snapshot = buildIssueAnalysisInputSnapshot('project-1', [issue()])
  return buildIssueAnalysisReport(snapshot, {
    '00': [{
      title: '기준정보 단일화',
      description: '중복 등록을 통제한다.',
      issueIds: ['issue-1'],
    }],
  }, '2026-07-31T00:00:00Z')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue({
    ok: true,
    actor: { userId: 'user-1', teamCode: 'PI' },
  })
  mocks.getDisplayName.mockResolvedValue('이돈석')
  mocks.loadSavedIssueAnalysisRun.mockResolvedValue({
    runId: 'run-1',
    projectId: 'project-1',
    projectName: 'D-Cube 프로젝트',
    report: report(),
  })
  mocks.getDiagnostic.mockReturnValue({
    status: 'unavailable',
    code: 'PPT_RENDERER_UNAVAILABLE',
    message: '배포용 PPT 생성 엔진 선택이 필요합니다.',
  })
  mocks.renderIssueAnalysisPpt.mockResolvedValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
})

describe('GET /api/issue-analysis', () => {
  it('필수 식별자가 없으면 가드 전에 400으로 거부한다', async () => {
    const response = await GET(request())
    expect(response.status).toBe(400)
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
  })

  it('프로젝트 멤버가 아니면 저장 실행과 렌더러에 접근하지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(403)
    expect(mocks.loadSavedIssueAnalysisRun).not.toHaveBeenCalled()
    expect(mocks.renderIssueAnalysisPpt).not.toHaveBeenCalled()
  })

  it('배포 렌더러 미연결 상태를 no-store JSON 503으로 명시한다', async () => {
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      code: 'PPT_RENDERER_UNAVAILABLE',
    })
    expect(mocks.loadSavedIssueAnalysisRun).not.toHaveBeenCalled()
  })

  it('렌더러가 준비되면 저장 실행으로 deck plan을 만들고 PPTX를 다운로드한다', async () => {
    mocks.getDiagnostic.mockReturnValue({
      status: 'ready',
      code: 'PPT_EXPORT_READY',
      message: '다운로드 가능',
    })
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('presentationml.presentation')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-disposition')).toContain('D-Cube_%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8')
    expect(mocks.loadSavedIssueAnalysisRun).toHaveBeenCalledWith('project-1', 'run-1')
    expect(mocks.renderIssueAnalysisPpt).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      issueCount: 1,
      slides: expect.arrayContaining([
        expect.objectContaining({ sourceSlide: 8 }),
        expect.objectContaining({ sourceSlide: 12 }),
      ]),
    }))
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    )
  })
})
