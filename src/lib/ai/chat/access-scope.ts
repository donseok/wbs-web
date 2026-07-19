import type { ChatRequestV2 } from './protocol'

export type ChatProjectScopeResult =
  | { ok: true; projectId: string | null }
  | { ok: false; code: 'PROJECT_CONTEXT_MISMATCH' | 'PROJECT_ACCESS_DENIED'; status: 400 | 403; message: string }

/** Client project IDs are hints; this only accepts them after intersection with the server-resolved scope. */
export function validateChatProjectScope(
  request: ChatRequestV2,
  allowedProjectIds: readonly string[],
): ChatProjectScopeResult {
  const legacyHint = request.projectId
  const pageHint = request.pageContext?.projectId ?? null
  // typed PageContextV1.selectedProjectId 계약(리뷰 M-4). sanitize가 공백/형식을 이미 걸렀다.
  const selectedProjectValue = request.pageContext?.selectedProjectId
  const selectedProjectHint = typeof selectedProjectValue === 'string'
    && selectedProjectValue.toLowerCase() !== 'all'
    ? selectedProjectValue
    : null
  const hints = [legacyHint, pageHint, selectedProjectHint].filter((id): id is string => !!id)
  if (new Set(hints).size > 1) {
    return {
      ok: false,
      code: 'PROJECT_CONTEXT_MISMATCH',
      status: 400,
      message: '프로젝트 문맥이 일치하지 않습니다.',
    }
  }
  const projectId = pageHint ?? legacyHint ?? selectedProjectHint
  if (projectId && !allowedProjectIds.includes(projectId)) {
    return {
      ok: false,
      code: 'PROJECT_ACCESS_DENIED',
      status: 403,
      message: '해당 프로젝트에 접근할 수 없습니다.',
    }
  }
  return { ok: true, projectId }
}
