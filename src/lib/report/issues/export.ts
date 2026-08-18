import type { IssueAnalysisDeckPlan } from './deckPlan'
import { seoulYmd } from '@/lib/domain/dates'
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
  // 파일명에 'Invalid Date'가 박히면 안 되므로 유효성 가드는 유지 — 포맷만 정본(seoulYmd)에 위임.
  if (Number.isNaN(date.getTime())) throw new Error('이슈 분석서 생성일시가 올바르지 않습니다.')
  return seoulYmd(date)
}

export function buildIssueAnalysisFilename(
  projectName: string,
  generatedAt: string,
): string {
  const safeProject = projectName.trim() || '프로젝트'
  return `${safeProject}_이슈분석서_${seoulDate(generatedAt)}.pptx`
    .replace(/[^\w가-힣.\-]+/g, '_')
}
