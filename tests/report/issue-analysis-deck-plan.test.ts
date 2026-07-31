import { describe, expect, it } from 'vitest'
import type {
  IssueAnalysisReport,
  IssueAnalysisReportArea,
  IssueAnalysisReportIssue,
} from '@/lib/report/issues/model'
import {
  boundedHeaderLines,
  boundedSourceLines,
  buildIssueAnalysisDeckPlan,
  issueSourceLines,
  truncateIssueAnalysisText,
} from '@/lib/report/issues/deckPlan'

function issue(index: number, megaCode = '02'): IssueAnalysisReportIssue {
  return {
    id: `issue-${index}`,
    issueNo: index,
    piIssueCode: `PI-I-${megaCode}-${String(index).padStart(2, '0')}`,
    megaCode: megaCode as IssueAnalysisReportIssue['megaCode'],
    megaSeq: index,
    title: `이슈 ${index}`,
    body: `이슈 ${index} 상세 내용`,
    status: 'open',
    severity: 'medium',
    subProcess: `Sub ${index}`,
    ownerDepartment: index % 2 ? '영업팀' : 'PI팀',
    relatedSystems: index % 2 ? ['ERP'] : ['MES'],
    assigneeMemberIds: [],
    source: {
      manual: { type: 'interview', detail: '현업 인터뷰; 기존 자료' },
      minutes: index === 1
        ? [{
            id: 'link-1',
            minuteId: 'minute-1',
            minuteVersionId: 'version-1',
            minuteVersionNo: 1,
            minuteTitle: 'PI 주간회의',
            minuteDate: '2026-07-30',
            excerpt: '이슈 확인',
            kind: 'manual',
          }]
        : [],
    },
  }
}

function area(count: number, megaCode = '02'): IssueAnalysisReportArea {
  const issues = Array.from({ length: count }, (_, index) => issue(index + 1, megaCode))
  return {
    megaCode: megaCode as IssueAnalysisReportArea['megaCode'],
    megaName: megaCode === '02' ? '영업' : '기준관리',
    megaNameEn: megaCode === '02' ? 'Sales' : 'Master Data',
    summary: {
      totalCount: count,
      statusCounts: { open: count, in_progress: 0, resolved: 0, on_hold: 0 },
      severityCounts: { high: 0, medium: count, low: 0 },
      ownerDepartments: ['PI팀', '영업팀'],
      relatedSystems: ['ERP', 'MES'],
    },
    issues,
    opportunities: count
      ? [{
          title: `${megaCode} 개선기회`,
          description: '업무를 표준화한다.',
          issueIds: issues.slice(0, 5).map(item => item.id),
        }]
      : [],
  }
}

function report(areas: IssueAnalysisReportArea[]): IssueAnalysisReport {
  return {
    schemaVersion: 'issue-analysis.v1',
    projectId: 'project-1',
    issueCount: areas.reduce((sum, item) => sum + item.issues.length, 0),
    generatedAt: '2026-07-31T00:00:00Z',
    areas,
  }
}

describe('buildIssueAnalysisDeckPlan', () => {
  it('고정 페이지를 유지하고 8건을 3+5 이슈 페이지로 나눈다', () => {
    const plan = buildIssueAnalysisDeckPlan(report([area(8)]), {
      projectName: 'D-Cube',
      authorName: '홍길동',
      authorTeam: 'PI팀',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    expect(plan.slides.map(slide => slide.sourceSlide)).toEqual([
      1, 2, 3, 4, 8, 9, 11, 12,
    ])
    expect(plan.slides[4]).toMatchObject({
      kind: 'area-summary',
      issues: [{ piIssueCode: 'PI-I-02-01' }, {}, {}],
    })
    expect(plan.slides[5]).toMatchObject({
      kind: 'area-summary-continuation',
      pageInArea: 2,
    })
    if (plan.slides[5].kind === 'area-summary-continuation') {
      expect(plan.slides[5].issues).toHaveLength(5)
    }
    expect(plan.slides[0]).toMatchObject({
      kind: 'cover',
      projectName: 'D-Cube',
      authorLine: 'PI팀 홍길동',
      dateLabel: '26.07.31',
    })
    expect(plan.meta).toEqual({
      projectName: 'D-Cube',
      authorName: '홍길동',
      authorTeam: 'PI팀',
      authorLine: 'PI팀 홍길동',
      dateLabel: '26.07.31',
    })
  })

  it('9건 이상은 9페이지 형식을 5건 단위로 반복한다', () => {
    const sales = area(9)
    sales.opportunities = [{
      title: '전체 개선',
      description: '표준화',
      issueIds: sales.issues.slice(0, 5).map(item => item.id),
    }]
    const plan = buildIssueAnalysisDeckPlan(report([sales]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    const issueSlides = plan.slides.filter(slide =>
      slide.kind === 'area-summary' || slide.kind === 'area-summary-continuation')
    expect(issueSlides.map(slide => slide.issues.length)).toEqual([3, 5, 1])
    expect(issueSlides.map(slide => slide.sourceSlide)).toEqual([8, 9, 9])
  })

  it('Mega 순서와 DB 이슈-ID 매핑을 유지한다', () => {
    const master = area(1, '00')
    const sales = area(1, '02')
    const plan = buildIssueAnalysisDeckPlan(report([master, sales]), {
      projectName: 'D-Cube',
      authorName: '작성자',
      authorTeam: 'TF',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    const opportunities = plan.slides.filter(slide => slide.kind === 'opportunity')
    expect(opportunities.map(slide => slide.megaCode)).toEqual(['00', '02'])
    expect(opportunities[1]).toMatchObject({
      issues: [{ id: 'issue-1', piIssueCode: 'PI-I-02-01', title: '이슈 1' }],
    })
  })

  it('영역 밖 이슈와 5건 초과 연결을 방어한다', () => {
    const invalid = area(1)
    invalid.opportunities[0].issueIds = ['other-area']
    expect(() => buildIssueAnalysisDeckPlan(report([invalid]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })).toThrow('영역 밖 이슈')

    const tooMany = area(6)
    tooMany.opportunities[0].issueIds = tooMany.issues.map(item => item.id)
    expect(() => buildIssueAnalysisDeckPlan(report([tooMany]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })).toThrow('1~5건')
  })
})

describe('PPT 표시 정규화', () => {
  it('복수 원천을 중복 제거된 여러 줄로 만든다', () => {
    expect(issueSourceLines(issue(1))).toEqual([
      '현업 인터뷰',
      '기존 자료',
      '회의록 · 2026-07-30 PI 주간회의',
    ])
  })

  it('헤더 용량을 넘으면 생략 수를 명시한다', () => {
    expect(boundedHeaderLines(['A', 'B', 'C', 'D'], 3)).toEqual([
      'A', 'B', '외 2개',
    ])
    expect(boundedHeaderLines(['A', 'A', 'B'], 3)).toEqual(['A', 'B'])
  })

  it('고정 템플릿 셀을 넘는 본문과 복수 원천을 명시적 말줄임으로 제한한다', () => {
    expect(truncateIssueAnalysisText('가'.repeat(100), 10)).toBe(`${'가'.repeat(9)}…`)
    expect(boundedSourceLines([
      '현업 인터뷰',
      '기존 산출물',
      '회의록 · 2026-07-30 PI 주간회의',
      '데이터 분석',
    ])).toEqual([
      '현업 인터뷰',
      '외 3개 원천',
    ])
  })
})
