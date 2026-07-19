import {
  MAX_INDEX_JOB_ATTEMPTS,
  type IndexJob,
  type IndexJobRetryUpdate,
  type IndexMutation,
} from './types'

export const INDEX_JOB_BASE_BACKOFF_MS = 30_000
export const INDEX_JOB_MAX_BACKOFF_MS = 30 * 60_000

export function indexJobKey(mutation: Pick<IndexMutation, 'projectId' | 'domain' | 'entityType' | 'entityId'>): string {
  return ['v1', mutation.projectId ?? 'global', mutation.domain, mutation.entityType, mutation.entityId]
    .map(value => encodeURIComponent(value))
    .join(':')
}

export function indexJobBackoffMs(
  attempt: number,
  baseMs = INDEX_JOB_BASE_BACKOFF_MS,
  maxMs = INDEX_JOB_MAX_BACKOFF_MS,
): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt))
  return Math.min(maxMs, baseMs * (2 ** (normalizedAttempt - 1)))
}

/** Only a diagnostic code crosses the queue boundary; raw errors/bodies are discarded. */
export function safeIndexJobErrorCode(value: string): string {
  const normalized = value.trim().toUpperCase()
  return /^[A-Z][A-Z0-9_.-]{0,79}$/.test(normalized) ? normalized : 'INDEX_JOB_FAILED'
}

export interface IndexJobGenerationCheck {
  claimedGeneration: number
  currentGeneration: number
}

export function planIndexJobFailure(
  job: Pick<IndexJob, 'attempts'>,
  safeErrorCode: string,
  now = new Date(),
  generation?: IndexJobGenerationCheck,
): IndexJobRetryUpdate {
  // generation 불일치 = 처리 중 같은 job_key에 새 변경이 enqueue됨. 이 실패는 구세대
  // 콘텐츠의 것이므로 attempts를 소모하지 않고 즉시 pending으로 되돌려 최신 세대를 재처리한다.
  if (generation && generation.claimedGeneration !== generation.currentGeneration) {
    return {
      status: 'pending',
      attempts: Math.max(0, Math.floor(job.attempts)),
      runAfter: now.toISOString(),
      lockedAt: null,
      lastError: safeIndexJobErrorCode(safeErrorCode),
    }
  }
  const attempts = Math.max(0, Math.floor(job.attempts)) + 1
  const deadLetter = attempts >= MAX_INDEX_JOB_ATTEMPTS
  return {
    status: deadLetter ? 'dead_letter' : 'pending',
    attempts,
    runAfter: new Date(now.getTime() + (deadLetter ? 0 : indexJobBackoffMs(attempts))).toISOString(),
    lockedAt: null,
    lastError: safeIndexJobErrorCode(safeErrorCode),
  }
}

const SENSITIVE_PAYLOAD_KEY = /(content|body|text|transcript|note|email|token|secret|password|api.?key)/i
const PAYLOAD_KEY = /^[A-Za-z0-9_.-]{1,64}$/

export function isSafeIndexJobPayload(payload: IndexMutation['payload']): boolean {
  if (!payload) return true
  if (typeof payload !== 'object' || Array.isArray(payload)) return false
  const entries = Object.entries(payload)
  if (entries.length > 24) return false
  return entries.every(([key, value]) => {
    const hashMetadata = /hash$/i.test(key) || /_hash$/i.test(key)
    if (
      !PAYLOAD_KEY.test(key)
      || key === '__proto__'
      || key === 'constructor'
      || key === 'prototype'
      || (SENSITIVE_PAYLOAD_KEY.test(key) && !hashMetadata)
    ) return false
    if (typeof value === 'string') return value.length <= 256
    if (typeof value === 'number') return Number.isFinite(value)
    return value == null || typeof value === 'boolean'
  })
}
