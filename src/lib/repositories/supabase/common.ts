import type { createServerClient } from '@/lib/supabase/server'

export type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>

type ErrorLike = { code?: string | null; status?: number | null }

/** Schema/constraint failures do not become healthy by retrying the same read. */
export function isRetryableReadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true
  const { code, status } = error as ErrorLike
  if (typeof status === 'number' && status >= 500) return true
  if (typeof status === 'number' && status >= 400) return false
  if (typeof code !== 'string') return true
  if (/^(22|23|42)/.test(code)) return false
  if (code === 'PGRST100' || code === 'PGRST200' || code === 'PGRST204') return false
  return true
}

export function nestedOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}
