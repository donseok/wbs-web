import type { RepositoryResult } from '@/lib/repositories/types'
import type {
  BotReadCapability,
  ToolExecutionContext,
  ToolExecutionResult,
} from './types'

export const DEFAULT_RESULT_LIMIT = 20
export const MAX_RESULT_LIMIT = 50

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readRequiredString(
  value: unknown,
  maxLength = 256,
): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : null
}

export function readOptionalString(
  value: unknown,
  maxLength = 500,
): string | null | undefined {
  if (value === undefined || value === null) return undefined
  return readRequiredString(value, maxLength)
}

export function readLimit(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_RESULT_LIMIT
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null
  return Math.min(value, MAX_RESULT_LIMIT)
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

export function validDateRange(from: string, to: string, maxDays = 366): boolean {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return false
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return (end - start) / 86_400_000 <= maxDays
}

export function todayInSeoul(now: string): string {
  const parsed = new Date(now)
  const safe = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(safe)
}

export function internalProjectHref(projectId: string, suffix: string): string {
  return `/p/${encodeURIComponent(projectId)}/${suffix}`
}

export function checkProjectAccess(
  context: ToolExecutionContext,
  projectId: string,
  capability: BotReadCapability,
): ToolExecutionResult<never> | null {
  if (
    !context.userId ||
    !context.capabilities.includes(capability) ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    return {
      ok: false,
      error: {
        code: 'ACCESS_DENIED',
        message: '요청한 프로젝트 데이터에 접근할 수 없습니다.',
        retryable: false,
      },
    }
  }
  return null
}

export function invalidArgument(message = '도구 인자가 올바르지 않습니다.'): ToolExecutionResult<never> {
  return { ok: false, error: { code: 'INVALID_ARGUMENT', message, retryable: false } }
}

export function repositoryFailure<T>(
  result: Extract<RepositoryResult<T>, { ok: false }>,
): ToolExecutionResult<never> {
  return {
    ok: false,
    error: {
      code: 'DATA_SOURCE_ERROR',
      message: '데이터를 조회하지 못했습니다.',
      retryable: result.retryable,
      repositoryErrorCode: result.errorCode,
    },
  }
}

/** A repository response that widens its requested scope is never partially trusted. */
export function repositoryScopeViolation(): ToolExecutionResult<never> {
  return {
    ok: false,
    error: {
      code: 'DATA_SOURCE_ERROR',
      message: '조회 결과의 프로젝트 범위를 안전하게 검증하지 못했습니다.',
      retryable: false,
    },
  }
}

export function shortExcerpt(...values: Array<string | null | undefined>): string | undefined {
  const text = values.filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > 300 ? `${text.slice(0, 297)}…` : text
}
