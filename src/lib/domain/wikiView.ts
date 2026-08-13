// 위키 표시 계층의 단일 정본 — I/O 없는 순수 규칙.
// 상태 판정(현재 결정/열린 항목/상충)과 탐색기 필터를 여기서만 정의해, 홈·주제 상세·봇이
// 같은 항목을 서로 다르게 세지 않게 한다. 데이터 계층(lib/data/wiki)은 이 규칙을 재수출한다.

/** 항목이 닫힌 것으로 간주되는 lifecycle 값. LLM/과거 데이터의 동의어까지 포함한다. */
const CLOSED_STATES = new Set([
  'archived',
  'closed',
  'done',
  'resolved',
  'superseded',
  'withdrawn',
])

const NON_CURRENT_DECISION_STATES = new Set([
  'disputed',
  'on_hold',
  'proposed',
  'reversed',
  'superseded',
  'tentative',
  'withdrawn',
])

const CONFLICT_STATES = new Set([
  'conflict',
  'conflicted',
  'disputed',
])

const OPEN_KINDS = new Set(['action', 'question', 'risk'])
const KNOWLEDGE_KINDS = new Set(['fact', 'constraint', 'rationale'])

export function normalizedWikiState(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** 상태 판정에 필요한 최소 구조. lib/data/wiki의 WikiItem이 그대로 만족한다. */
export interface WikiViewSource {
  relation: string
  retractedAt?: string | null
  evidenceExcerpt?: string | null
}

export interface WikiViewItem {
  kind: string
  statement: string
  lifecycleState: string
  certainty: string
  decisionState: string | null
  ownerTeam: string | null
  dueDate: string | null
  updatedAt: string
  sources: WikiViewSource[]
}

/** 현재 유효한 결정인지 판정하는 표시 계층용 규칙. */
export function isActiveWikiDecision(item: WikiViewItem): boolean {
  if (item.kind !== 'decision') return false
  const lifecycle = normalizedWikiState(item.lifecycleState)
  if (CLOSED_STATES.has(lifecycle) || CONFLICT_STATES.has(lifecycle)) return false
  return !NON_CURRENT_DECISION_STATES.has(normalizedWikiState(item.decisionState))
}

/** 실행·질문·리스크 중 아직 닫히지 않은 항목인지 판정한다. */
export function isOpenWikiItem(item: WikiViewItem): boolean {
  if (!OPEN_KINDS.has(item.kind)) return false
  return !CLOSED_STATES.has(normalizedWikiState(item.lifecycleState))
}

/** 상태 또는 반대 근거가 있는 항목을 상충으로 센다. */
export function isConflictedWikiItem(item: WikiViewItem): boolean {
  if (
    CONFLICT_STATES.has(normalizedWikiState(item.lifecycleState))
    || CONFLICT_STATES.has(normalizedWikiState(item.decisionState))
  ) return true
  return item.sources.some((source) => (
    !source.retractedAt && normalizedWikiState(source.relation) === 'contradicts'
  ))
}

/**
 * 지금 유효한 사실·제약·근거. 잠정(certainty=tentative)이거나 닫힌 항목은 제외한다.
 * 제외된 잠정 항목은 사라지는 게 아니라 '논의 중' 뷰에서 그대로 노출된다.
 */
export function isCurrentWikiKnowledge(item: WikiViewItem): boolean {
  if (!KNOWLEDGE_KINDS.has(item.kind)) return false
  if (normalizedWikiState(item.certainty) !== 'explicit') return false
  return normalizedWikiState(item.lifecycleState) === 'active'
}

/**
 * 아직 확정되지 않은 채 살아 있는 항목(잠정 사실·제약, 제안/논의 중 결정).
 * 이 뷰가 없으면 잠정 지식과 미확정 결정이 어떤 화면에도 나타나지 않는다.
 */
export function isDiscussingWikiItem(item: WikiViewItem): boolean {
  if (CLOSED_STATES.has(normalizedWikiState(item.lifecycleState))) return false
  if (isConflictedWikiItem(item)) return false
  if (normalizedWikiState(item.certainty) === 'tentative') return true
  return item.kind === 'decision' && !isActiveWikiDecision(item)
}

/**
 * 사실·제약·근거 중 아직 현재 지식이 아닌 것(잠정이거나 상충·대체 상태).
 * 주제 상세에서 결정/현재 지식/열린 항목 어디에도 속하지 않는 항목을 남김없이 담는 그릇이며,
 * 이 그룹이 없으면 잠정 사실·제약이 조회는 되지만 어떤 화면에도 렌더되지 않는다.
 */
export function isUnsettledWikiKnowledge(item: WikiViewItem): boolean {
  if (isClosedByPersonWikiItem(item)) return false
  return KNOWLEDGE_KINDS.has(item.kind) && !isCurrentWikiKnowledge(item)
}

/** 사람이 숨긴 항목. 집계에서 빠지고 '숨김' 뷰에서만 보이며 되돌릴 수 있다. */
export function isArchivedWikiItem(item: WikiViewItem): boolean {
  return normalizedWikiState(item.lifecycleState) === 'archived'
}

/** 사람이 닫은 항목. '완료' 뷰에서만 보이며 다시 열 수 있다. */
export function isResolvedWikiItem(item: WikiViewItem): boolean {
  return normalizedWikiState(item.lifecycleState) === 'resolved'
}

/**
 * 사람이 닫거나 숨긴 항목. 현재 지식 목록·집계 어디에도 섞이면 안 되고, 전용 뷰에서만 보인다.
 * 전용 뷰가 없으면 되돌릴 수단이 사라져 한 번의 오클릭이 영구 삭제가 된다.
 */
export function isClosedByPersonWikiItem(item: WikiViewItem): boolean {
  return isArchivedWikiItem(item) || isResolvedWikiItem(item)
}

export const WIKI_VIEWS = [
  'all', 'decision', 'open', 'discussing', 'conflict', 'resolved', 'archived',
] as const
export type WikiView = (typeof WIKI_VIEWS)[number]

export function matchesWikiView(item: WikiViewItem, view: WikiView): boolean {
  if (view === 'archived') return isArchivedWikiItem(item)
  if (view === 'resolved') return isResolvedWikiItem(item)
  // 사람이 닫거나 숨긴 항목은 전용 뷰 밖 어떤 목록에도 섞이지 않는다.
  if (isClosedByPersonWikiItem(item)) return false
  switch (view) {
    case 'decision': return isActiveWikiDecision(item)
    case 'open': return isOpenWikiItem(item)
    case 'discussing': return isDiscussingWikiItem(item)
    case 'conflict': return isConflictedWikiItem(item)
    default: return true
  }
}

/** 탐색기 한 줄. 항목이 어느 주제에 속하는지 함께 보여야 검색 결과가 해석 가능하다. */
export interface WikiExplorerEntry extends WikiViewItem {
  id: string
  topicId: string
  topicTitle: string
}

export interface WikiExplorerFilter {
  view: WikiView
  kind: string | 'all'
  query: string
}

function haystack(entry: WikiExplorerEntry): string {
  return [
    entry.statement,
    entry.topicTitle,
    entry.ownerTeam ?? '',
    ...entry.sources.map((source) => source.evidenceExcerpt ?? ''),
  ].join('\n').toLowerCase()
}

/** 공백으로 나눈 모든 토큰을 포함해야 통과하는 AND 검색. */
export function matchesWikiQuery(entry: WikiExplorerEntry, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const text = haystack(entry)
  return tokens.every((token) => text.includes(token))
}

/**
 * 열린 항목은 기한 → 최근 변경순, 나머지는 최근 변경순.
 * 기한 없는 항목이 기한 있는 항목을 밀어내지 않게 기한 보유 항목을 먼저 놓는다.
 */
export function sortWikiEntries<T extends WikiExplorerEntry>(entries: T[], view: WikiView): T[] {
  const sorted = [...entries]
  if (view === 'open') {
    sorted.sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      return b.updatedAt.localeCompare(a.updatedAt)
    })
    return sorted
  }
  sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return sorted
}

