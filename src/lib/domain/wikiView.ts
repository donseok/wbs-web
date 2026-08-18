// 위키 표시 계층의 단일 정본 — I/O 없는 순수 규칙.
// 상태 판정(현재 결정/열린 항목/상충)을 여기서만 정의해, 주제 상세·봇이
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
