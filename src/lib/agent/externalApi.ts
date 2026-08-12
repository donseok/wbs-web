import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { parsePatPrefix, tokenUsable } from '@/lib/domain/agentToken'
import { hashMatches } from '@/lib/agent/token'

/**
 * 에이전트 작업 루프 외부 API 공용 헬퍼 — 스펙 §3.1.
 * 회의록 API(src/lib/minutes/externalApi.ts) 패턴을 따르되 env 축(AGENT_API_*)만 다르다.
 * resolveUserByEmail/AdminClient 는 그 모듈에서 import 해 재사용한다(수정 금지).
 */
/** 킬스위치는 AGENT_API_ENABLED 단독(계약 v2.0 §인증). 시크릿 존재는 레거시 분기 조건일 뿐이다. */
export function agentApiEnabled(): boolean {
  return process.env.AGENT_API_ENABLED === 'true'
}

/** 에이전트 API 시크릿 검증 — 길이 노출과 타이밍 채널을 피하기 위해 해시 후 상수시간 비교한다. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export const apiNotFound = () =>
  NextResponse.json({ error: 'Not Found' }, { status: 404 })
export const apiUnauthorized = () =>
  NextResponse.json({ error: '인증이 필요합니다.', code: 'unauthorized' }, { status: 401 })
export const apiBadRequest = (error: string) =>
  NextResponse.json({ error, code: 'validation_failed' }, { status: 400 })
export const apiFail = (status: number, code: string, error: string) =>
  NextResponse.json({ error, code }, { status })
export const apiInternalError = (error = '서버 오류가 발생했습니다.') =>
  NextResponse.json({ error, code: 'internal_error' }, { status: 500 })

/** 전 라우트 공통 선두 게이트 — 닫힘=404(존재 은닉), 시크릿 불일치=401, 통과=null. */
export function gateAgentApi(req: Request): NextResponse | null {
  if (!agentApiEnabled()) return apiNotFound()
  if (!process.env.AGENT_API_SECRET) return apiUnauthorized() // 레거시 분기 없음 — PAT 는 리졸버 라우트만
  const header = req.headers.get('authorization')
  const provided = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
  if (!secretMatches(provided, process.env.AGENT_API_SECRET)) return apiUnauthorized()
  return null
}

/** 등록·enabled 프로젝트만 루프가 열린다(스펙 §1.1-2). 조회 실패는 404 로 위장하지 않고 throw. */
export async function requireAgentProject(admin: AdminClient, projectId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('agent_projects').select('enabled').eq('project_id', projectId).maybeSingle()
  if (error) throw new Error(`agent_projects 조회 실패: ${error.message}`)
  return !!data && (data as { enabled: boolean }).enabled === true
}

/**
 * user_email 계정이 해당 프로젝트 멤버 이상인지 — 기존 3단 권한 축 그대로(스펙 §3.1).
 * 보안 가드이므로 조회 실패는 false(fail-closed). memberships.role 은 deprecated(0054) — 읽지 않는다.
 */
export async function isAgentProjectMember(
  admin: AdminClient, userId: string, projectId: string,
): Promise<boolean> {
  const { data: mem, error: memErr } = await admin
    .from('memberships').select('is_superuser').eq('user_id', userId).maybeSingle()
  if (memErr) {
    console.error('[agent-api] 등급 조회 실패(거절):', memErr.message)
    return false
  }
  if ((mem as { is_superuser?: boolean } | null)?.is_superuser) return true
  const { data: roles, error: roleErr } = await admin
    .from('project_roles').select('role').eq('user_id', userId).eq('project_id', projectId).limit(1)
  if (roleErr || !roles) {
    console.error('[agent-api] 프로젝트 역할 조회 실패(거절):', roleErr?.message)
    return false
  }
  return roles.length > 0
}

export const AGENT_CONTRACT_VERSION = '2.0'

export type AgentPrincipal =
  | { kind: 'legacy' }
  | {
      kind: 'pat'; runnerId: string; userId: string; userEmail: string
      scopes: string[]; projectId: string | null; runnerKind: 'user_pat' | 'runner'
      tokenExpiresAt: string
    }

type RunnerRow = {
  id: string; kind: 'user_pat' | 'runner'; owner_user_id: string
  token_prefix: string; token_hash: string; project_id: string | null
  scopes: string[]; enabled: boolean; revoked_at: string | null; expires_at: string
}

/**
 * 인증 리졸버 — 계약 v2.0 §인증. 반환이 NextResponse 면 그대로 응답한다.
 * 검사 순서(enabled→revoked→expires→hash)는 계약 고정. 실패 사유는 응답에서 구분하지 않는다(전부 401).
 */
export async function resolveAgentPrincipal(
  req: Request, admin: AdminClient,
): Promise<AgentPrincipal | NextResponse> {
  if (!agentApiEnabled()) return apiNotFound()
  const header = req.headers.get('authorization')
  const bearer = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
  if (!bearer) return apiUnauthorized()

  const secret = process.env.AGENT_API_SECRET
  if (secret && secretMatches(bearer, secret)) return { kind: 'legacy' }

  const prefix = parsePatPrefix(bearer)
  if (!prefix) return apiUnauthorized()
  const { data, error } = await admin
    .from('agent_runners')
    .select('id, kind, owner_user_id, token_prefix, token_hash, project_id, scopes, enabled, revoked_at, expires_at')
    .eq('token_prefix', prefix).maybeSingle()
  if (error) {
    // 보안 가드 조회 실패 = 거부(fail-closed). 위장하지 않고 로깅.
    console.error('[agent-api] PAT 조회 실패(거절):', error.message)
    return apiUnauthorized()
  }
  if (!data) return apiUnauthorized()
  const row = data as RunnerRow
  if (!tokenUsable(row).ok) return apiUnauthorized()
  if (!hashMatches(bearer, row.token_hash)) return apiUnauthorized()

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(row.owner_user_id)
  if (userErr || !userData?.user?.email) {
    console.error('[agent-api] PAT 소유자 조회 실패(거절):', userErr?.message ?? '이메일 없음')
    return apiUnauthorized()
  }
  // last_seen_at 은 best-effort — 실패해도 요청은 통과시키되 로깅.
  const { error: seenErr } = await admin
    .from('agent_runners').update({ last_seen_at: new Date().toISOString() }).eq('id', row.id)
  if (seenErr) console.error('[agent-api] last_seen_at 갱신 실패:', seenErr.message)

  return {
    kind: 'pat', runnerId: row.id, userId: row.owner_user_id,
    userEmail: userData.user.email.toLowerCase(), scopes: row.scopes ?? [],
    projectId: row.project_id, runnerKind: row.kind, tokenExpiresAt: row.expires_at,
  }
}

/** 스코프 강제 — legacy 는 스코프 개념이 없다(v1 동작). 부족 시 403 insufficient_scope. */
export function requireScope(
  p: AgentPrincipal, scope: 'work:read' | 'work:claim' | 'work:report',
): NextResponse | null {
  if (p.kind === 'legacy') return null
  if (p.scopes.includes(scope)) return null
  return apiFail(403, 'insufficient_scope', `이 작업에는 ${scope} 스코프가 필요합니다.`)
}

/** PAT 의 project_id 한정 — null 이면 전 프로젝트(멤버십 게이트는 별도). */
export function patProjectAllowed(p: AgentPrincipal, projectId: string): boolean {
  if (p.kind === 'legacy') return true
  return p.projectId === null || p.projectId === projectId
}
