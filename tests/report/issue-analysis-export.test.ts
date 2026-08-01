import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type {
  IssueAnalysisReport,
  IssueAnalysisReportArea,
  IssueAnalysisReportIssue,
} from '@/lib/report/issues/model'
import {
  buildIssueAnalysisDeckPlan,
  normalizeIssueAnalysisMultilineText,
} from '@/lib/report/issues/deckPlan'
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

function xmlParagraphContaining(xml: string, text: string): string {
  const paragraph = (xml.match(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g) ?? [])
    .find(candidate => candidate.includes(text))
  if (!paragraph) throw new Error(`missing paragraph in test XML: ${text}`)
  return paragraph
}

function expectCanonicalIssueParagraph(
  paragraph: string,
  expected: { marL: string; indent: string; lvl: '0' | '1' },
): void {
  const pPr = paragraph.match(
    /<a:pPr\b[^>]*\/>|<a:pPr\b[\s\S]*?<\/a:pPr>/,
  )?.[0]
  expect(pPr).toBeDefined()
  expect(pPr).toContain(`marL="${expected.marL}"`)
  expect(pPr).toContain(`indent="${expected.indent}"`)
  expect(pPr).toContain(`lvl="${expected.lvl}"`)
  expect(pPr?.match(/\bmarL=/g)).toHaveLength(1)
  expect(pPr?.match(/\bindent=/g)).toHaveLength(1)
  expect(pPr?.match(/\blvl=/g)).toHaveLength(1)
  expect(paragraph).toContain('<a:buNone/>')
  expect(paragraph).not.toMatch(/<a:bu(?:Char|Font|AutoNum|Blip)\b/)
  expect(paragraph).not.toContain('Wingdings')
  const bulletIndex = pPr?.indexOf('<a:buNone') ?? -1
  expect(bulletIndex).toBeGreaterThanOrEqual(0)
  for (const successor of ['<a:tabLst', '<a:defRPr', '<a:extLst']) {
    const successorIndex = pPr?.indexOf(successor) ?? -1
    if (successorIndex >= 0) expect(bulletIndex).toBeLessThan(successorIndex)
  }
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

  it('이슈 본문의 최상위·하위 항목 기호를 텍스트로 고정하고 템플릿 bullet을 제거한다', async () => {
    const sales = area('02', 1, 1)
    const body = [
      '[현황]',
      '- 최상위 대시 항목 TOP-DASH',
      '* 최상위 별표 항목 TOP-STAR',
      '• 최상위 원형 항목 TOP-DOT',
      '  - 들여쓴 하위 항목 CHILD-INDENT',
      '✓ 명시 체크 항목 CHILD-CHECK',
      '✔ 명시 굵은 체크 항목 CHILD-BOLD-CHECK',
      '☑ 명시 상자 체크 항목 CHILD-BOX-CHECK',
      '일반 설명 문장 PLAIN-END',
    ].join('\n')
    sales.issues[0] = { ...sales.issues[0], body }
    sales.opportunities[0].issueIds = [sales.issues[0].id]
    const bulletPlan = plan([sales])
    const issueEntry = bulletPlan.slides
      .map((slide, index) => ({ slide, outputPage: index + 1 }))
      .find(({ slide }) => slide.kind === 'area-summary')
    expect(issueEntry?.slide.kind).toBe('area-summary')
    if (!issueEntry || issueEntry.slide.kind !== 'area-summary') {
      throw new Error('missing issue summary slide')
    }
    expect(issueEntry.slide.issues.map(row => row.body).join(''))
      .toBe(normalizeIssueAnalysisMultilineText(body))

    const bytes = await renderIssueAnalysisPpt(bulletPlan)
    const zip = await JSZip.loadAsync(bytes)
    const issueXml = await zipText(zip, `ppt/slides/slide${issueEntry.outputPage}.xml`)
    const expectedItems: Array<{
      text: string
      marL: string
      indent: string
      lvl: '0' | '1'
    }> = [
      { text: '• 최상위 대시 항목 TOP-DASH', marL: '171450', indent: '-171450', lvl: '0' },
      { text: '• 최상위 별표 항목 TOP-STAR', marL: '171450', indent: '-171450', lvl: '0' },
      { text: '• 최상위 원형 항목 TOP-DOT', marL: '171450', indent: '-171450', lvl: '0' },
      { text: '✓ 들여쓴 하위 항목 CHILD-INDENT', marL: '358775', indent: '-184150', lvl: '1' },
      { text: '✓ 명시 체크 항목 CHILD-CHECK', marL: '358775', indent: '-184150', lvl: '1' },
      { text: '✓ 명시 굵은 체크 항목 CHILD-BOLD-CHECK', marL: '358775', indent: '-184150', lvl: '1' },
      { text: '✓ 명시 상자 체크 항목 CHILD-BOX-CHECK', marL: '358775', indent: '-184150', lvl: '1' },
      { text: '• 일반 설명 문장 PLAIN-END', marL: '171450', indent: '-171450', lvl: '0' },
    ]
    for (const item of expectedItems) {
      expect(issueXml).toContain(`<a:t>${item.text}</a:t>`)
      const paragraph = xmlParagraphContaining(issueXml, item.text)
      expectCanonicalIssueParagraph(paragraph, item)
    }
    expect(issueXml).not.toContain('<a:buChar char="§"/>')
    expect(issueXml).not.toContain('<a:t>- 최상위 대시 항목')
    expect(issueXml).not.toContain('<a:t>* 최상위 별표 항목')
    expect(issueXml).not.toContain('<a:t>✔ 명시 굵은 체크 항목')
    expect(issueXml).not.toContain('<a:t>☑ 명시 상자 체크 항목')
    expect(issueXml).not.toContain('…')
  })

  it('장문 목록의 계속 조각은 같은 단계와 0 들여쓰기를 유지하고 marker를 반복하지 않는다', async () => {
    const sales = area('02', 1, 1)
    const topText = Array.from(
      { length: 100 },
      (_, index) => `TOP-${String(index).padStart(3, '0')}-상위항목설명`,
    ).join(' ')
    const childText = Array.from(
      { length: 100 },
      (_, index) => `CHILD-${String(index).padStart(3, '0')}-하위항목설명`,
    ).join(' ')
    sales.issues[0] = {
      ...sales.issues[0],
      body: ['[현황]', `- ${topText}`, `  - ${childText}`].join('\n'),
    }
    sales.opportunities[0].issueIds = [sales.issues[0].id]

    const longListPlan = plan([sales])
    const issueEntries = longListPlan.slides
      .map((slide, index) => ({ slide, outputPage: index + 1 }))
      .filter(({ slide }) =>
        slide.kind === 'area-summary' || slide.kind === 'area-summary-continuation')
    const paragraphEntries = issueEntries.flatMap(({ slide, outputPage }) => {
      if (slide.kind !== 'area-summary' && slide.kind !== 'area-summary-continuation') return []
      return slide.issues.flatMap(row => row.bodyParagraphs.map(paragraph => ({
        paragraph,
        outputPage,
      })))
    }).filter(({ paragraph }) => !paragraph.heading && paragraph.text)
    const topMarkerIndex = paragraphEntries.findIndex(({ paragraph }) =>
      paragraph.marker === 'bullet')
    const childMarkerIndex = paragraphEntries.findIndex(({ paragraph }) =>
      paragraph.marker === 'check')
    const topMarker = paragraphEntries[topMarkerIndex]
    const topContinuation = paragraphEntries
      .slice(topMarkerIndex + 1, childMarkerIndex)
      .find(({ paragraph }) => paragraph.level === 0 && paragraph.marker === null)
    const childMarker = paragraphEntries[childMarkerIndex]
    const childContinuation = paragraphEntries
      .slice(childMarkerIndex + 1)
      .find(({ paragraph }) => paragraph.level === 1 && paragraph.marker === null)

    expect(issueEntries.length).toBeGreaterThan(1)
    expect(topMarker).toBeDefined()
    expect(topContinuation).toBeDefined()
    expect(childMarker).toBeDefined()
    expect(childContinuation).toBeDefined()
    expect(paragraphEntries.filter(({ paragraph }) => paragraph.marker === 'bullet'))
      .toHaveLength(1)
    expect(paragraphEntries.filter(({ paragraph }) => paragraph.marker === 'check'))
      .toHaveLength(1)

    const bytes = await renderIssueAnalysisPpt(longListPlan)
    const zip = await JSZip.loadAsync(bytes)
    const xmlByPage = new Map<number, string>()
    for (const { outputPage } of issueEntries) {
      xmlByPage.set(outputPage, await zipText(zip, `ppt/slides/slide${outputPage}.xml`))
    }
    const checks = [
      { entry: topMarker, marker: '• ', marL: '171450', indent: '-171450', lvl: '0' as const },
      { entry: topContinuation, marker: '', marL: '171450', indent: '0', lvl: '0' as const },
      { entry: childMarker, marker: '✓ ', marL: '358775', indent: '-184150', lvl: '1' as const },
      { entry: childContinuation, marker: '', marL: '358775', indent: '0', lvl: '1' as const },
    ]
    for (const check of checks) {
      if (!check.entry) throw new Error('missing long-list paragraph fixture')
      const xml = xmlByPage.get(check.entry.outputPage)
      if (!xml) throw new Error(`missing long-list slide XML: ${check.entry.outputPage}`)
      const renderedText = `${check.marker}${check.entry.paragraph.text}`
      const paragraph = xmlParagraphContaining(xml, renderedText)
      expectCanonicalIssueParagraph(paragraph, check)
      if (!check.marker) {
        expect(paragraph).not.toMatch(/<a:t(?:\s[^>]*)?>• /)
        expect(paragraph).not.toMatch(/<a:t(?:\s[^>]*)?>✓ /)
      }
    }
    const issueXml = [...xmlByPage.values()].join('\n')
    expect(issueXml.match(/<a:t(?:\s[^>]*)?>• /g)).toHaveLength(1)
    expect(issueXml.match(/<a:t(?:\s[^>]*)?>✓ /g)).toHaveLength(1)
    expect(issueXml).not.toContain('…')
  })

  it('원본 10페이지에 이슈별 직접·근본 원인을 자동 작성하고 미확정 원인을 명시한다', async () => {
    const sales = area('02', 1, 1) as IssueAnalysisReportArea & {
      causeAnalyses: Array<{
        issueId: string
        causes: Array<{
          category: 'process' | 'it'
          directCause: string
          rootCause: string | null
        }>
      }>
    }
    sales.causeAnalyses = [{
      issueId: sales.issues[0].id,
      causes: [{
        category: 'process',
        directCause: '주문 승인과 입력 절차가 채널별로 다르다.',
        rootCause: '표준 주문 정책의 관리 책임과 정기 검토 체계가 정의되지 않았다.',
      }, {
        category: 'it',
        directCause: '주문 입력 단계에서 필수값을 자동 검증하는 기능이 없다.',
        rootCause: null,
      }],
    }]
    const causePlan = plan([sales])
    const causeEntry = causePlan.slides
      .map((slide, index) => ({ slide, outputPage: index + 1 }))
      .find(({ slide }) => slide.kind === 'cause-analysis')
    expect(causeEntry).toBeDefined()

    const bytes = await renderIssueAnalysisPpt(causePlan)
    const zip = await JSZip.loadAsync(bytes)
    const causeXml = await zipText(
      zip,
      `ppt/slides/slide${causeEntry?.outputPage}.xml`,
    )

    expect(causeXml).toContain('이슈별 원인 분석 – 02_영업')
    expect(causeXml).toContain('2. 영역 별 이슈 및 원인 분석서')
    expect(causeXml).toContain('PI-I-02-01')
    expect(causeXml).toContain('자동 이슈 1')
    expect(causeXml).toContain('자동 이슈 1 상세 내용')
    expect(causeXml).toContain('Sub 1')
    expect(causeXml).toContain('현업 인터뷰 1')
    expect(causeXml).toContain('P · 프로세스')
    expect(causeXml).toContain('I · IT')
    expect(causeXml).toContain('[직접 원인]')
    expect(causeXml).toContain('주문 승인과 입력 절차가 채널별로 다르다.')
    expect(causeXml).toContain('[근본 원인]')
    expect(causeXml).toContain('표준 주문 정책의 관리 책임과 정기 검토 체계가 정의되지 않았다.')
    expect(causeXml).toContain('추가 확인 필요')
    expect(causeXml).toContain('<a:normAutofit/>')
    expect(causeXml).not.toContain('PI-I-02-03')
    expect(causeXml).not.toContain('복잡하고 반복적인 주문 입력 업무')
    expect(causeXml).not.toContain('엑셀,PDF,카톡 주문접수내역')
  })

  it('여러 Mega의 개선기회를 한 페이지에 묶고 동적 shape 연결을 유효하게 만든다', async () => {
    const bytes = await renderIssueAnalysisPpt(plan([
      area('00', 1, 1),
      area('02', 8, 5),
    ]))
    const zip = await JSZip.loadAsync(bytes)
    const presentation = await zipText(zip, 'ppt/presentation.xml')
    expect(presentation.match(/<p:sldId\b/g)).toHaveLength(9)

    expect(await zipText(zip, 'ppt/slides/slide5.xml')).toContain('PI-I-00-01')
    expect(await zipText(zip, 'ppt/slides/slide6.xml')).toContain('PI-I-02-01')

    const opportunity = await zipText(zip, 'ppt/slides/slide9.xml')
    expect(opportunity).toContain('주요 이슈 및 개선 기회 (1/1)')
    expect(opportunity).toContain('00-기준관리 · 기준정보 단일화')
    expect(opportunity).toContain('02-영업 · 주문 접수·진행 통합')
    expect(opportunity).toContain('PI-I-00-01')
    expect(opportunity).toContain('PI-I-02-05')
    expect(opportunity).not.toContain('제품별로 부정확한 원가정보 제공')

    const shapeIds = [...opportunity.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)]
      .map(match => match[1])
    expect(new Set(shapeIds).size).toBe(shapeIds.length)
    const connectorTargetIds = [...opportunity.matchAll(/<a:(?:st|end)Cxn\b[^>]*\bid="(\d+)"/g)]
      .map(match => match[1])
    expect(connectorTargetIds.length).toBeGreaterThan(0)
    expect(connectorTargetIds.every(id => new Set(shapeIds).has(id))).toBe(true)
  })

  it('개선기회가 많을 때만 12페이지 형식을 2·3페이지로 늘린다', async () => {
    const sales = area('02', 5, 1)
    sales.opportunities = Array.from({ length: 11 }, (_, index) => ({
      title: `개선기회 ${index + 1}`,
      description: `업무 개선 방향 ${index + 1}`,
      issueIds: [sales.issues[index % sales.issues.length].id],
    }))
    const compactPlan = plan([sales])
    const opportunityEntries = compactPlan.slides
      .map((slide, index) => ({ slide, outputPage: index + 1 }))
      .filter(({ slide }) => slide.kind === 'opportunity')
    expect(opportunityEntries).toHaveLength(3)

    const bytes = await renderIssueAnalysisPpt(compactPlan)
    const zip = await JSZip.loadAsync(bytes)
    const opportunityXml: string[] = []
    for (const { outputPage } of opportunityEntries) {
      opportunityXml.push(await zipText(zip, `ppt/slides/slide${outputPage}.xml`))
    }
    expect(opportunityXml[0]).toContain('주요 이슈 및 개선 기회 (1/3)')
    expect(opportunityXml[2]).toContain('주요 이슈 및 개선 기회 (3/3)')
    for (let index = 1; index <= 11; index += 1) {
      expect(opportunityXml.join('\n')).toContain(`개선기회 ${index}`)
    }
  })

  it('장문 이슈를 말줄임 없이 여러 표 페이지에 배치하고 행 높이·자동 맞춤을 적용한다', async () => {
    const sales = area('02', 1, 1)
    sales.issues[0] = {
      ...sales.issues[0],
      title: `${'저장위치·플랜트·계정 기준이 시스템 간 상이함 '.repeat(8)}TITLE-END`,
      body: [
        '[현황]',
        `- ${'시스템별 기준값과 관리 주체를 확인하고 있습니다. '.repeat(90)}`,
        '[문제/영향]',
        `- ${'기준 불일치로 확인과 후속 처리가 지연됩니다. '.repeat(90)}`,
        '[필요 조치]',
        '- 관련 부서가 기준 일치화와 관리 원칙을 확정해야 합니다. BODY-END',
      ].join('\n'),
      subProcess: `${'기준정보 정합성 검증/'.repeat(12)}SUB-END`,
      source: {
        manual: {
          type: 'interview',
          detail: Array.from({ length: 20 }, (_, index) => `관련 부서 인터뷰 ${index + 1}`).join(';'),
        },
        minutes: [],
      },
    }
    sales.opportunities[0].issueIds = [sales.issues[0].id]

    const longPlan = plan([sales])
    const issueSlideEntries = longPlan.slides
      .map((slide, index) => ({ slide, outputPage: index + 1 }))
      .filter(({ slide }) =>
        slide.kind === 'area-summary' || slide.kind === 'area-summary-continuation')
    expect(issueSlideEntries.length).toBeGreaterThan(1)

    const bytes = await renderIssueAnalysisPpt(longPlan)
    const zip = await JSZip.loadAsync(bytes)
    const issueXmlParts: string[] = []
    for (const { slide, outputPage } of issueSlideEntries) {
      if (slide.kind !== 'area-summary' && slide.kind !== 'area-summary-continuation') continue
      const xml = await zipText(zip, `ppt/slides/slide${outputPage}.xml`)
      issueXmlParts.push(xml)
      expect(xml.match(/<a:tr\b/g)).toHaveLength(slide.issues.length + 1)
      expect(xml).toContain('<a:normAutofit/>')
      if (slide.issues[0].continuationCount > 1) {
        expect(xml).toContain('(계속 ')
      }
    }
    const issueXml = issueXmlParts.join('\n')
    expect(issueXml).toContain('TITLE-END')
    expect(issueXml).toContain('BODY-END')
    expect(issueXml).toContain('SUB-END')
    expect(issueXml).toContain('관련 부서 인터뷰 20')
    expect(issueXml).toContain('[현황]')
    expect(issueXml).toContain('[문제/영향]')
    expect(issueXml).toContain('[필요 조치]')
    expect(issueXml).not.toContain('…')

    const opportunityEntry = longPlan.slides
      .map((slide, index) => ({ slide, outputPage: index + 1 }))
      .find(({ slide }) => slide.kind === 'opportunity')
    expect(opportunityEntry).toBeDefined()
    const opportunityXml = await zipText(
      zip,
      `ppt/slides/slide${opportunityEntry?.outputPage}.xml`,
    )
    expect(opportunityXml).toContain('TITLE-END')
    expect(opportunityXml).toContain('<a:normAutofit/>')
  })
})