export function filterWikiEntries<T extends WikiExplorerEntry>(
  entries: T[],
  filter: WikiExplorerFilter,
): T[] {
  const filtered = entries.filter((entry) => (
    matchesWikiView(entry, filter.view)
    && (filter.kind === 'all' || entry.kind === filter.kind)
    && matchesWikiQuery(entry, filter.query)
  ))
  return sortWikiEntries(filtered, filter.view)
}

/** 뷰 탭에 붙는 건수. 필터와 무관하게 전체 기준으로 세어 KPI와 어긋나지 않게 한다. */
export function countWikiViews(entries: WikiExplorerEntry[]): Record<WikiView, number> {
  const live = entries.filter((entry) => !isClosedByPersonWikiItem(entry))
  return {
    all: live.length,
    decision: live.filter(isActiveWikiDecision).length,
    open: live.filter(isOpenWikiItem).length,
    discussing: live.filter(isDiscussingWikiItem).length,
    conflict: live.filter(isConflictedWikiItem).length,
    resolved: entries.filter(isResolvedWikiItem).length,
    archived: entries.filter(isArchivedWikiItem).length,
  }
}

/** 주제 카드 검색 — 제목·문서 본문·문서 유형·담당팀·기존 유형을 토큰 AND 검색으로 본다. */
export function matchesWikiTopicQuery(
  topic: {
    title: string
    ownerTeam: string | null
    type: string
    bodyMd?: string | null
    documentKind?: string | null
  },
  query: string,
): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const text = [
    topic.title,
    topic.bodyMd ?? '',
    topic.documentKind ?? '',
    topic.ownerTeam ?? '',
    topic.type,
  ].join('\n').toLowerCase()
  return tokens.every((token) => text.includes(token))
}

