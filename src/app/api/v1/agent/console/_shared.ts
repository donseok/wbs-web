// 콘솔 로컬 API(poll·ack·screen) 공용 — 계약 api-contract §2.12. 셋 다 PAT 전용 · 스코프 work:claim · owner = PAT 사용자.
import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { apiBadRequest, apiFail, apiNotFound, requireScope, resolveAgentPrincipal } from '@/lib/agent/externalApi'

/** 인증·스코프를 통과한 요청 — owner 는 PAT 의 사용자다(보낸 사람 = 세션 주인). projectId 는 PAT 의 프로젝트 한정(null = 전체). */
export interface ConsoleCall { owner: string; projectId: string | null; body: Record<string, unknown> }

/**
 * PAT(레거시 시크릿은 신원이 없어 400 identity_required) → work:claim → 본문 JSON 객체. 실패면 응답을 돌려준다.
 * 인증을 먼저 한다 — API 가 꺼져 있거나 토큰이 없으면 본문을 읽지 않고 404·401 로 답한다(존재를 드러내지 않는다).
 */
export async function consoleCall(req: NextRequest, admin: AdminClient): Promise<ConsoleCall | NextResponse> {
  const principal = await resolveAgentPrincipal(req, admin)
  if (principal instanceof NextResponse) return principal
  if (principal.kind === 'legacy') return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
  const scopeErr = requireScope(principal, 'work:claim')
  if (scopeErr) return scopeErr
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return apiBadRequest('본문은 JSON 객체여야 합니다.')
  return { owner: principal.userId, projectId: principal.projectId, body: raw as Record<string, unknown> }
}

/**
 * 프로젝트 한정 PAT 는 대기열(poll·ack)을 쓸 수 없다 — 프롬프트에는 프로젝트가 없어(조정 세션은 대개 프로젝트가 없다) 한 프로젝트의
 * 토큰이 같은 사용자의 다른 프로젝트 세션으로 가는 프롬프트를 읽고 삼킬 수 있기 때문이다(fail-closed). 화면은 그 프로젝트 좌석만 받는다.
 */
export function rejectProjectLimited(call: ConsoleCall): NextResponse | null {
  if (call.projectId === null) return null
  return apiFail(403, 'forbidden_role', '프로젝트 한정 PAT 로는 콘솔 대기열을 쓸 수 없습니다 — 프로젝트를 한정하지 않은 PAT 를 쓰세요.')
}

/** claim 토큰 해시 — DB 에는 이 값만 둔다(0109). 원문은 poll 응답에 한 번만 실린다. */
export function hashClaimToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * RPC 오류 중 입력 문제(22023 계약 규칙 · 23514 검사 제약)는 400 으로, 나머지는 null(호출자가 500).
 * 라우트가 먼저 검사하므로 여기 오는 입력 오류는 서버 쪽 규칙 어긋남의 신호다 — 응답은 400 이되 로그를 남긴다.
 */
export function rpcInputError(err: { code?: string; message: string }, where: string): NextResponse | null {
  if (err.code !== '22023' && err.code !== '23514') return null
  console.error(`[agent-api] ${where} 입력 거절(${err.code}):`, err.message)
  return apiBadRequest('요청이 계약 규칙에 맞지 않습니다.')
}

export { apiNotFound }
