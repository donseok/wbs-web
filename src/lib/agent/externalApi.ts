import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import type { AdminClient } from '@/lib/minutes/externalApi'

/**
 * 에이전트 작업 루프 외부 API 공용 헬퍼 — 스펙 §3.1.
 * 회의록 API(src/lib/minutes/externalApi.ts) 패턴을 따르되 env 축(AGENT_API_*)만 다르다.
 * resolveUserByEmail/AdminClient 는 그 모듈에서 import 해 재사용한다(수정 금지).
 */
export function agentApiEnabled(): boolean {
  return process.env.AGENT_API_ENABLED === 'true' && !!process.env.AGENT_API_SECRET
}

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
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
  const header = req.headers.get('authorization')
  const provided = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
  if (!secretMatches(provided, process.env.AGENT_API_SECRET as string)) return apiUnauthorized()
  return null
}

/** 등록·enabled 프로젝트만 루프가 열린다(스펙 §1.1-2). 조회 실패는 404 로 위장하지 않고 throw. */
export async function requireAgentProject(admin: AdminClient, projectId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('agent_projects').select('project_id, enabled').eq('project_id', projectId).maybeSingle()
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