export type WikiTopicTrustState = 'conflict' | 'review_due' | 'verified' | 'unverified'

export interface WikiTopicTrustInput {
  verifiedAt: string | null | undefined
  reviewDueAt: string | null | undefined
  hasConflict: boolean
  hasUnresolvedOutdatedFeedback: boolean
}

/**
 * 문서 신뢰 상태의 단일 정본. `verifiedAt`만 존재한다고 검증됨으로 표시하지 않는다.
 * 검토 기한이 미래이고 해결되지 않은 오래됨 신고·상충이 없어야만 verified다.
 */
export function getWikiTopicTrustState(
  input: WikiTopicTrustInput,
  nowMs = Date.now(),
): WikiTopicTrustState {
  if (input.hasConflict) return 'conflict'

  const reviewDueMs = input.reviewDueAt ? Date.parse(input.reviewDueAt) : Number.NaN
  const hasValidReviewDueAt = Number.isFinite(reviewDueMs)
  if (
    input.hasUnresolvedOutdatedFeedback
    || (hasValidReviewDueAt && reviewDueMs <= nowMs)
  ) return 'review_due'

  if (input.verifiedAt && hasValidReviewDueAt && reviewDueMs > nowMs) return 'verified'
  return 'unverified'
}

/**
 * 검색 결과 0건일 때 제시할 회복 경로.
 *
 * Baymard 실측: 이커머스 사이트 약 50%가 0건 화면에서 회복 경로를 주지 않아 이탈로
 * 이어지고, "철자를 확인하세요 / 더 넓은 단어를 쓰세요" 류의 **검색 팁은 명시적
 * 안티패턴**이다 — 사용자가 읽지도 적용하지도 않으며 오히려 떠날 이유를 준다. 권장은
 * 키워드를 하나씩 뺀 대안 쿼리를 **각각의 결과 건수와 함께** 제시하는 것이다(건수를
 * 같이 보여주는 이유: 눌렀다가 또 0건일까 봐 주저하기 때문).
 *
 * 검색은 공백 토큰 AND 이므로(matchesWikiQuery) 토큰을 빼는 것이 자연스러운 완화다.
 * 결과가 0건일 때만 의미가 있으므로 호출 측에서 그때만 부른다.
 */
export type WikiSearchFallbackKind = 'drop-filters' | 'drop-token'

export interface WikiSearchFallback {
  kind: WikiSearchFallbackKind
  /** 이 대안을 적용했을 때의 검색어. drop-filters 는 검색어를 그대로 둔다. */
  query: string
  /** drop-token 에서 빠진 토큰. drop-filters 는 빈 문자열. */
  droppedToken: string
  count: number
}

const FALLBACK_LIMIT = 3

export function wikiSearchFallbacks<T extends WikiExplorerEntry>(
  entries: T[],
  filter: WikiExplorerFilter,
): WikiSearchFallback[] {
  const tokens = filter.query.trim().split(/\s+/).filter(Boolean)
  const filtersActive = filter.view !== 'all' || filter.kind !== 'all'
  const fallbacks: WikiSearchFallback[] = []

  // 필터를 푸는 쪽이 검색어를 버리는 것보다 사용자 의도를 덜 훼손하므로 먼저 제안한다.
  if (filtersActive) {
    const count = filterWikiEntries(entries, { view: 'all', kind: 'all', query: filter.query }).length
    if (count > 0) {
      fallbacks.push({ kind: 'drop-filters', query: filter.query, droppedToken: '', count })
    }
  }

  // 토큰이 하나뿐이면 빼봐야 "전체"라 대안이 아니다.
  if (tokens.length >= 2) {
    const dropped = tokens.map((token, index) => {
      const query = tokens.filter((_, other) => other !== index).join(' ')
      return {
        kind: 'drop-token' as const,
        query,
        droppedToken: token,
        count: filterWikiEntries(entries, { ...filter, query }).length,
      }
    })
    fallbacks.push(
      ...dropped
        .filter((candidate) => candidate.count > 0)
        .sort((left, right) => right.count - left.count)
        .slice(0, FALLBACK_LIMIT),
    )
  }

  return fallbacks
}
