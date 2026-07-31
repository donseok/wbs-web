import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  ISSUE_ANALYSIS_TEMPLATE_PATH,
  ISSUE_ANALYSIS_TEMPLATE_RELATIVE_PATH,
  classifyIssueAnalysisTemplateHeader,
  diagnoseIssueAnalysisTemplate,
  hasZipHeader,
} from '@/lib/report/issues/template'

describe('이슈 분석서 템플릿 진단', () => {
  it('OOXML ZIP 헤더만 ready로 판정한다', () => {
    const header = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])
    expect(hasZipHeader(header)).toBe(true)
    expect(classifyIssueAnalysisTemplateHeader(header, '/tmp/template.pptx')).toMatchObject({
      status: 'ready',
      path: '/tmp/template.pptx',
    })
  })

  it('Document Safer 헤더는 protected로 명시한다', () => {
    const header = new TextEncoder().encode('<DOCUMENT SAFER V2010 R2>')
    const result = classifyIssueAnalysisTemplateHeader(header)
    expect(result.status).toBe('protected')
    expect(result.message).toContain('DRM')
  })

  it('파일 부재는 missing이며 고정 자산 경로를 안내한다', () => {
    const result = classifyIssueAnalysisTemplateHeader(null)
    expect(result.status).toBe('missing')
    expect(result.message).toContain(ISSUE_ANALYSIS_TEMPLATE_RELATIVE_PATH)
  })

  it('등록된 런타임 자산은 실제 OOXML이며 ready로 진단된다', async () => {
    const bytes = await readFile(ISSUE_ANALYSIS_TEMPLATE_PATH)
    expect(hasZipHeader(bytes.subarray(0, 4))).toBe(true)
    expect(bytes.length).toBeGreaterThan(500_000)
    await expect(diagnoseIssueAnalysisTemplate()).resolves.toMatchObject({
      status: 'ready',
      code: 'TEMPLATE_READY',
      path: ISSUE_ANALYSIS_TEMPLATE_PATH,
    })
  })
})
