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

function storedReportWithCauses(): ReturnType<typeof validStoredReport> & {
  areas: Array<ReturnType<typeof validStoredReport>['areas'][number] & {
    causeAnalyses?: Array<{
      issueId: string
      causes: Array<{
        category: string
        directCause: string
        rootCause: string | null
      }>
    }>
  }>
} {
  const source = validStoredReport()
  return {
    ...source,
    areas: source.areas.map((area, index) => ({
      ...area,
      ...(index === 0
        ? {
            causeAnalyses: [{
              issueId: 'issue-uuid-1',
              causes: [{
                category: 'process',
                directCause: '자재 등록 전에 중복 여부를 확인하는 표준 절차가 없다.',
                rootCause: '기준정보 등록 정책의 관리 책임과 정기 검토 체계가 정의되지 않았다.',
              }],
            }],
          }
        : { causeAnalyses: [] }),
    })),
  }
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

  it('저장된 이슈별 직접·근본 원인을 검증하고 새 객체로 복원한다', () => {
    const source = storedReportWithCauses()
    const parsed = parseStoredIssueAnalysisReport(
      JSON.parse(JSON.stringify(source)),
      'project-1',
    )

    expect(parsed?.areas[0]).toMatchObject({
      causeAnalyses: [{
        issueId: 'issue-uuid-1',
        causes: [{
          category: 'process',
          directCause: '자재 등록 전에 중복 여부를 확인하는 표준 절차가 없다.',
          rootCause: '기준정보 등록 정책의 관리 책임과 정기 검토 체계가 정의되지 않았다.',
        }],
      }],
    })
    expect(parsed?.areas[0].causeAnalyses).not.toBe(source.areas[0].causeAnalyses)
    expect(parsed?.areas[0].causeAnalyses?.[0].causes).not.toBe(
      source.areas[0].causeAnalyses?.[0].causes,
    )
  })

  it('원인분석의 영역 밖·중복 이슈 참조와 허용되지 않은 Category를 거부한다', () => {
    const foreign = storedReportWithCauses()
    foreign.areas[0].causeAnalyses![0].issueId = 'foreign-uuid'
    expect(parseStoredIssueAnalysisReport(foreign, 'project-1')).toBeNull()

    const duplicate = storedReportWithCauses()
    duplicate.areas[0].causeAnalyses!.push(
      JSON.parse(JSON.stringify(duplicate.areas[0].causeAnalyses![0])),
    )
    expect(parseStoredIssueAnalysisReport(duplicate, 'project-1')).toBeNull()

    const invalidCategory = storedReportWithCauses()
    ;(invalidCategory.areas[0].causeAnalyses![0].causes[0] as { category: string }).category = 'unknown'
    expect(parseStoredIssueAnalysisReport(invalidCategory, 'project-1')).toBeNull()
  })

  it('원인 항목의 빈 직접 원인과 잘못된 근본 원인 타입을 거부한다', () => {
    const blankDirect = storedReportWithCauses()
    blankDirect.areas[0].causeAnalyses![0].causes[0].directCause = '   '
    expect(parseStoredIssueAnalysisReport(blankDirect, 'project-1')).toBeNull()

    const invalidRoot = storedReportWithCauses()
    ;(invalidRoot.areas[0].causeAnalyses![0].causes[0] as { rootCause: unknown }).rootCause = 123
    expect(parseStoredIssueAnalysisReport(invalidRoot, 'project-1')).toBeNull()
  })

  it('저장 원인의 Category 중복·항목 수·문구 길이 상한을 강제한다', () => {
    const duplicateCategory = storedReportWithCauses()
    duplicateCategory.areas[0].causeAnalyses![0].causes.push({
      category: 'process',
      directCause: '두 번째 프로세스 직접 원인',
      rootCause: null,
    })
    expect(parseStoredIssueAnalysisReport(duplicateCategory, 'project-1')).toBeNull()

    const tooMany = storedReportWithCauses()
    const categories = ['strategy_policy', 'process', 'organization', 'it', 'process'] as const
    tooMany.areas[0].causeAnalyses![0].causes = Array.from({ length: 5 }, (_, index) => ({
      category: categories[index],
      directCause: `직접 원인 ${index + 1}`,
      rootCause: null,
    }))
    expect(parseStoredIssueAnalysisReport(tooMany, 'project-1')).toBeNull()

    const longDirect = storedReportWithCauses()
    longDirect.areas[0].causeAnalyses![0].causes[0].directCause = '가'.repeat(401)
    expect(parseStoredIssueAnalysisReport(longDirect, 'project-1')).toBeNull()

    const longRoot = storedReportWithCauses()
    longRoot.areas[0].causeAnalyses![0].causes[0].rootCause = '가'.repeat(801)
    expect(parseStoredIssueAnalysisReport(longRoot, 'project-1')).toBeNull()
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
