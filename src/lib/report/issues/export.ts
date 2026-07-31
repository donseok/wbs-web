import type { IssueAnalysisDeckPlan } from './deckPlan'
import { renderIssueAnalysisPptWithJsZip } from './jszipRenderer'

export const ISSUE_ANALYSIS_PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export type IssueAnalysisPptExportStatus = 'ready' | 'unavailable'

export interface IssueAnalysisPptExportDiagnostic {
  status: IssueAnalysisPptExportStatus
  code: 'PPT_EXPORT_READY' | 'PPT_RENDERER_UNAVAILABLE'
  message: string
}

export function getIssueAnalysisPptExportDiagnostic(): IssueAnalysisPptExportDiagnostic {
  return {
    status: 'ready',
    code: 'PPT_EXPORT_READY',
    message: '표준 템플릿 기반 PPTX를 다운로드할 수 있습니다.',
  }
}

export class IssueAnalysisPptRendererUnavailableError extends Error {
  readonly code = 'PPT_RENDERER_UNAVAILABLE'
}

/** 저장된 분석 계획을 표준 템플릿의 복제·치환 방식으로 렌더링한다. */
export async function renderIssueAnalysisPpt(
  plan: IssueAnalysisDeckPlan,
): Promise<Uint8Array> {
  return renderIssueAnalysisPptWithJsZip(plan)
}

function seoulDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('이슈 분석서 생성일시가 올바르지 않습니다.')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function buildIssueAnalysisFilename(
  projectName: string,
  generatedAt: string,
): string {
  const safeProject = projectName.trim() || '프로젝트'
  return `${safeProject}_이슈분석서_${seoulDate(generatedAt)}.pptx`
    .replace(/[^\w가-힣.\-]+/g, '_')
}
