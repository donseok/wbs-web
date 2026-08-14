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

// 회의록 색인 본문은 `# 회의록 {제목}\n일자: …\n팀: …\n{본문}` 형태로 시작한다
// (src/lib/ai/index/content.ts 의 loadMinute 참조). 매칭 청크가 동점이면 이 머리말 청크가
// 이겨서 스니펫이 전부 메타데이터로 채워지는 문제가 있었다 — 선두의 헤더·메타·수평선 줄만 걷어낸다.
// 운영 실측(2026-08-14): 청크가 "# 제목\n\n---" 처럼 헤더 뒤에 수평선만 남기고 끝나는
// 경우도 있다 — 이것도 걷어내야 "전부 메타뿐" 판정이 맞게 떨어진다.
const HEADER_LINE = /^#{1,6}(\s|$)/
const META_LINE = /^(일자|팀|참석자|참석|장소):/
const HR_LINE = /^(-{3,}|\*{3,})$/

function isLeadingSkippable(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return true
  return HEADER_LINE.test(trimmed) || META_LINE.test(trimmed) || HR_LINE.test(trimmed)
}

/**
 * 선두의 헤더·메타·수평선·빈 줄을 걷어낸다. 본문 중간의 헤더는 건드리지 않고 선두
 * 블록만 본다. 전부 걷어내지면 빈 문자열을 그대로 돌려준다(폴백 없음) — 폴백 여부는
 * 호출자(스니펫 표시는 원본 유지, 융합의 머리말 청크 판정은 그대로 버림)의 책임이다.
 */
export function stripLeadingMeta(content: string): string {
  const lines = content.split(/\r?\n/)
  let start = 0
  while (start < lines.length && isLeadingSkippable(lines[start])) start++
  return lines.slice(start).join('\n').trim()
}

const MIN_QUERY_TOKEN_CHARS = 2

/**
 * 검색 결과 스니펫 정제. `query` 를 주면 매칭 토큰 주변을 중심으로 창을 잘라
 * 관련 문장을 보여준다 — 청크 앞부분만 자르면 질의어가 청크 중간에 있을 때
 * 질문과 무관한 도입부만 노출되는 문제가 있었다(운영 실측: "내용이 부족하다").
 * 못 찾거나 query 가 없으면 기존처럼 앞부분을 자른다.
 */
export function snippetOf(content: string, maxChars = 200, query?: string): string {
  const collapse = (value: string) => value.trim().replace(/\s+/g, ' ')
  // 전부 걷어내 빈 문자열이 되면 원본을 접어 돌려준다 — 없는 것보다 헤더라도 보이는 게 낫다.
  const base = collapse(stripLeadingMeta(content)) || collapse(content)

  if (query) {
    const tokens = query.split(/\s+/).filter(token => token.length >= MIN_QUERY_TOKEN_CHARS)
    const lowerBase = base.toLowerCase()
    for (const token of tokens) {
      const matchIndex = lowerBase.indexOf(token.toLowerCase())
      if (matchIndex === -1) continue
      const half = Math.floor(maxChars / 2)
      const start = Math.max(0, matchIndex - half)
      const windowText = base.slice(start, start + maxChars)
      return start > 0 ? `…${windowText}` : windowText
    }
  }

  return base.length > maxChars ? base.slice(0, maxChars) : base
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
