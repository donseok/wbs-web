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

const MAJOR_A = {
  id: 'major-uuid-1',
  megaCode: '00' as const,
  majorSeq: 1,
  name: '품목기준정보',
}
const MAJOR_B = {
  id: 'major-uuid-2',
  megaCode: '00' as const,
  majorSeq: 2,
  name: '거래처기준정보',
}

function storedReportWithProcess() {
  const snapshot = buildIssueAnalysisInputSnapshot(
    'project-1',
    [{ ...issue(), majorId: MAJOR_A.id }],
    [MAJOR_A, MAJOR_B],
  )
  return buildIssueAnalysisReport(snapshot, {
    '00': [{
      title: '기준정보 단일화',
      description: '중복 등록을 통제한다.',
      issueIds: ['issue-uuid-1'],
    }],
  }, '2026-07-31T00:00:00Z', {}, {
    '00': {
      megaDefinition: '기준정보 전반을 관리하는 프로세스임',
      majors: [
        { majorId: MAJOR_A.id, definition: '품목 기준정보를 관리하는 프로세스' },
        { majorId: MAJOR_B.id, definition: '거래처 기준정보를 관리하는 프로세스' },
      ],
    },
  })
}

describe('Major·프로세스 정의 하위호환 파싱', () => {
  it('구버전(majors·majorId·processDefinitions 없음) 저장본은 그대로 통과한다', () => {
    const legacy = JSON.parse(JSON.stringify(validStoredReport())) as {
      areas: Array<Record<string, unknown> & { issues: Array<Record<string, unknown>> }>
    }
    for (const area of legacy.areas) {
      delete area.majors
      for (const item of area.issues) delete item.majorId
    }
    const parsed = parseStoredIssueAnalysisReport(legacy, 'project-1')
    expect(parsed).not.toBeNull()
    expect(Object.prototype.hasOwnProperty.call(parsed!.areas[0], 'majors')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(parsed!.areas[0], 'processDefinitions'))
      .toBe(false)
    expect(parsed!.areas[0].issues[0].majorId).toBeNull()
  })

  it('신버전 저장본은 majors·majorId·processDefinitions를 왕복 보존한다', () => {
    const source = storedReportWithProcess()
    const parsed = parseStoredIssueAnalysisReport(
      JSON.parse(JSON.stringify(source)),
      'project-1',
    )
    expect(parsed).toEqual(source)
    expect(parsed?.areas[0].processDefinitions).not.toBe(source.areas[0].processDefinitions)
  })

  it('majorId가 majors 목록에 없으면 거부한다', () => {
    const orphan = storedReportWithProcess()
    orphan.areas[0].majors = [MAJOR_B].map(major => ({
      id: major.id, majorSeq: 1, name: major.name,
    }))
    orphan.areas[0].processDefinitions!.majors =
      [orphan.areas[0].processDefinitions!.majors[1]]
    expect(parseStoredIssueAnalysisReport(orphan, 'project-1')).toBeNull()
  })

  it('majors 없이 processDefinitions만 있으면 거부한다', () => {
    const dangling = JSON.parse(JSON.stringify(storedReportWithProcess())) as {
      areas: Array<Record<string, unknown> & { issues: Array<Record<string, unknown>> }>
    }
    for (const area of dangling.areas) {
      delete area.majors
      for (const item of area.issues) delete item.majorId
    }
    expect(parseStoredIssueAnalysisReport(dangling, 'project-1')).toBeNull()
  })

  it('정의가 Major와 1:1이 아니면 거부한다', () => {
    const missing = storedReportWithProcess()
    missing.areas[0].processDefinitions!.majors.pop()
    expect(parseStoredIssueAnalysisReport(missing, 'project-1')).toBeNull()

    const duplicated = storedReportWithProcess()
    duplicated.areas[0].processDefinitions!.majors = [
      duplicated.areas[0].processDefinitions!.majors[0],
      duplicated.areas[0].processDefinitions!.majors[0],
    ]
    expect(parseStoredIssueAnalysisReport(duplicated, 'project-1')).toBeNull()
  })

  it('majorSeq가 강증가가 아니면 거부한다', () => {
    const unsorted = storedReportWithProcess()
    unsorted.areas[0].majors = [
      { id: MAJOR_B.id, majorSeq: 2, name: MAJOR_B.name },
      { id: MAJOR_A.id, majorSeq: 1, name: MAJOR_A.name },
    ]
    expect(parseStoredIssueAnalysisReport(unsorted, 'project-1')).toBeNull()
  })

  it('정의 길이 상한을 강제한다', () => {
    const longMega = storedReportWithProcess()
    longMega.areas[0].processDefinitions!.megaDefinition = '가'.repeat(201)
    expect(parseStoredIssueAnalysisReport(longMega, 'project-1')).toBeNull()

    const longMajor = storedReportWithProcess()
    longMajor.areas[0].processDefinitions!.majors[0].definition = '가'.repeat(151)
    expect(parseStoredIssueAnalysisReport(longMajor, 'project-1')).toBeNull()
  })
})
