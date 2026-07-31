import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type {
  IssueAnalysisReport,
  IssueAnalysisReportArea,
  IssueAnalysisReportIssue,
} from '@/lib/report/issues/model'
import { buildIssueAnalysisDeckPlan } from '@/lib/report/issues/deckPlan'
import {
  buildIssueAnalysisFilename,
  getIssueAnalysisPptExportDiagnostic,
  renderIssueAnalysisPpt,
} from '@/lib/report/issues/export'

function issue(index: number, megaCode = '02'): IssueAnalysisReportIssue {
  return {
    id: `${megaCode}-issue-${index}`,
    issueNo: index,
    piIssueCode: `PI-I-${megaCode}-${String(index).padStart(2, '0')}`,
    megaCode: megaCode as IssueAnalysisReportIssue['megaCode'],
    megaSeq: index,
    title: `자동 이슈 ${index}`,
    body: `자동 이슈 ${index} 상세 내용`,
    status: 'open',
    severity: 'medium',
    subProcess: `Sub ${index}`,
    ownerDepartment: index % 2 ? '영업팀' : 'PI팀',
    relatedSystems: index % 2 ? ['ERP'] : ['MES'],
    assigneeMemberIds: [],
    source: {
      manual: { type: 'interview', detail: `현업 인터뷰 ${index}` },
      minutes: [],
    },
  }
}

function area(
  megaCode: '00' | '02',
  count: number,
  linkedIssueCount = Math.min(3, count),
): IssueAnalysisReportArea {
  const issues = Array.from(
    { length: count },
    (_, index) => issue(index + 1, megaCode),
  )
  return {
    megaCode,
    megaName: megaCode === '00' ? '기준관리' : '영업',
    megaNameEn: megaCode === '00' ? 'Master Data' : 'Sales',
    summary: {
      totalCount: issues.length,
      statusCounts: { open: issues.length, in_progress: 0, resolved: 0, on_hold: 0 },
      severityCounts: { high: 0, medium: issues.length, low: 0 },
      ownerDepartments: ['PI팀', '영업팀'],
      relatedSystems: ['ERP', 'MES'],
    },
    issues,
    opportunities: [{
      title: megaCode === '00' ? '기준정보 단일화' : '주문 접수·진행 통합',
      description: megaCode === '00'
        ? '중복 기준정보를 통제한다.'
        : '다채널 주문을 표준화하고 단일 화면에서 추적한다.',
      issueIds: issues.slice(0, linkedIssueCount).map(item => item.id),
    }],
  }
}

function plan(areas = [area('02', 8)]) {
  const report: IssueAnalysisReport = {
    schemaVersion: 'issue-analysis.v1',
    projectId: 'project-1',
    issueCount: areas.reduce((sum, item) => sum + item.issues.length, 0),
    generatedAt: '2026-07-31T00:00:00Z',
    areas,
  }
  return buildIssueAnalysisDeckPlan(report, {
    projectName: 'D-Cube & 부산',
    authorName: '이돈석',
    authorTeam: '부산운영팀',
    generatedAt: report.generatedAt,
  })
}

async function zipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`missing test part: ${path}`)
  return file.async('string')
}

describe('이슈 분석서 PPT 내보내기', () => {
  it('프로젝트명과 서울 날짜로 안전한 파일명을 만든다', () => {
    expect(buildIssueAnalysisFilename(
      'D-Cube / 부산',
      '2026-07-30T16:00:00Z',
    )).toBe('D-Cube_부산_이슈분석서_2026-07-31.pptx')
  })

  it('JSZip 운영 렌더러를 ready로 진단한다', () => {
    expect(getIssueAnalysisPptExportDiagnostic()).toMatchObject({
      status: 'ready',
      code: 'PPT_EXPORT_READY',
    })
  })

  it('원본 1·2·3·4·8·9·11·12페이지를 복제하고 지정 데이터만 치환한다', async () => {
    const bytes = await renderIssueAnalysisPpt(plan())
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])

    const zip = await JSZip.loadAsync(bytes)
    const slidePaths = Object.keys(zip.files)
      .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
      .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]))
    expect(slidePaths).toEqual(Array.from(
      { length: 8 },
      (_, index) => `ppt/slides/slide${index + 1}.xml`,
    ))

    const presentation = await zipText(zip, 'ppt/presentation.xml')
    const presentationRels = await zipText(zip, 'ppt/_rels/presentation.xml.rels')
    const appProperties = await zipText(zip, 'docProps/app.xml')
    expect(presentation.match(/<p:sldId\b/g)).toHaveLength(8)
    expect(presentationRels.match(
      /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/slide"/g,
    )).toHaveLength(8)
    expect(appProperties).toContain('<Slides>8</Slides>')

    const cover = await zipText(zip, 'ppt/slides/slide1.xml')
    expect(cover).toContain('D-Cube &amp; 부산')
    expect(cover).toContain('(이슈 분석서)')
    expect(cover).toContain('부산운영팀 이돈석')
    expect(cover).not.toContain('D-Cube 마스터플랜 프로젝트')

    const firstArea = await zipText(zip, 'ppt/slides/slide5.xml')
    const continuation = await zipText(zip, 'ppt/slides/slide6.xml')
    expect(firstArea).toContain('02 영업')
    expect(firstArea).toContain('자동 이슈 1')
    expect(firstArea).toContain('PI-I-02-03')
    expect(continuation).toContain('자동 이슈 8')
    expect(continuation).toContain('PI-I-02-08')

    const opportunity = await zipText(zip, 'ppt/slides/slide8.xml')
    expect(opportunity).toContain('주문 접수·진행 통합')
    expect(opportunity).toContain('자동 이슈 1')
    expect(opportunity).toContain('PI-I-02-03')
    for (const unusedId of ['60', '61', '63', '64', '73', '74']) {
      expect(opportunity).not.toContain(`<p:cNvPr id="${unusedId}"`)
    }
    expect(opportunity).not.toContain('제품별로 부정확한 원가정보 제공')
  })

  it('여러 Mega와 개선기회에서 원본 8·12페이지를 독립 복제한다', async () => {
    const bytes = await renderIssueAnalysisPpt(plan([
      area('00', 1, 1),
      area('02', 8, 5),
    ]))
    const zip = await JSZip.loadAsync(bytes)
    const presentation = await zipText(zip, 'ppt/presentation.xml')
    expect(presentation.match(/<p:sldId\b/g)).toHaveLength(10)

    expect(await zipText(zip, 'ppt/slides/slide5.xml')).toContain('PI-I-00-01')
    expect(await zipText(zip, 'ppt/slides/slide6.xml')).toContain('PI-I-02-01')

    const masterOpportunity = await zipText(zip, 'ppt/slides/slide9.xml')
    expect(masterOpportunity).toContain('00-기준관리')
    for (const unusedId of ['54', '55', '57', '58', '60', '61', '63', '64']) {
      expect(masterOpportunity).not.toContain(`<p:cNvPr id="${unusedId}"`)
    }

    const salesOpportunity = await zipText(zip, 'ppt/slides/slide10.xml')
    expect(salesOpportunity).toContain('02-영업')
    expect(salesOpportunity).toContain('<p:cNvPr id="64"')
    expect(salesOpportunity).toContain('<p:cNvPr id="74"')
  })
})
