/**
 * 검색 응답 → 화면 상태. 컴포넌트에서 떼어낸 이유는 이것이 이 화면의 유일한 분기 로직이고,
 * 리포의 UI 테스트 관용구(renderToStaticMarkup)로는 fetch 분기를 검증할 수 없기 때문이다.
 */

export interface SearchHit {
  domain: string
  entityType: string
  entityId: string
  title: string
  content: string
  href: string
  occurredOn: string | null
  score: number
  matchedBy: string[]
}

export type SearchViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; hits: SearchHit[]; degraded: boolean }
  | { kind: 'error' }

function isHit(value: unknown): value is SearchHit {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.domain === 'string'
    && typeof row.entityId === 'string'
    && typeof row.href === 'string'
}

export function toSearchViewState(
  response: { ok: boolean; status: number; body: unknown },
): SearchViewState {
  // 실패를 "결과 없음" 으로 위장하지 않는다(에러 처리 3원칙).
  if (!response.ok) return { kind: 'error' }

  const body = response.body
  if (typeof body !== 'object' || body === null) return { kind: 'error' }
  const results = (body as Record<string, unknown>).results
  if (!Array.isArray(results)) return { kind: 'error' }

  return {
    kind: 'done',
    hits: results.filter(isHit),
    degraded: (body as Record<string, unknown>).degraded === true,
  }
}
