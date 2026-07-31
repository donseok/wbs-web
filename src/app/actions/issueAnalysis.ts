'use server'

import { requireProjectMember } from '@/lib/authz'
import { loadIssueAnalysisIssues } from '@/lib/data/issueAnalysis'
import {
  isIssueMegaCode,
  type IssueMegaFilter,
} from '@/lib/domain/issueAnalysis'
import {
  ensureIssueAnalysis,
  type EnsureIssueAnalysisResult,
} from '@/lib/ai/issue-analysis'
import {
  buildIssueAnalysisPreflight,
  type IssueAnalysisPreflight,
  type IssueAnalysisReport,
} from '@/lib/report/issues/model'
import {
  diagnoseIssueAnalysisTemplate,
  ISSUE_ANALYSIS_TEMPLATE_RELATIVE_PATH,
  type IssueAnalysisTemplateDiagnostic,
} from '@/lib/report/issues/template'
import {
  getIssueAnalysisPptExportDiagnostic,
  type IssueAnalysisPptExportDiagnostic,
} from '@/lib/report/issues/export'

export interface EnsureIssueAnalysisActionResult {
  ok: boolean
  state: 'ready' | 'generated' | 'unavailable' | 'blocked'
  error?: string
  runId?: string
  analysis?: IssueAnalysisReport
  preflight: IssueAnalysisPreflight | null
  template: IssueAnalysisTemplateDiagnostic
  pptExport: IssueAnalysisPptExportDiagnostic
}

const UNKNOWN_TEMPLATE: IssueAnalysisTemplateDiagnostic = {
  status: 'protected',
  code: 'TEMPLATE_PROTECTED',
  message: '이슈 분석서 템플릿 상태를 확인하지 못했습니다.',
  path: ISSUE_ANALYSIS_TEMPLATE_RELATIVE_PATH,
}

async function safeTemplateDiagnostic(): Promise<IssueAnalysisTemplateDiagnostic> {
  try {
    const diagnostic = await diagnoseIssueAnalysisTemplate()
    // 서버의 process.cwd 절대경로는 액션 페이로드로 노출하지 않는다.
    return { ...diagnostic, path: ISSUE_ANALYSIS_TEMPLATE_RELATIVE_PATH }
  } catch (error) {
    console.error(
      '[issue-analysis] 템플릿 진단 실패:',
      error instanceof Error ? error.message : error,
    )
    return UNKNOWN_TEMPLATE
  }
}

function fromEnsureResult(
  result: EnsureIssueAnalysisResult,
  preflight: IssueAnalysisPreflight,
  template: IssueAnalysisTemplateDiagnostic,
): EnsureIssueAnalysisActionResult {
  const pptExport = getIssueAnalysisPptExportDiagnostic()
  if (!('reason' in result)) {
    return {
      ok: true,
      state: result.state,
      runId: result.runId,
      analysis: result.analysis,
      preflight,
      template,
      pptExport,
    }
  }
  return {
    ok: false,
    state: result.reason === 'preflight_failed' ? 'blocked' : 'unavailable',
    error: result.error,
    preflight,
    template,
    pptExport,
  }
}

/**
 * 이슈 분석서 데이터 생성(버튼 온디맨드 전용).
 *
 * 프로젝트 멤버 확인 뒤 서버에서 원본을 엄격 재로드한다. 클라이언트가 보낸 이슈나 사전
 * 점검 결과는 신뢰하지 않는다. 템플릿이 아직 missing/protected여도 분석 JSON은 생성할 수
 * 있으며, 실제 PPT 렌더링 가능 여부는 template 진단으로 UI에 별도 전달한다.
 */
export async function ensureIssueAnalysisAction(
  projectId: string,
  megaFilter: IssueMegaFilter = 'all',
): Promise<EnsureIssueAnalysisActionResult> {
  const guard = await requireProjectMember(projectId)
  const template = await safeTemplateDiagnostic()
  const pptExport = getIssueAnalysisPptExportDiagnostic()
  if (!guard.ok) {
    return {
      ok: false,
      state: 'unavailable',
      error: guard.error,
      preflight: null,
      template,
      pptExport,
    }
  }
  if (megaFilter !== 'all' && !isIssueMegaCode(megaFilter)) {
    return {
      ok: false,
      state: 'unavailable',
      error: '잘못된 Mega 분석 범위입니다.',
      preflight: null,
      template,
      pptExport,
    }
  }

  let issues
  try {
    issues = await loadIssueAnalysisIssues(
      projectId,
      megaFilter === 'all' ? undefined : megaFilter,
    )
    if (
      megaFilter !== 'all'
      && issues.some(issue => issue.megaCode !== megaFilter)
    ) {
      throw new Error('[issue-analysis] Mega 분석 범위 정합성이 올바르지 않습니다.')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '이슈 분석 데이터를 불러오지 못했습니다.'
    console.error('[issue-analysis] 엄격 로더 실패:', message)
    return {
      ok: false,
      state: 'unavailable',
      error: message,
      preflight: null,
      template,
      pptExport,
    }
  }

  const preflight = buildIssueAnalysisPreflight(issues)
  if (preflight.totalCount === 0) {
    return {
      ok: false,
      state: 'blocked',
      error: '분석할 이슈가 없습니다.',
      preflight,
      template,
      pptExport,
    }
  }
  if (preflight.blockedCount > 0) {
    return {
      ok: false,
      state: 'blocked',
      error: `필수 분석 정보가 누락된 이슈가 ${preflight.blockedCount}건 있습니다.`,
      preflight,
      template,
      pptExport,
    }
  }

  try {
    const result = await ensureIssueAnalysis(projectId, issues, guard.actor.userId)
    return fromEnsureResult(result, preflight, template)
  } catch (error) {
    // ensure 계층은 정상적으로는 never-throw 결과를 주지만, 예기치 않은 프로그래밍/IO
    // 예외도 액션 경계를 넘어 Next 오류 페이지로 번지지 않게 명시적 unavailable로 만든다.
    const message = error instanceof Error ? error.message : '이슈 분석 생성에 실패했습니다.'
    console.error('[issue-analysis] ensure 실패:', message)
    return {
      ok: false,
      state: 'unavailable',
      error: message,
      preflight,
      template,
      pptExport,
    }
  }
}
