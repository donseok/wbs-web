import { BOT_READ_CAPABILITIES, type BotReadCapability } from '@/lib/ai/tools/types'
import type { SupabaseServerClient } from '@/lib/repositories/supabase/common'

/**
 * 세션 사용자의 접근 범위 확정 — 설계 §19의 공유 authz 경계.
 * 챗봇 외 기능도 재사용할 수 있도록 ai/chat 밖에 둔다(리뷰 L-1).
 * MySQL 전환 시 이 Resolver 어댑터만 교체한다.
 */
export interface AccessScope {
  allowedProjectIds: string[]
  capabilities: readonly BotReadCapability[]
}

export type AccessScopeResolution =
  | { ok: true; scope: AccessScope }
  | { ok: false; code: 'ACCESS_SCOPE_UNAVAILABLE'; retryable: boolean; detail?: string }

/** Storage-neutral boundary; a MySQL adapter can implement the same contract. */
export interface AccessScopeResolver {
  resolve(userId: string): Promise<AccessScopeResolution>
}

/** Supabase/RLS adapter. A healthy zero-row result stays distinct from a failed scope lookup. */
export function createSupabaseAccessScopeResolver(
  client: SupabaseServerClient,
): AccessScopeResolver {
  return {
    async resolve() {
      const { data, error } = await client.from('projects').select('id')
      if (error || !data) {
        return {
          ok: false,
          code: 'ACCESS_SCOPE_UNAVAILABLE',
          retryable: true,
          ...(error?.message ? { detail: error.message } : {}),
        }
      }
      const allowedProjectIds = [...new Set(data.flatMap(project =>
        typeof project.id === 'string' && project.id.length > 0 ? [project.id] : [],
      ))]
      return {
        ok: true,
        scope: { allowedProjectIds, capabilities: [...BOT_READ_CAPABILITIES] },
      }
    },
  }
}
