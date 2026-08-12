'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { agentApiEnabled } from '@/lib/agent/externalApi'
import { generateAgentToken } from '@/lib/agent/token'
import { isUuidLike } from '@/lib/domain/agentWork'

/**
 * PAT 발급·관리 — 계약 v2.0. 발급도 킬스위치(AGENT_API_ENABLED) 뒤(§2.1).
 * 자율 발급은 읽기·claim 스코프 한정 — work:report 는 관리자 발급 경로(미결 ①) 도입 전까지 거부.
 * agent_runners 는 RLS 정책 0 — 이 액션이 유일한 관문이다(fail-closed).
 */

const SELF_ISSUE_SCOPES = new Set(['work:read', 'work:claim'])
const MAX_EXPIRES_DAYS = 180
const NAME_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣 ._-]{0,63}$/

async function sessionUserId(): Promise<string | null> {
  const sb = await createServerClient()
  const { data, error } = await sb.auth.getUser()
  if (error || !data?.user) return null
  return data.user.id
}

export async function createAgentToken(input: {
  name: string; projectId: string | null; scopes: string[]; expiresDays: number
}): Promise<{ ok: true; token: string; prefix: string } | { ok: false; error: string }> {
  if (!agentApiEnabled()) return { ok: false, error: '에이전트 API가 꺼져 있어 발급할 수 없습니다.' }
  const uid = await sessionUserId()
  if (!uid) return { ok: false, error: '로그인이 필요합니다.' }
  const name = input.name.trim()
  if (!NAME_RE.test(name)) return { ok: false, error: '이름 형식이 올바르지 않습니다(64자 이내).' }
  if (input.projectId !== null && !isUuidLike(input.projectId)) return { ok: false, error: '잘못된 프로젝트입니다.' }
  if (input.scopes.length === 0) return { ok: false, error: '스코프를 1개 이상 선택하세요.' }
  for (const s of input.scopes) {
    if (!SELF_ISSUE_SCOPES.has(s)) {
      return { ok: false, error: `${s} 스코프는 자율 발급할 수 없습니다(관리자 발급 대상 — 미결 ①).` }
    }
  }
  const days = Math.trunc(input.expiresDays)
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRES_DAYS) {
    return { ok: false, error: `만료는 1~${MAX_EXPIRES_DAYS}일입니다.` }
  }

  const { token, prefix, hash } = generateAgentToken()
  const admin = createAdminClient()
  const { data, error } = await admin.from('agent_runners').insert({
    name, kind: 'user_pat', owner_user_id: uid, token_prefix: prefix, token_hash: hash,
    project_id: input.projectId, scopes: input.scopes,
    expires_at: new Date(Date.now() + days * 86400_000).toISOString(), created_by: uid,
  }).select('id')
  if (error) {
    // unique(owner_user_id, name) 충돌 등 — DB 메시지를 위장하지 않는다(표시=로깅).
    return { ok: false, error: `발급 실패: ${error.message}` }
  }
  if (!data || data.length === 0) return { ok: false, error: '발급 실패(0행)' }
  revalidatePath('/account')
  return { ok: true, token, prefix } // 평문은 이 응답이 유일하다 — 저장·로깅 금지.
}

export async function revokeAgentToken(runnerId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isUuidLike(runnerId)) return { ok: false, error: '잘못된 요청입니다.' }
  const uid = await sessionUserId()
  if (!uid) return { ok: false, error: '로그인이 필요합니다.' }
  const admin = createAdminClient()
  const { data, error } = await admin.from('agent_runners')
    .update({ revoked_at: new Date().toISOString(), enabled: false })
    .eq('id', runnerId).eq('owner_user_id', uid) // 본인 소유만 — 소유자 한정이 곧 권한 판정
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: '대상 토큰이 없습니다.' }
  revalidatePath('/account')
  return { ok: true }
}

export async function listMyAgentTokens(): Promise<
  | { ok: true; tokens: Array<{ id: string; name: string; token_prefix: string; scopes: string[]; project_id: string | null; expires_at: string; revoked_at: string | null; last_seen_at: string | null }> }
  | { ok: false; error: string }
> {
  const uid = await sessionUserId()
  if (!uid) return { ok: false, error: '로그인이 필요합니다.' }
  const admin = createAdminClient()
  // token_hash 는 어떤 경로로도 반환하지 않는다.
  const { data, error } = await admin.from('agent_runners')
    .select('id, name, token_prefix, scopes, project_id, expires_at, revoked_at, last_seen_at')
    .eq('owner_user_id', uid).order('created_at', { ascending: false })
  if (error) return { ok: false, error: error.message }
  return { ok: true, tokens: (data ?? []) as never }
}
