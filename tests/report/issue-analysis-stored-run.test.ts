import { describe, expect, it } from 'vitest'
import type { IssueAnalysisIssueInput } from '@/lib/report/issues/model'
import {
  buildIssueAnalysisInputSnapshot,
  buildIssueAnalysisReport,
} from '@/lib/report/issues/model'
import { parseStoredIssueAnalysisReport } from '@/lib/report/issues/storedRun'

function issue(): IssueAnalysisIssueInput {
  return {
    id: 'issue-uuid-1',
    issueNo: 1,
    projectId: 'project-1',
    title: '기준정보 중복',
    body: '동일 자재가 여러 코드로 관리된다.',
    status: 'open',
    severity: 'high',
    assigneeMemberIds: ['member-1'],
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

function validStoredReport() {
  const snapshot = buildIssueAnalysisInputSnapshot('project-1', [issue()])
  return buildIssueAnalysisReport(snapshot, {
    '00': [{
      title: '기준정보 단일화',
      description: '중복 등록을 통제한다.',
      issueIds: ['issue-uuid-1'],
    }],
  }, '2026-07-31T00:00:00Z')
}

describe('parseStoredIssueAnalysisReport', () => {
  it('현재 v1 저장 실행을 검증하고 새 객체로 복원한다', () => {
    const source = validStoredReport()
    const parsed = parseStoredIssueAnalysisReport(
      JSON.parse(JSON.stringify(source)),
      'project-1',
    )
    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
  })

  it('프로젝트·PI ID·요약 정합성이 어긋나면 거부한다', () => {
    expect(parseStoredIssueAnalysisReport(validStoredReport(), 'other-project')).toBeNull()

    const badCode = validStoredReport()
    badCode.areas[0].issues[0].piIssueCode = 'PI-I-00-99'
    expect(parseStoredIssueAnalysisReport(badCode, 'project-1')).toBeNull()

    const badSummary = validStoredReport()
    badSummary.areas[0].summary.totalCount = 2
    expect(parseStoredIssueAnalysisReport(badSummary, 'project-1')).toBeNull()
  })

  it('영역 밖 참조와 개선기회 미연결 이슈를 거부한다', () => {
    const foreign = validStoredReport()
    foreign.areas[0].opportunities[0].issueIds = ['foreign-uuid']
    expect(parseStoredIssueAnalysisReport(foreign, 'project-1')).toBeNull()

    const uncovered = validStoredReport()
    uncovered.areas[0].opportunities = []
    expect(parseStoredIssueAnalysisReport(uncovered, 'project-1')).toBeNull()
  })
})
