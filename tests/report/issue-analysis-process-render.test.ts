import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { ISSUE_ANALYSIS_TEMPLATE_PATH } from '@/lib/report/issues/template'
import { renderIssueAnalysisPptFromTemplate } from '@/lib/report/issues/jszipRenderer'
import { buildIssueAnalysisDeckPlan } from '@/lib/report/issues/deckPlan'
import type {
  IssueAnalysisReport,
  IssueAnalysisReportIssue,
} from '@/lib/report/issues/model'

const MAJOR_ORDER = {
  id: 'aaaa0000-0000-4000-8000-000000000001',
  majorSeq: 1,
  name: '주문관리',
}
const MAJOR_EXPORT = {
  id: 'aaaa0000-0000-4000-8000-000000000002',
  majorSeq: 2,
  name: '수출관리',
}

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

function reportFixture(): IssueAnalysisReport {
  const issues = [
    issueFixture({ megaSeq: 1, majorId: MAJOR_ORDER.id, subProcess: '표준가격산정' }),
    issueFixture({ megaSeq: 2, majorId: MAJOR_ORDER.id, subProcess: '오더진행점검' }),
    issueFixture({ megaSeq: 3, majorId: null, subProcess: '미지정업무' }),
  ]
  return {
    schemaVersion: 'issue-analysis.v1',
    projectId: 'project-1',
    issueCount: issues.length,
    generatedAt: '2026-08-02T00:00:00Z',
    areas: [{
      megaCode: '02',
      megaName: '영업',
      megaNameEn: 'Sales',
      majors: [MAJOR_ORDER, MAJOR_EXPORT],
      processDefinitions: {
        megaDefinition: '고객 주문 이행 전반을 관리하는 프로세스임',
        majors: [
          { majorId: MAJOR_ORDER.id, definition: '주문 접수부터 납기까지 관리하는 프로세스' },
          { majorId: MAJOR_EXPORT.id, definition: '수출 이행 전반을 관리하는 프로세스' },
        ],
      },
      summary: {
        totalCount: issues.length,
        statusCounts: {
          open: issues.length, in_progress: 0, resolved: 0, on_hold: 0,
        },
        severityCounts: { high: 0, medium: issues.length, low: 0 },
        ownerDepartments: ['영업팀'],
        relatedSystems: ['ERP'],
      },
      issues,
      opportunities: [{
        title: '주문 프로세스 표준화',
        description: '주문 입력 실수를 줄인다.',
        issueIds: issues.map(item => item.id),
      }],
    }],
  }
}

const META = {
  projectName: 'D-Cube',
  authorName: '홍길동',
  authorTeam: 'PI팀',
  generatedAt: '2026-08-02T00:00:00Z',
}

async function renderedSlides(
  plan: ReturnType<typeof buildIssueAnalysisDeckPlan>,
): Promise<string[]> {
  const template = await readFile(ISSUE_ANALYSIS_TEMPLATE_PATH)
  const bytes = await renderIssueAnalysisPptFromTemplate(plan, template)
  const zip = await JSZip.loadAsync(bytes)
  const slides: string[] = []
  for (let page = 1; zip.file(`ppt/slides/slide${page}.xml`); page += 1) {
    slides.push(await zip.file(`ppt/slides/slide${page}.xml`)!.async('string'))
  }
  return slides
}

describe('프로세스 트리 슬라이드 렌더', () => {
  it('체브론 8칸(정본 Mega명)·활성 강조·제목·헤드라인·미지정 열을 그린다', async () => {
    const plan = buildIssueAnalysisDeckPlan(reportFixture(), META)
    const slides = await renderedSlides(plan)
    const tree = slides.find(xml => xml.includes('As-Is 프로세스 체계'))
    expect(tree).toBeDefined()
    expect(tree).toContain('As-Is 프로세스 체계 – 02_영업')
    expect(tree).toContain('기준관리')
    expect(tree).toContain('원가')
    expect(tree).toContain('주문관리')
    expect(tree).toContain('수출관리')
    expect(tree).toContain('(미지정)')
    expect(tree).toContain('미지정업무')
    expect(tree).toContain('표준가격산정')
    expect(tree).toContain('2개의 Major 프로세스와 3개의 Sub 프로세스')
    // 템플릿 셈플 Sub·Major는 전량 삭제/치환된다.
    expect(tree).not.toContain('견적관리')
    expect(tree).not.toContain('경매관리자')
    expect(tree).not.toContain('실적관리')
    expect(tree).not.toContain('매출채권관리')
  })

  it('사용하지 않는 Major 열 박스는 삭제된다', async () => {
    const plan = buildIssueAnalysisDeckPlan(reportFixture(), META)
    const slides = await renderedSlides(plan)
    const tree = slides.find(xml => xml.includes('As-Is 프로세스 체계'))!
    // 3열(주문관리·수출관리·미지정)만 사용 → 4~8번째 슬롯 박스 부재
    expect(tree).not.toMatch(/<p:cNvPr\b[^>]*\bid="51"/)
    expect(tree).not.toMatch(/<p:cNvPr\b[^>]*\bid="92"/)
    // 템플릿 셈플 커넥터(부채꼴·스파인)도 전량 삭제 후 재구성된다.
    expect(tree).not.toMatch(/<p:cNvPr\b[^>]*\bid="117"/)
  })
})

describe('프로세스 정의 슬라이드 렌더', () => {
  it('Mega 정의·행 텍스트를 채우고 빈 행 도형을 삭제한다', async () => {
    const plan = buildIssueAnalysisDeckPlan(reportFixture(), META)
    const slides = await renderedSlides(plan)
    const definition = slides.find(xml => xml.includes('02.01 주문관리'))
    expect(definition).toBeDefined()
    expect(definition).toContain('02. 영업')
    expect(definition).toContain('주문 이행 전반을 관리하는 프로세스임')
    expect(definition).toContain('02.02 수출관리')
    expect(definition).toContain('수출 이행 전반을 관리하는 프로세스')
    expect(definition).not.toMatch(/<p:cNvPr\b[^>]*\bid="58"/)
    expect(definition).not.toMatch(/<p:cNvPr\b[^>]*\bid="60"/)
    expect(definition).not.toMatch(/<p:cNvPr\b[^>]*\bid="67"/)
  })
})

describe('덱 검증', () => {
  it('열 9개짜리 트리 슬라이드는 렌더 전에 거부된다', async () => {
    const plan = buildIssueAnalysisDeckPlan(reportFixture(), META)
    const mutated = JSON.parse(JSON.stringify(plan)) as typeof plan
    const tree = mutated.slides.find(slide => slide.kind === 'process-tree')
    if (tree?.kind !== 'process-tree') throw new Error('tree slide missing')
    tree.columns = Array.from({ length: 9 }, (_, index) => ({
      label: `열${index + 1}`, continuation: false, subs: [],
    }))
    const template = await readFile(ISSUE_ANALYSIS_TEMPLATE_PATH)
    await expect(renderIssueAnalysisPptFromTemplate(mutated, template))
      .rejects.toThrow('프로세스 트리')
  })
})
