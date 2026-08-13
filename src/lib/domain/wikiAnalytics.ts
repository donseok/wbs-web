/**
 * Wiki 제품 이벤트의 단일 어휘.
 *
 * 질문 원문이나 문서 본문은 사용 로그에 절대 싣지 않는다. 이벤트에는 성공 여부와
 * 결과 개수처럼 제품 흐름을 개선하는 데 필요한 작은 수치만 남긴다.
 */
export const WIKI_ANALYTICS_EVENTS = [
  'wiki_ask_submitted',
  'wiki_ask_answered',
  'wiki_ask_no_answer',
  'wiki_ask_failed',
  'wiki_search',
  'wiki_topic_opened',
  'wiki_source_opened',
  'wiki_document_created',
  'wiki_document_saved',
  'wiki_document_verified',
  'wiki_question_created',
  'wiki_feedback_helpful',
  'wiki_feedback_outdated',
] as const

export type WikiAnalyticsEvent = (typeof WIKI_ANALYTICS_EVENTS)[number]

const EVENT_SET = new Set<string>(WIKI_ANALYTICS_EVENTS)
const METADATA_KEYS = new Set([
  'source',
  'source_count',
  'result_count',
  'query_length',
  'grounded',
  'truncated',
  'fallback',
  'stage',
  'document_kind',
  'review_days',
  'domain',
  'status',
])

export function isWikiAnalyticsEvent(value: unknown): value is WikiAnalyticsEvent {
  return typeof value === 'string' && EVENT_SET.has(value)
}

/** 개인정보·본문 유입을 막는 값 전용 metadata 정규화. */
export function normalizeWikiAnalyticsMetadata(
  value: unknown,
): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!METADATA_KEYS.has(key)) continue
    if (typeof raw === 'boolean' || raw === null) out[key] = raw
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw
    else if (typeof raw === 'string' && raw.length <= 80) out[key] = raw
    if (Object.keys(out).length >= 12) break
  }
  return out
}
