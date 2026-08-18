/**
 * 검색 요청의 프로젝트 접근 판정 — 이 검색의 유일한 관문이다.
 *
 * ai_documents 의 RLS 는 `authenticated using (true)` 이고(0031:74-79)
 * match_ai_documents 도 authenticated 실행이 허용돼 있다. 즉 DB 는 프로젝트를
 * 막지 않는다. 비공개 프로젝트(0070)도 RLS 잠금이 아니라 앱 판정 하나뿐이라,
 * 여기서 막지 못하면 projectId 를 아는 로그인 사용자에게 회의록 본문이 샌다.
 */
export type SearchAccessDecision =
  | { ok: true; projectIds: string[] }
  | { ok: false; status: 403 | 503; reason: string }

type ScopeInput =
  | { ok: true; scope: { allowedProjectIds: string[] } }
  | { ok: false }

export function decideSearchAccess(
  requestedProjectId: string,
  scope: ScopeInput,
): SearchAccessDecision {
  // 스코프를 못 읽었으면 모르는 것이다. 모르면 닫는다.
  if (!scope.ok) return { ok: false, status: 503, reason: 'ACCESS_SCOPE_UNAVAILABLE' }

  const requested = requestedProjectId.trim()
  if (!requested) return { ok: false, status: 403, reason: 'PROJECT_REQUIRED' }

  // 빈 허용 목록은 "전체 허용" 이 아니라 "아무것도 허용 안 됨" 이다.
  if (!scope.scope.allowedProjectIds.includes(requested)) {
    return { ok: false, status: 403, reason: 'PROJECT_FORBIDDEN' }
  }

  // 요청 하나만 넘긴다. 클라이언트가 보낸 목록은 어디에도 쓰지 않는다.
  return { ok: true, projectIds: [requested] }
}
