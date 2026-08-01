import { describe, expect, it } from 'vitest'
import type {
  IssueAnalysisReport,
  IssueAnalysisReportArea,
  IssueAnalysisReportIssue,
} from '@/lib/report/issues/model'
import {
  buildIssueAnalysisDeckPlan,
  estimateIssueAnalysisLineCount,
  fullHeaderLines,
  fullSourceLines,
  issueSourceLines,
  normalizeIssueAnalysisMultilineText,
  splitIssueAnalysisTextForRows,
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

type CauseAnalysisFixture = {
  issueId: string
  causes: Array<{
    category: 'strategy_policy' | 'process' | 'organization' | 'it'
    directCause: string
    rootCause: string | null
  }>
}

function withCauseAnalyses(
  target: IssueAnalysisReportArea,
  causeAnalyses: CauseAnalysisFixture[],
): IssueAnalysisReportArea & { causeAnalyses: CauseAnalysisFixture[] } {
  return Object.assign(target, { causeAnalyses })
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
    expect(opportunities).toHaveLength(1)
    expect(opportunities[0].blocks.map(block => block.megaCode)).toEqual(['00', '02'])
    expect(opportunities[0].blocks[1]).toMatchObject({
      opportunityNo: 2,
      issues: [{ id: 'issue-1', piIssueCode: 'PI-I-02-01', title: '이슈 1' }],
    })
  })

  it('저장된 이슈별 원인을 원본 10페이지에 자동 배치한다', () => {
    const sales = area(1)
    withCauseAnalyses(sales, [{
      issueId: sales.issues[0].id,
      causes: [{
        category: 'process',
        directCause: '주문 승인과 입력 절차가 채널별로 다르다.',
        rootCause: '표준 주문 접수 정책의 관리 책임이 정의되지 않았다.',
      }],
    }])

    const plan = buildIssueAnalysisDeckPlan(report([sales]), {
      projectName: 'D-Cube',
      authorName: '작성자',
      authorTeam: 'PI팀',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    const causeSlides = plan.slides.filter(slide => slide.kind === 'cause-analysis')

    expect(plan.slides.map(slide => slide.sourceSlide)).toEqual([
      1, 2, 3, 4, 8, 10, 11, 12,
    ])
    expect(causeSlides).toHaveLength(1)
    expect(causeSlides[0]).toMatchObject({
      sourceSlide: 10,
      megaCode: '02',
      megaName: '영업',
      issueId: sales.issues[0].id,
      piIssueCode: 'PI-I-02-01',
      pageInIssue: 1,
      pageCount: 1,
      issue: {
        title: '이슈 1',
        body: '이슈 1 상세 내용',
        subProcess: 'Sub 1',
      },
      causes: [{
        category: 'process',
        categoryLabel: 'P · 프로세스',
        analysis: [
          '[직접 원인]',
          '주문 승인과 입력 절차가 채널별로 다르다.',
          '[근본 원인]',
          '표준 주문 접수 정책의 관리 책임이 정의되지 않았다.',
        ].join('\n'),
      }],
    })
  })

  it('원인분석을 Mega와 PI 이슈 순서로 생성하고 이슈별 페이지 번호를 독립 관리한다', () => {
    const master = area(2, '00')
    const sales = area(1, '02')
    withCauseAnalyses(master, master.issues.map(item => ({
      issueId: item.id,
      causes: [{ category: 'strategy_policy', directCause: `${item.title} 직접 원인`, rootCause: null }],
    })))
    withCauseAnalyses(sales, [{
      issueId: sales.issues[0].id,
      causes: [{ category: 'it', directCause: '영업 IT 직접 원인', rootCause: null }],
    }])

    const plan = buildIssueAnalysisDeckPlan(report([master, sales]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    const causeSlides = plan.slides.filter(slide => slide.kind === 'cause-analysis')

    expect(causeSlides.map(slide => slide.megaCode)).toEqual(['00', '00', '02'])
    expect(causeSlides.map(slide => slide.piIssueCode)).toEqual([
      'PI-I-00-01', 'PI-I-00-02', 'PI-I-02-01',
    ])
    expect(causeSlides.map(slide => slide.pageInIssue)).toEqual([1, 1, 1])
    expect(plan.slides.findIndex(slide => slide.sourceSlide === 11))
      .toBeGreaterThan(plan.slides.map(slide => slide.sourceSlide).lastIndexOf(10))
  })

  it('원인분석의 중복·영역 밖 이슈와 지원하지 않는 Category를 방어한다', () => {
    const duplicate = area(1)
    const valid: CauseAnalysisFixture = {
      issueId: duplicate.issues[0].id,
      causes: [{ category: 'process', directCause: '직접 원인', rootCause: null }],
    }
    withCauseAnalyses(duplicate, [valid, { ...valid }])
    expect(() => buildIssueAnalysisDeckPlan(report([duplicate]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })).toThrow('중복 이슈')

    const foreign = area(1)
    withCauseAnalyses(foreign, [{ ...valid, issueId: 'other-area' }])
    expect(() => buildIssueAnalysisDeckPlan(report([foreign]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })).toThrow('영역 밖 이슈')

    const uncovered = area(2)
    withCauseAnalyses(uncovered, [{
      issueId: uncovered.issues[0].id,
      causes: [{ category: 'process', directCause: '직접 원인', rootCause: null }],
    }])
    expect(() => buildIssueAnalysisDeckPlan(report([uncovered]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })).toThrow('정확히 1건')

    const unsupported = area(1)
    withCauseAnalyses(unsupported, [{
      issueId: unsupported.issues[0].id,
      causes: [{
        category: 'unknown' as CauseAnalysisFixture['causes'][number]['category'],
        directCause: '직접 원인',
        rootCause: null,
      }],
    }])
    expect(() => buildIssueAnalysisDeckPlan(report([unsupported]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })).toThrow('지원하지 않는 원인 Category')
  })

  it('짧은 개선기회는 한 페이지에 묶고 높이가 찰 때만 2·3페이지를 만든다', () => {
    const sales = area(5)
    sales.opportunities = Array.from({ length: 11 }, (_, index) => ({
      title: `개선기회 ${index + 1}`,
      description: `개선 방향 ${index + 1}`,
      issueIds: [sales.issues[index % sales.issues.length].id],
    }))
    const plan = buildIssueAnalysisDeckPlan(report([sales]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    const opportunityPages = plan.slides.filter(slide => slide.kind === 'opportunity')

    expect(opportunityPages).toHaveLength(3)
    expect(opportunityPages.map(slide => slide.blocks.length)).toEqual([5, 5, 1])
    expect(opportunityPages.map(slide => slide.pageInSection)).toEqual([1, 2, 3])
    expect(opportunityPages.every(slide => slide.pageCount === 3)).toBe(true)
    expect(opportunityPages.flatMap(slide => slide.blocks).map(block => block.opportunityNo))
      .toEqual(Array.from({ length: 11 }, (_, index) => index + 1))
    expect(opportunityPages.every(slide =>
      slide.blocks.reduce((sum, block) => sum + block.rowUnits, 0) <= 10))
      .toBe(true)
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

  it('헤더와 원천은 중복만 제거하고 모든 값을 보존한다', () => {
    expect(fullHeaderLines(['A', 'B', 'C', 'D'])).toEqual(['A', 'B', 'C', 'D'])
    expect(fullHeaderLines(['A', 'A', 'B'])).toEqual(['A', 'B'])
    expect(fullSourceLines([
      '현업 인터뷰',
      '기존 산출물',
      '회의록 · 2026-07-30 PI 주간회의',
      '데이터 분석',
    ])).toEqual([
      '현업 인터뷰',
      '기존 산출물',
      '회의록 · 2026-07-30 PI 주간회의',
      '데이터 분석',
    ])
  })

  it('본문 구역과 개행을 보존하고 과도한 빈 줄만 정리한다', () => {
    expect(normalizeIssueAnalysisMultilineText(
      '[현황]\r\n- 기준 불일치  \r\n\r\n\r\n[문제/영향]\r\n- 확인 지연',
    )).toBe('[현황]\n- 기준 불일치\n\n[문제/영향]\n- 확인 지연')
  })

  it('긴 텍스트를 유니코드 손실이나 말줄임 없이 표시 행으로 나눈다', () => {
    const text = `저장위치·플랜트 기준 불일치 ${'가'.repeat(500)} 마지막 조치 문장.`
    const chunks = splitIssueAnalysisTextForRows(text, 12, 5)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(text)
    expect(chunks.every(chunk => estimateIssueAnalysisLineCount(chunk, 12) <= 5)).toBe(true)
    expect(chunks.join('')).not.toContain('…')
  })

  it('저장 상한인 20,000자 본문도 마지막 코드포인트까지 보존한다', () => {
    const text = `${'가'.repeat(19_990)}😀BODY-END`
    expect(text.length).toBe(20_000)
    const chunks = splitIssueAnalysisTextForRows(text, 34)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(text)
    expect(chunks.every(chunk => estimateIssueAnalysisLineCount(chunk, 34) <= 15)).toBe(true)
    expect(chunks.some(chunk => chunk.endsWith('\ud83d'))).toBe(false)
    expect(chunks.some(chunk => chunk.startsWith('\ude00'))).toBe(false)
  })

  it('장문 목록을 여러 행·슬라이드로 나눠도 marker는 첫 조각에만 표시한다', () => {
    const sales = area(1)
    const topText = `${'상위 항목의 배경과 영향을 충분히 설명합니다. '.repeat(80)}TOP-LIST-END`
    const childText = `${'하위 항목의 확인 조치와 책임을 충분히 설명합니다. '.repeat(80)}CHILD-LIST-END`
    const originalBody = [
      '[현황]',
      `- ${topText}`,
      `  - ${childText}`,
    ].join('\n')
    sales.issues[0] = { ...sales.issues[0], body: originalBody }
    sales.opportunities[0].issueIds = [sales.issues[0].id]

    const plan = buildIssueAnalysisDeckPlan(report([sales]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    const issueSlides = plan.slides.filter(slide =>
      slide.kind === 'area-summary' || slide.kind === 'area-summary-continuation')
    const rows = issueSlides.flatMap(slide => slide.issues)
    const paragraphs = rows
      .flatMap(row => row.bodyParagraphs)
      .filter(paragraph => !paragraph.heading && paragraph.text)
    const topStart = paragraphs.findIndex(paragraph => paragraph.marker === 'bullet')
    const childStart = paragraphs.findIndex(paragraph => paragraph.marker === 'check')

    expect(issueSlides.length).toBeGreaterThan(1)
    expect(rows.length).toBeGreaterThan(1)
    expect(topStart).toBeGreaterThanOrEqual(0)
    expect(childStart).toBeGreaterThan(topStart)
    expect(paragraphs.filter(paragraph => paragraph.marker === 'bullet')).toHaveLength(1)
    expect(paragraphs.filter(paragraph => paragraph.marker === 'check')).toHaveLength(1)

    const topFragments = paragraphs.slice(topStart, childStart)
    expect(topFragments.length).toBeGreaterThan(1)
    expect(topFragments[0]).toMatchObject({ level: 0, marker: 'bullet' })
    expect(topFragments.slice(1).every(paragraph =>
      paragraph.level === 0 && paragraph.marker === null)).toBe(true)
    expect(topFragments.map(paragraph => paragraph.text).join('')).toBe(topText)

    const childFragments = paragraphs.slice(childStart)
    expect(childFragments.length).toBeGreaterThan(1)
    expect(childFragments[0]).toMatchObject({ level: 1, marker: 'check' })
    expect(childFragments.slice(1).every(paragraph =>
      paragraph.level === 1 && paragraph.marker === null)).toBe(true)
    expect(childFragments.map(paragraph => paragraph.text).join('')).toBe(childText)
    expect(paragraphs.map(paragraph => paragraph.text).join('')).not.toContain('…')
  })

  it('페이지가 목록 marker 직후에 갈려도 다음 첫 내용 조각에 marker를 표시한다', () => {
    const sales = area(1)
    const prefixLines = Array.from(
      { length: 14 },
      (_, index) => `선행 문장 ${String(index + 1).padStart(2, '0')}의 업무 현황을 설명합니다.`,
    )
    const target = '나'.repeat(1_000)
    const originalBody = [...prefixLines, `- ${target}`].join('\n')
    sales.issues[0] = { ...sales.issues[0], body: originalBody }
    sales.opportunities[0].issueIds = [sales.issues[0].id]

    const plan = buildIssueAnalysisDeckPlan(report([sales]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    const rows = plan.slides.flatMap(slide =>
      slide.kind === 'area-summary' || slide.kind === 'area-summary-continuation'
        ? slide.issues
        : [])
    const targetFragments = rows
      .flatMap(row => row.bodyParagraphs)
      .filter(paragraph => paragraph.text.includes('나'))

    expect(rows.map(row => row.body).join('')).toBe(originalBody)
    expect(targetFragments.length).toBeGreaterThan(1)
    expect(targetFragments[0]).toMatchObject({ level: 0, marker: 'bullet' })
    expect(targetFragments.slice(1).every(fragment =>
      fragment.level === 0 && fragment.marker === null)).toBe(true)
    expect(targetFragments.filter(fragment => fragment.marker === 'bullet')).toHaveLength(1)
    expect(targetFragments.map(fragment => fragment.text).join('')).toBe(target)
  })

  it('페이지 분할점의 개행 구분자를 빈 문단으로 중복 생성하지 않는다', () => {
    const sales = area(1)
    const originalBody = Array.from(
      { length: 40 },
      (_, index) => `- 업무 현황 ${String(index + 1).padStart(2, '0')}의 원인과 영향을 확인합니다.`,
    ).join('\n')
    sales.issues[0] = { ...sales.issues[0], body: originalBody }
    sales.opportunities[0].issueIds = [sales.issues[0].id]

    const plan = buildIssueAnalysisDeckPlan(report([sales]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    const rows = plan.slides.flatMap(slide =>
      slide.kind === 'area-summary' || slide.kind === 'area-summary-continuation'
        ? slide.issues
        : [])
    const paragraphs = rows.flatMap(row => row.bodyParagraphs)

    expect(rows.length).toBeGreaterThan(1)
    expect(rows.map(row => row.body).join('')).toBe(originalBody)
    expect(paragraphs.filter(paragraph => paragraph.text === '')).toHaveLength(0)
    expect(paragraphs.filter(paragraph => paragraph.marker === 'bullet')).toHaveLength(40)
  })

  it('장문 제목·본문·Sub Process·원천을 전부 보존하며 내용량에 따라 페이지를 늘린다', () => {
    const long = area(1)
    const originalBody = [
      '[현황]',
      `- ${'기준 정보가 시스템별로 다릅니다. '.repeat(80)}`,
      '[문제/영향]',
      `- ${'확인과 정산이 지연됩니다. '.repeat(80)}`,
      '[필요 조치]',
      '- 관련 부서가 기준 일치화 방안을 확정해야 합니다. BODY-END',
    ].join('\n')
    long.issues[0] = {
      ...long.issues[0],
      title: `${'저장위치·플랜트·계정 기준 불일치 '.repeat(8)}TITLE-END`,
      body: originalBody,
      subProcess: `${'기준정보 정합성 검증/'.repeat(12)}SUB-END`,
      source: {
        manual: {
          type: 'interview',
          detail: Array.from({ length: 20 }, (_, index) => `관련 부서 인터뷰 ${index + 1}`).join(';'),
        },
        minutes: [],
      },
    }
    long.opportunities[0].issueIds = [long.issues[0].id]

    const plan = buildIssueAnalysisDeckPlan(report([long]), {
      projectName: 'D-Cube',
      authorName: '작성자',
      authorTeam: 'PI팀',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    const issueSlides = plan.slides.filter(slide =>
      slide.kind === 'area-summary' || slide.kind === 'area-summary-continuation')
    const rows = issueSlides.flatMap(slide => slide.issues)

    expect(issueSlides.length).toBeGreaterThan(1)
    expect(rows.map(row => row.body).join('')).toBe(normalizeIssueAnalysisMultilineText(originalBody))
    expect(rows.map(row => row.title).join('')).toContain('TITLE-END')
    expect(rows.map(row => row.subProcess).join('')).toContain('SUB-END')
    expect(rows.flatMap(row => row.sourceLines).join('\n')).toContain('관련 부서 인터뷰 20')
    expect(rows.every(row => row.continuationCount === rows.length)).toBe(true)
    expect(rows.map(row => `${row.title}${row.body}${row.subProcess}${row.sourceLines.join('')}`).join(''))
      .not.toContain('…')

    for (const slide of issueSlides) {
      const capacity = slide.kind === 'area-summary' ? 3 : 5
      expect(slide.issues.reduce((sum, row) => sum + row.rowUnits, 0)).toBeLessThanOrEqual(capacity)
    }
    const opportunityRows = plan.slides
      .filter(slide => slide.kind === 'opportunity')
      .flatMap(slide => slide.blocks)
      .filter(block => block.opportunityNo === 1)
      .flatMap(block => block.issues)
    expect(opportunityRows.map(row => row.title).join('')).toContain('TITLE-END')
    expect(opportunityRows.map(row => row.title).join('')).not.toContain('…')
  })

  it('장문 개선기회 설명을 계속 블록으로 나눠 마지막 문자까지 보존한다', () => {
    const sales = area(1)
    const description = `${'기준정보를 단일 원천으로 관리하고 책임 부서를 명확히 합니다. '.repeat(65)}😀OPPORTUNITY-END`
    sales.opportunities[0] = {
      title: `${'기준정보 통합 관리 '.repeat(8)}TITLE-END`,
      description,
      issueIds: [sales.issues[0].id],
    }
    const plan = buildIssueAnalysisDeckPlan(report([sales]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    const pages = plan.slides.filter(slide => slide.kind === 'opportunity')
    const blocks = pages.flatMap(slide => slide.blocks)

    expect(pages.length).toBeGreaterThan(1)
    expect(blocks.map(block => block.description).join(''))
      .toBe(normalizeIssueAnalysisMultilineText(description))
    expect(blocks.every(block => block.continuationCount === blocks.length)).toBe(true)
    expect(blocks.map(block => block.description).join('')).toContain('😀OPPORTUNITY-END')
    expect(blocks.map(block => `${block.title}${block.description}`).join('')).not.toContain('…')
  })

  it('장문 이슈 문맥과 원인분석을 계속 페이지로 나눠 마지막 문자까지 보존한다', () => {
    const sales = area(1)
    const issueBody = [
      '[현황]',
      `${'주문 채널별 입력 양식과 검증 기준이 서로 다릅니다. '.repeat(80)}`,
      '[문제/영향]',
      `${'수기 재입력과 확인 지연이 반복됩니다. '.repeat(80)}BODY-END`,
    ].join('\n')
    const directCause = `${'채널별 주문 접수와 승인 절차가 표준화되어 있지 않습니다. '.repeat(80)}😀DIRECT-END`
    const rootCause = `${'주문 정책의 관리 책임과 정기 검토 체계가 정의되지 않았습니다. '.repeat(80)}ROOT-END`
    sales.issues[0] = { ...sales.issues[0], body: issueBody }
    sales.opportunities[0].issueIds = [sales.issues[0].id]
    withCauseAnalyses(sales, [{
      issueId: sales.issues[0].id,
      causes: [{ category: 'process', directCause, rootCause }],
    }])

    const plan = buildIssueAnalysisDeckPlan(report([sales]), {
      projectName: 'D-Cube',
      authorName: '',
      authorTeam: '',
      generatedAt: '2026-07-31T00:00:00Z',
    })
    const pages = plan.slides.filter(slide => slide.kind === 'cause-analysis')
    const causeRows = pages.flatMap(slide => slide.causes)

    expect(pages.length).toBeGreaterThan(1)
    expect(pages.map(slide => slide.pageInIssue)).toEqual(
      Array.from({ length: pages.length }, (_, index) => index + 1),
    )
    expect(pages.every(slide => slide.pageCount === pages.length)).toBe(true)
    expect(causeRows.map(row => row.analysis).join('')).toBe([
      '[직접 원인]',
      normalizeIssueAnalysisMultilineText(directCause),
      '[근본 원인]',
      normalizeIssueAnalysisMultilineText(rootCause),
    ].join('\n'))
    expect(pages.map(slide => slide.issue.body).join(''))
      .toBe(normalizeIssueAnalysisMultilineText(issueBody))
    expect(causeRows.map(row => row.analysis).join('')).toContain('😀DIRECT-END')
    expect(causeRows.map(row => row.analysis).join('')).toContain('ROOT-END')
    expect(pages.map(slide => slide.issue.body).join('')).toContain('BODY-END')
    expect(pages.flatMap(slide => slide.causes).every(row =>
      row.continuationIndex >= 1 && row.continuationIndex <= row.continuationCount))
      .toBe(true)
    expect(pages.every(slide =>
      slide.issue.rowUnits + slide.causes.reduce((sum, row) => sum + row.rowUnits, 0) <= 4))
      .toBe(true)
    expect(pages.map(slide => [
      slide.issue.title,
      slide.issue.body,
      ...slide.causes.map(row => row.analysis),
    ].join('')).join('')).not.toContain('…')
  })
})
