import { describe, expect, it } from 'vitest'
import type { IssueMinuteSource } from '@/lib/domain/issueMinuteSource'
import {
  buildIssueAnalysisInputSnapshot,
  buildIssueAnalysisPreflight,
  buildIssueAnalysisReport,
  type IssueAnalysisIssueInput,
} from '@/lib/report/issues/model'

const source = (issueId: string): IssueMinuteSource => ({
  id: `link-${issueId}`,
  issueId,
  projectId: 'project-1',
  minuteId: 'minute-1',
  minuteVersionId: 'version-1',
  minuteVersionNo: 1,
  minuteTitle: 'PI 주간회의',
  minuteDate: '2026-07-20',
  bodyHash: 'body-hash',
  blockIndex: 2,
  blockHash: 'block-hash',
  excerpt: '수기 기준정보가 중복 관리되고 있다.',
  kind: 'manual',
  sourceKey: null,
  createdAt: '2026-07-20T00:00:00Z',
})

const issue = (
  id: string,
  over: Partial<IssueAnalysisIssueInput> = {},
): IssueAnalysisIssueInput => ({
  id,
  issueNo: 1,
  piIssueCode: 'PI-I-00-01',
  projectId: 'project-1',
  megaCode: '00',
  megaSeq: 1,
  title: '기준정보 중복',
  body: '동일 자재가 여러 코드로 관리된다.',
  status: 'open',
  severity: 'high',
  assigneeMemberIds: ['member-b', 'member-a'],
  startDate: null,
  dueDate: null,
  subProcess: '자재 등록',
  ownerDepartment: '기준정보팀',
  relatedSystems: ['ERP'],
  sourceType: 'interview',
  sourceDetail: '기준정보팀 인터뷰',
  minuteSources: [],
  resolutionNote: '',
  resolvedAt: null,
  createdBy: 'user-1',
  createdByName: '테스터',
  createdAt: '2026-07-20T00:00:00Z',
  updatedAt: '2026-07-20T00:00:00Z',
  ...over,
})

describe('buildIssueAnalysisPreflight', () => {
  it('상태와 무관하게 모든 프로젝트 이슈를 Mega 정본 순서로 집계한다', () => {
    const issues = [
      issue('cost-1', {
        issueNo: 3,
        megaCode: '07',
        megaSeq: 1,
        piIssueCode: 'PI-I-07-01',
        status: 'resolved',
      }),
      issue('master-2', { issueNo: 2, megaSeq: 2, piIssueCode: 'PI-I-00-02' }),
      issue('master-1'),
    ]
    const result = buildIssueAnalysisPreflight(issues)
    expect(result).toMatchObject({ totalCount: 3, readyCount: 3, blockedCount: 0 })
    expect(result.areas.map(area => area.megaCode)).toEqual([
      '00', '01', '02', '03', '04', '05', '06', '07',
    ])
    expect(result.areas.find(area => area.megaCode === '00')).toMatchObject({
      megaName: '기준관리',
      count: 2,
      readyCount: 2,
      blockedCount: 0,
    })
    expect(result.areas.find(area => area.megaCode === '07')?.count).toBe(1)
  })

  it('필수 필드와 미분류 이슈를 상세 사유로 반환한다', () => {
    const legacy = issue('legacy', {
      megaCode: null,
      megaSeq: null,
      piIssueCode: null,
      body: ' ',
      subProcess: '',
      ownerDepartment: '',
      sourceType: null,
    })
    const result = buildIssueAnalysisPreflight([legacy])
    expect(result).toMatchObject({ totalCount: 1, readyCount: 0, blockedCount: 1 })
    expect(result.blockedIssues[0].missingFields).toEqual([
      'megaCode',
      'piIssueCode',
      'body',
      'subProcess',
      'ownerDepartment',
      'source',
    ])
    expect(result.unclassifiedIssues).toHaveLength(1)
    expect(result.blockedIssues[0].label).toContain('#1')
  })

  it('회의록 원천은 실제 불변 링크가 있어야 준비 완료다', () => {
    const missingLink = issue('minutes-missing', {
      sourceType: 'minutes',
      sourceDetail: '',
      minuteSources: [],
    })
    const linked = issue('minutes-linked', {
      issueNo: 2,
      megaSeq: 2,
      piIssueCode: 'PI-I-00-02',
      sourceType: 'minutes',
      minuteSources: [source('minutes-linked')],
    })
    const result = buildIssueAnalysisPreflight([missingLink, linked])
    expect(result).toMatchObject({ readyCount: 1, blockedCount: 1 })
    expect(result.blockedIssues[0].missingFields).toContain('source')
  })
})

