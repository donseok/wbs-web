import { describe, expect, it } from 'vitest'
import {
  ISSUE_ANALYSIS_UNCLASSIFIED_MAJOR_LABEL,
  buildIssueAnalysisProcessSlides,
  type IssueAnalysisDeckProcessTreeSlide,
} from '@/lib/report/issues/processPages'
import { buildIssueAnalysisDeckPlan } from '@/lib/report/issues/deckPlan'
import type {
  IssueAnalysisReport,
  IssueAnalysisReportArea,
  IssueAnalysisReportIssue,
} from '@/lib/report/issues/model'

const majorId = (n: number) => `aaaa0000-0000-4000-8000-${String(n).padStart(12, '0')}`

function issueFixture(over: {
  megaSeq: number
  majorId: string | null
  subProcess: string
}): IssueAnalysisReportIssue {
  return {
    id: `issue-${over.megaSeq}`,
    issueNo: over.megaSeq,
    piIssueCode: `PI-I-02-${String(over.megaSeq).padStart(2, '0')}`,
    megaCode: '02',
    megaSeq: over.megaSeq,
    majorId: over.majorId,
    title: `이슈 ${over.megaSeq}`,
    body: `이슈 ${over.megaSeq} 상세 내용`,
    status: 'open',
    severity: 'medium',
    subProcess: over.subProcess,
    ownerDepartment: '영업팀',
    relatedSystems: ['ERP'],
    assigneeMemberIds: [],
    source: {
      manual: { type: 'interview', detail: '현업 인터뷰' },
      minutes: [],
    },
  }
}

function summaryFixture(issues: IssueAnalysisReportIssue[]) {
  return {
    totalCount: issues.length,
    statusCounts: {
      open: issues.length, in_progress: 0, resolved: 0, on_hold: 0,
    },
    severityCounts: { high: 0, medium: issues.length, low: 0 },
    ownerDepartments: ['영업팀'],
    relatedSystems: ['ERP'],
  }
}

function areaFixture(overrides: {
  majorCount?: number
  subsPerMajor?: number
  unclassifiedSubs?: number
  withDefinitions?: boolean
} = {}): IssueAnalysisReportArea {
  const {
    majorCount = 2, subsPerMajor = 2, unclassifiedSubs = 0, withDefinitions = true,
  } = overrides
  const majors = Array.from({ length: majorCount }, (_, index) => ({
    id: majorId(index + 1), majorSeq: index + 1, name: `프로세스${index + 1}`,
  }))
  let seq = 0
  const issues = [
    ...majors.flatMap(major =>
      Array.from({ length: subsPerMajor }, (_, subIndex) => {
        seq += 1
        return issueFixture({
          megaSeq: seq,
          majorId: major.id,
          subProcess: `${major.name}-업무${subIndex + 1}`,
        })
      })),
    ...Array.from({ length: unclassifiedSubs }, (_, subIndex) => {
      seq += 1
      return issueFixture({
        megaSeq: seq,
        majorId: null,
        subProcess: `미지정업무${subIndex + 1}`,
      })
    }),
  ]
  return {
    megaCode: '02',
    megaName: '영업',
    megaNameEn: 'Sales',
    majors,
    summary: summaryFixture(issues),
    issues,
    opportunities: issues.length
      ? [{
          title: '영업 개선기회',
          description: '업무를 표준화한다.',
          issueIds: issues.slice(0, 5).map(item => item.id),
        }]
      : [],
    ...(withDefinitions
      ? {
          processDefinitions: {
            megaDefinition: '고객 주문 이행 전반을 관리하는 프로세스임',
            majors: majors.map(major => ({
              majorId: major.id,
              definition: `${major.name}를 관리하는 프로세스`,
            })),
          },
        }
      : {}),
  }
}

function reportFixture(area: IssueAnalysisReportArea): IssueAnalysisReport {
  return {
    schemaVersion: 'issue-analysis.v1',
    projectId: 'project-1',
    issueCount: area.issues.length,
    generatedAt: '2026-08-02T00:00:00Z',
    areas: [area],
  }
}

