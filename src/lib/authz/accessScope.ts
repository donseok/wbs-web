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
    async resolve(userId) {
      const [projRes, rolesRes, memRes] = await Promise.all([
        client.from('projects').select('id, is_private'),
        client.from('project_roles').select('project_id').eq('user_id', userId),
        client.from('memberships').select('is_superuser').eq('user_id', userId).maybeSingle(),
      ])
      if (projRes.error || !projRes.data) {
        return {
          ok: false,
          code: 'ACCESS_SCOPE_UNAVAILABLE',
          retryable: true,
          ...(projRes.error?.message ? { detail: projRes.error.message } : {}),
        }
      }
      // 비공개 프로젝트(0070)는 역할 보유자·슈퍼유저에게만 스코프에 넣는다 — 목록에선
      // 숨겼는데 챗봇이 답하면 숨김이 무색해진다. 역할·슈퍼유저 조회가 실패하면 비공개만
      // 제외하고 진행한다(fail-closed) — 스코프 전체를 죽이면 공개 프로젝트 질문까지 막힌다.
      if (rolesRes.error) console.error('[accessScope] 프로젝트 역할 조회 실패 — 비공개 제외로 진행:', rolesRes.error.message)
      if (memRes.error) console.error('[accessScope] 멤버십 조회 실패 — 비공개 제외로 진행:', memRes.error.message)
      const isSuperuser = Boolean(memRes.data?.is_superuser)
      const roleProjectIds = new Set((rolesRes.data ?? []).map(r => r.project_id as string))
      const allowedProjectIds = [...new Set(projRes.data.flatMap(project =>
        typeof project.id === 'string' && project.id.length > 0
          && (!project.is_private || isSuperuser || roleProjectIds.has(project.id))
          ? [project.id] : [],
      ))]
      return {
        ok: true,
        scope: { allowedProjectIds, capabilities: [...BOT_READ_CAPABILITIES] },
      }
    },
  }
}
