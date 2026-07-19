export type KnowledgeFreshnessReason =
  | 'fresh'
  | 'missing_index_time'
  | 'invalid_index_time'
  | 'invalid_source_update_time'
  | 'missing_content_hash'
  | 'source_newer_than_index'
  | 'content_hash_mismatch'
  | 'index_age_exceeded'

export interface KnowledgeFreshnessInput {
  indexedAt?: string | null
  indexedContentHash?: string | null
  currentSourceUpdatedAt?: string | null
  currentContentHash?: string | null
}

export interface KnowledgeFreshnessPolicy {
  now?: Date
  maxAgeMs?: number | null
}

export interface KnowledgeFreshnessAssessment {
  stale: boolean
  reason: KnowledgeFreshnessReason
}

type ParsedTimestamp =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'valid'; time: number }

const ISO_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/

function parseTimestamp(value: string | null | undefined): ParsedTimestamp {
  if (value === null || value === undefined || value === '') return { kind: 'missing' }
  if (typeof value !== 'string') return { kind: 'invalid' }

  const match = ISO_TIMESTAMP_RE.exec(value)
  if (!match) return { kind: 'invalid' }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match
  const [year, month, day, hour, minute, second] = [
    yearText, monthText, dayText, hourText, minuteText, secondText,
  ].map(Number)

  if (year < 1 || year > 9999) return { kind: 'invalid' }
  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month - 1, day)
  calendar.setUTCHours(0, 0, 0, 0)
  if (calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
    || hour > 23
    || minute > 59
    || second > 59) return { kind: 'invalid' }

  if (zone !== 'Z') {
    const [offsetHour, offsetMinute] = zone.slice(1).split(':').map(Number)
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      return { kind: 'invalid' }
    }
  }

  const time = Date.parse(value)
  return Number.isFinite(time) ? { kind: 'valid', time } : { kind: 'invalid' }
}

/** Shared storage-boundary validator for source/index timestamps. */
export function isValidKnowledgeTimestamp(value: string): boolean {
  return parseTimestamp(value).kind === 'valid'
}

/** Pure stale check; callers decide whether to exclude or label stale evidence. */
export function assessKnowledgeFreshness(
  input: KnowledgeFreshnessInput,
  policy: KnowledgeFreshnessPolicy = {},
): KnowledgeFreshnessAssessment {
  const indexedTimestamp = parseTimestamp(input.indexedAt)
  if (indexedTimestamp.kind === 'missing') return { stale: true, reason: 'missing_index_time' }
  if (indexedTimestamp.kind === 'invalid') return { stale: true, reason: 'invalid_index_time' }
  const indexedAt = indexedTimestamp.time

  const sourceTimestamp = parseTimestamp(input.currentSourceUpdatedAt)
  if (sourceTimestamp.kind === 'invalid') {
    return { stale: true, reason: 'invalid_source_update_time' }
  }

  if (input.currentContentHash && !input.indexedContentHash) {
    return { stale: true, reason: 'missing_content_hash' }
  }

  if (
    input.currentContentHash
    && input.indexedContentHash
    && input.currentContentHash !== input.indexedContentHash
  ) {
    return { stale: true, reason: 'content_hash_mismatch' }
  }

  if (sourceTimestamp.kind === 'valid' && sourceTimestamp.time > indexedAt) {
    return { stale: true, reason: 'source_newer_than_index' }
  }

  if (policy.maxAgeMs != null && policy.maxAgeMs >= 0) {
    const now = (policy.now ?? new Date()).getTime()
    if (now - indexedAt > policy.maxAgeMs) {
      return { stale: true, reason: 'index_age_exceeded' }
    }
  }

  return { stale: false, reason: 'fresh' }
}