function treeSlides(
  slides: ReturnType<typeof buildIssueAnalysisProcessSlides>,
): IssueAnalysisDeckProcessTreeSlide[] {
  return slides.filter(
    (slide): slide is IssueAnalysisDeckProcessTreeSlide => slide.kind === 'process-tree',
  )
}

describe('buildIssueAnalysisProcessSlides', () => {
  it('processDefinitions 없는 구버전 영역은 빈 배열(기존 덱 무변경)', () => {
    expect(buildIssueAnalysisProcessSlides(areaFixture({ withDefinitions: false })))
      .toEqual([])
  })

  it('기본형: 트리 1페이지 + 정의 1페이지, 배치·헤드라인·seqLabel', () => {
    const slides = buildIssueAnalysisProcessSlides(areaFixture())
    expect(slides.map(slide => slide.kind)).toEqual(['process-tree', 'process-definition'])
    const tree = slides[0]
    if (tree.kind !== 'process-tree') throw new Error('unexpected kind')
    expect(tree.sourceSlide).toBe(5)
    expect(tree.columns.map(column => column.label)).toEqual(['프로세스1', '프로세스2'])
    expect(tree.columns[0].subs).toEqual(['프로세스1-업무1', '프로세스1-업무2'])
    expect(tree.headline).toBe(
      '현행 영업 프로세스는 프로세스1,프로세스2 2개의 Major 프로세스와 4개의 Sub 프로세스로 구성됨',
    )
    const definition = slides[1]
    if (definition.kind !== 'process-definition') throw new Error('unexpected kind')
    expect(definition.sourceSlide).toBe(6)
    expect(definition.rows[0]).toEqual({
      seqLabel: '02.01', name: '프로세스1', definition: '프로세스1를 관리하는 프로세스',
    })
    expect(definition.headline).toBe(tree.headline)
    expect(definition.megaDefinition).toContain('주문 이행')
  })

  it('Major 4개 초과는 등 …N개 헤드라인과 정의 페이지 분할', () => {
    const slides = buildIssueAnalysisProcessSlides(
      areaFixture({ majorCount: 5, subsPerMajor: 1 }),
    )
    const definitions = slides.filter(slide => slide.kind === 'process-definition')
    expect(definitions.map(slide =>
      slide.kind === 'process-definition' ? slide.rows.length : -1)).toEqual([4, 1])
    expect(definitions[0]).toMatchObject({ pageInSeries: 1, pageCount: 2 })
    expect(definitions[1]).toMatchObject({ pageInSeries: 2, pageCount: 2 })
    expect(slides[0].headline).toContain('프로세스1,프로세스2,프로세스3 등 5개의 Major')
  })

  it('열 8개 초과는 트리 페이지 분할, Sub 7개는 (계속) 열', () => {
    const single = treeSlides(buildIssueAnalysisProcessSlides(
      areaFixture({ majorCount: 8, subsPerMajor: 1 }),
    ))
    expect(single).toHaveLength(1)
    expect(single[0].columns).toHaveLength(8)

    const overflow = treeSlides(buildIssueAnalysisProcessSlides(
      areaFixture({ majorCount: 9, subsPerMajor: 1 }),
    ))
    expect(overflow.map(tree => tree.columns.length)).toEqual([8, 1])
    expect(overflow[0]).toMatchObject({ pageInSeries: 1, pageCount: 2 })
    expect(overflow[1]).toMatchObject({ pageInSeries: 2, pageCount: 2 })

    const contin = treeSlides(buildIssueAnalysisProcessSlides(
      areaFixture({ majorCount: 1, subsPerMajor: 7 }),
    ))[0]
    expect(contin.columns.map(column =>
      [column.label, column.subs.length, column.continuation]))
      .toEqual([['프로세스1', 6, false], ['프로세스1(계속)', 1, true]])
  })

  it('미지정 이슈는 마지막 (미지정) 열, 정의 페이지 제외, 헤드라인 카운트 규칙', () => {
    const slides = buildIssueAnalysisProcessSlides(
      areaFixture({ majorCount: 1, subsPerMajor: 1, unclassifiedSubs: 2 }),
    )
    const tree = treeSlides(slides)[0]
    expect(tree.columns.at(-1)?.label).toBe(ISSUE_ANALYSIS_UNCLASSIFIED_MAJOR_LABEL)
    expect(tree.columns.at(-1)?.subs).toEqual(['미지정업무1', '미지정업무2'])
    expect(tree.headline).toContain('1개의 Major 프로세스와 3개의 Sub 프로세스')
    const definitions = slides.filter(slide => slide.kind === 'process-definition')
    expect(definitions).toHaveLength(1)
    expect(definitions[0].kind === 'process-definition' && definitions[0].rows)
      .toHaveLength(1)
  })

  it('Major 0 + 전부 미지정이면 트리만 나오고 정의 페이지가 없다', () => {
    const slides = buildIssueAnalysisProcessSlides(
      areaFixture({ majorCount: 0, subsPerMajor: 0, unclassifiedSubs: 2 }),
    )
    expect(slides.every(slide => slide.kind === 'process-tree')).toBe(true)
    expect(slides[0].headline).toBe(
      '현행 영업 프로세스는 Major 미지정 2개의 Sub 프로세스로 구성됨',
    )
  })

  it('Sub 0개 Major도 빈 열 1개를 차지한다', () => {
    const tree = treeSlides(buildIssueAnalysisProcessSlides(
      areaFixture({ majorCount: 2, subsPerMajor: 0, unclassifiedSubs: 1 }),
    ))[0]
    expect(tree.columns.map(column => [column.label, column.subs.length]))
      .toEqual([['프로세스1', 0], ['프로세스2', 0], ['(미지정)', 1]])
  })

  it('같은 구분은 Major 안에서 한 번만 표시한다', () => {
    const duplicated = areaFixture({ majorCount: 1, subsPerMajor: 1 })
    duplicated.issues.push(issueFixture({
      megaSeq: 9,
      majorId: majorId(1),
      subProcess: '프로세스1-업무1',
    }))
    const tree = treeSlides(buildIssueAnalysisProcessSlides(duplicated))[0]
    expect(tree.columns[0].subs).toEqual(['프로세스1-업무1'])
  })

  it('정합 파손은 throw — 정의 누락 Major, 목록 밖 majorId', () => {
    const missingDefinition = areaFixture()
    missingDefinition.processDefinitions?.majors.pop()
    expect(() => buildIssueAnalysisProcessSlides(missingDefinition)).toThrow('정의')

    const orphan = areaFixture()
    orphan.issues[0] = { ...orphan.issues[0], majorId: majorId(99) }
    expect(() => buildIssueAnalysisProcessSlides(orphan)).toThrow('Major')
  })
})

describe('buildIssueAnalysisDeckPlan 통합', () => {
  const meta = {
    projectName: 'D-Cube',
    authorName: '홍길동',
    authorTeam: 'PI팀',
    generatedAt: '2026-08-02T00:00:00Z',
  }

  it('영역 순서가 트리→정의→이슈 종합이다', () => {
    const plan = buildIssueAnalysisDeckPlan(reportFixture(areaFixture()), meta)
    const kinds = plan.slides.map(slide => slide.kind)
    const treeIndex = kinds.indexOf('process-tree')
    expect(treeIndex).toBeGreaterThan(0)
    expect(kinds[treeIndex + 1]).toBe('process-definition')
    expect(kinds[treeIndex + 2]).toBe('area-summary')
  })

  it('구버전 보고서는 기존 슬라이드 구성 그대로다', () => {
    const plan = buildIssueAnalysisDeckPlan(
      reportFixture(areaFixture({ withDefinitions: false })),
      meta,
    )
    expect(plan.slides.some(slide =>
      slide.kind === 'process-tree' || slide.kind === 'process-definition')).toBe(false)
    expect(plan.slides.map(slide => slide.sourceSlide)).toEqual([1, 2, 3, 4, 8, 9, 11, 12])
  })
})