describe('이슈 분석 입력/결과 모델', () => {
  it('Mega/PI 순서로 정렬하고 출처 스냅샷과 영역 요약을 함께 보존한다', () => {
    const snapshot = buildIssueAnalysisInputSnapshot('project-1', [
      issue('second', {
        issueNo: 2,
        megaSeq: 2,
        piIssueCode: 'PI-I-00-02',
        relatedSystems: ['MES', 'ERP', 'MES'],
      }),
      issue('first', {
        sourceType: 'minutes',
        sourceDetail: '',
        minuteSources: [source('first')],
      }),
    ])
    const area = snapshot.areas[0]
    expect(area.issues.map(item => item.id)).toEqual(['first', 'second'])
    expect(area.issues[0].source.minutes[0]).toMatchObject({
      minuteTitle: 'PI 주간회의',
      excerpt: '수기 기준정보가 중복 관리되고 있다.',
    })
    expect(area.issues[1].relatedSystems).toEqual(['ERP', 'MES'])
    expect(area.summary).toMatchObject({
      totalCount: 2,
      statusCounts: { open: 2, in_progress: 0, resolved: 0, on_hold: 0 },
      severityCounts: { high: 2, medium: 0, low: 0 },
    })
  })

  it('개선기회를 직렬화 가능한 area 결과에 결합한다', () => {
    const snapshot = buildIssueAnalysisInputSnapshot('project-1', [issue('i-1')])
    const report = buildIssueAnalysisReport(snapshot, {
      '00': [{
        title: '기준정보 단일화',
        description: '중복 등록을 통제한다.',
        issueIds: ['i-1'],
      }],
    }, '2026-07-31T00:00:00Z')
    expect(report).toMatchObject({
      schemaVersion: 'issue-analysis.v1',
      projectId: 'project-1',
      issueCount: 1,
      generatedAt: '2026-07-31T00:00:00Z',
    })
    expect(report.areas[0].opportunities[0].issueIds).toEqual(['i-1'])
    expect(report.areas[0]).not.toHaveProperty('causeAnalyses')
    expect(JSON.parse(JSON.stringify(report))).toEqual(report)
  })

  it('이슈별 직접·근본 원인을 UUID 기준으로 직렬화하고 입력 스냅샷과 분리한다', () => {
    const snapshot = buildIssueAnalysisInputSnapshot('project-1', [issue('i-1')])
    const causeAnalyses = {
      '00': [{
        issueId: 'i-1',
        causes: [
          {
            category: 'process' as const,
            directCause: '자재 등록 전에 중복 여부를 확인하는 표준 절차가 없다.',
            rootCause: '기준정보 정책의 관리 책임과 정기 검토 체계가 정의되지 않았다.',
          },
          {
            category: 'it' as const,
            directCause: 'ERP 등록 화면에 중복 후보를 자동으로 확인하는 기능이 없다.',
            rootCause: null,
          },
        ],
      }],
    }
    const report = buildIssueAnalysisReport(snapshot, {
      '00': [{
        title: '기준정보 단일화',
        description: '중복 등록을 통제한다.',
        issueIds: ['i-1'],
      }],
    }, '2026-07-31T00:00:00Z', causeAnalyses)

    expect(report.areas[0].causeAnalyses).toEqual(causeAnalyses['00'])
    expect(report.areas[0].causeAnalyses).not.toBe(causeAnalyses['00'])
    expect(report.areas[0].causeAnalyses?.[0].causes).not.toBe(causeAnalyses['00'][0].causes)
    expect(snapshot.areas[0]).not.toHaveProperty('causeAnalyses')
    expect(JSON.parse(JSON.stringify(report))).toEqual(report)
  })
})
