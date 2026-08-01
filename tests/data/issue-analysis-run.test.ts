import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueAnalysisIssueInput } from '@/lib/report/issues/model'
import {
  buildIssueAnalysisInputSnapshot,
  buildIssueAnalysisReport,
} from '@/lib/report/issues/model'

type Result = {
  data: Record<string, unknown> | null
  error: { message: string } | null
}

const state = vi.hoisted(() => ({
  results: {} as Record<string, Result>,
}))

function singleQuery(table: string) {
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.maybeSingle = vi.fn(async () => state.results[table])
  return query
}

const createServerClient = vi.hoisted(() => vi.fn(async () => ({
  from: (table: string) => singleQuery(table),
})))

vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { loadSavedIssueAnalysisRun } from '@/lib/data/issueAnalysis'

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
    majorId: 'major-1',
    majorSeq: 1,
    majorName: '기준정보 표준화',
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
  createServerClient.mockClear()
  state.results = {
    issue_analysis_runs: {
      data: {
        id: 'run-1',
        project_id: 'project-1',
        status: 'ready',
        analysis_json: report(),
      },
      error: null,
    },
    projects: {
      data: { id: 'project-1', name: 'D-Cube 프로젝트' },
      error: null,
    },
  }
})
describe('loadSavedIssueAnalysisRun', () => {
  it('RLS 조회한 저장 실행과 프로젝트명을 엄격 검증해 반환한다', async () => {
    const result = await loadSavedIssueAnalysisRun('project-1', 'run-1')
    expect(result).toMatchObject({
      runId: 'run-1',
      projectId: 'project-1',
      projectName: 'D-Cube 프로젝트',
      report: {
        schemaVersion: 'issue-analysis.v1',
        issueCount: 1,
      },
    })
  })

  it('행이 없거나 ready가 아니면 다운로드 대상을 반환하지 않는다', async () => {
    state.results.issue_analysis_runs.data = null
    await expect(loadSavedIssueAnalysisRun('project-1', 'run-1')).resolves.toBeNull()

    state.results.issue_analysis_runs.data = {
      id: 'run-1',
      project_id: 'project-1',
      status: 'failed',
      analysis_json: report(),
    }
    await expect(loadSavedIssueAnalysisRun('project-1', 'run-1')).resolves.toBeNull()
  })

  it('조회 실패 또는 손상된 저장 JSON은 명시적으로 실패한다', async () => {
    state.results.issue_analysis_runs.error = { message: 'database unavailable' }
    await expect(loadSavedIssueAnalysisRun('project-1', 'run-1')).rejects.toThrow('저장 실행 조회 실패')

    state.results.issue_analysis_runs.error = null
    state.results.issue_analysis_runs.data = {
      id: 'run-1',
      project_id: 'project-1',
      status: 'ready',
      analysis_json: { schemaVersion: 'issue-analysis.v0' },
    }
    await expect(loadSavedIssueAnalysisRun('project-1', 'run-1')).rejects.toThrow('정합성')
  })
})
