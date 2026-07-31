import { NextRequest, NextResponse } from 'next/server'
import { getDisplayName } from '@/lib/auth'
import { requireProjectMember } from '@/lib/authz'
import { loadSavedIssueAnalysisRun } from '@/lib/data/issueAnalysis'
import { buildIssueAnalysisDeckPlan } from '@/lib/report/issues/deckPlan'
import {
  ISSUE_ANALYSIS_PPTX_MIME,
  IssueAnalysisPptRendererUnavailableError,
  buildIssueAnalysisFilename,
  getIssueAnalysisPptExportDiagnostic,
  renderIssueAnalysisPpt,
} from '@/lib/report/issues/export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function denyStatus(error: string): number {
  if (error === '로그인 필요') return 401
  return error === '권한 없음' ? 403 : 500
}
function jsonError(error: string, status: number, code?: string): NextResponse {
  return NextResponse.json(
    { error, ...(code ? { code } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * 저장된 AI 실행을 표준 PPT로 내보내는 읽기 전용 경계.
 *
 * projectId/runId만 URL에서 받고 분석 내용은 DB에서 다시 읽는다. 배포 렌더러가
 * 연결되지 않은 상태에서는 명시적 503을 반환해 빈 파일이나 유사 템플릿을 만들지 않는다.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const projectId = req.nextUrl.searchParams.get('projectId')?.trim() ?? ''
  const runId = req.nextUrl.searchParams.get('runId')?.trim() ?? ''
  if (!projectId || !runId) return jsonError('projectId와 runId가 필요합니다.', 400)

  const guard = await requireProjectMember(projectId)
  if (!guard.ok) return jsonError(guard.error, denyStatus(guard.error))

  const capability = getIssueAnalysisPptExportDiagnostic()
  if (capability.status !== 'ready') {
    return jsonError(capability.message, 503, capability.code)
  }

  try {
    const saved = await loadSavedIssueAnalysisRun(projectId, runId)
    if (!saved) return jsonError('저장된 이슈 분석 실행을 찾을 수 없습니다.', 404)
    const authorName = (await getDisplayName())?.trim() || '작성자'
    const plan = buildIssueAnalysisDeckPlan(saved.report, {
      projectName: saved.projectName,
      authorName,
      authorTeam: guard.actor.teamCode ?? '',
      generatedAt: saved.report.generatedAt,
    })
    const body = await renderIssueAnalysisPpt(plan)
    const filename = buildIssueAnalysisFilename(saved.projectName, saved.report.generatedAt)
    return new NextResponse(body as unknown as ArrayBuffer, {
      headers: {
        'Content-Type': ISSUE_ANALYSIS_PPTX_MIME,
        'Content-Disposition': `attachment; filename="issue-analysis.pptx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof IssueAnalysisPptRendererUnavailableError) {
      return jsonError(error.message, 503, error.code)
    }
    console.error(
      '[issue-analysis] PPT 다운로드 실패:',
      error instanceof Error ? error.message : error,
    )
    return jsonError('이슈 분석서 PPT를 생성하지 못했습니다.', 500)
  }
}
