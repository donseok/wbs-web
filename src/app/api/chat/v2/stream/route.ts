import { NextRequest } from 'next/server'
import { jsonError } from '@/lib/api/http'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { effectiveLegacyRole } from '@/lib/domain/authz'
import { createServerClient } from '@/lib/supabase/server'
import { createDefaultChatToolRegistry } from '@/lib/ai/chat/default-registry'
import { createSupabaseAccessScopeResolver } from '@/lib/authz/accessScope'
import { validateChatProjectScope } from '@/lib/ai/chat/access-scope'
import { createChatNdjsonStream, orchestrateChatV2 } from '@/lib/ai/chat/orchestrator'
import {
  planWithConfiguredLlm,
  shouldAttemptPlan,
  validateToolPlan,
  type ToolPlan,
} from '@/lib/ai/chat/planner'
import { sanitizeChatRequestV2 } from '@/lib/ai/chat/protocol'
import { planningSignals, routeChatRequest } from '@/lib/ai/chat/router'

export const dynamic = 'force-dynamic'

const MAX_REQUEST_BYTES = 262_144

function requestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '')}`
}

/** Read-only NDJSON endpoint. Existing /api/chat and /api/chat/stream remain untouched. */
export async function POST(req: NextRequest) {
  // Explicit kill switch used by the client to fall back to the legacy text stream.
  if (process.env.CHAT_V2_ENABLED !== 'true') {
    return jsonError('새 챗봇 스트림이 비활성화되어 있습니다.', 501, 'CHAT_V2_DISABLED')
  }

  const user = await getSession()
  if (!user) return jsonError('인증이 필요합니다.', 401, 'UNAUTHENTICATED')

  // sanitize는 파싱 이후에야 상한을 적용하므로, 파싱 전 선언 크기로 리소스 소모형
  // 요청을 차단한다(리뷰 M-5). 256KB는 정상 상한(메시지 2k + 히스토리 12×4k자 한글
  // UTF-8 ≈ 150KB)에 여유를 둔 값이다.
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonError('요청 본문이 너무 큽니다.', 413, 'PAYLOAD_TOO_LARGE')
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonError('잘못된 JSON 요청입니다.', 400, 'INVALID_JSON')
  }
  const parsed = sanitizeChatRequestV2(raw)
  if (!parsed.ok) return jsonError(parsed.error.message, parsed.error.status, parsed.error.code)
  const request = parsed.value
  const now = new Date()
  const plannedRoute = routeChatRequest(request, now)
  // Unsupported questions contain no v2 data and immediately fall back to the legacy bot. Keep this
  // before membership and project-scope I/O so an intentional fallback never touches Supabase.
  // 예외: 플래너 opt-in(§7.1)이 켜져 있고 게이트를 통과하면 제한된 도구 계획을 한 번 시도한다.
  const plannerEligible = plannedRoute.kind === 'legacy'
    && process.env.CHAT_V2_PLANNER_ENABLED === 'true'
    && shouldAttemptPlan(planningSignals(request))
  if (plannedRoute.kind === 'legacy' && !plannerEligible) {
    return jsonError('기존 DK Bot으로 전환합니다.', 501, 'CHAT_V2_UNSUPPORTED')
  }

  // 챗 컨텍스트의 신원 — 판정이 아니라 표시·필터용이다(실제 권한은 아래 capabilities +
  // allowedProjectIds 가 결정하며, 봇은 읽기 전용이다). memberships.role 은 0054 에서
  // 박제됐으므로 role 은 새 축에서 파생한다 — 그 컬럼을 읽으면 시간이 갈수록 드리프트가 쌓인다.
  // 권한 조회 실패는 신원 없음(null)으로 열화한다 — 읽기 전용 경로를 500 으로 만들 이유가 없다.
  const [actor, sb] = await Promise.all([
    getActorForView(),
    createServerClient(),
  ])
  const scopeResolution = await createSupabaseAccessScopeResolver(sb).resolve(user.id)
  if (!scopeResolution.ok) {
    console.error('[chat-v2] 프로젝트 접근 범위 조회 실패:', scopeResolution.detail ?? scopeResolution.code)
    return jsonError('프로젝트 접근 범위를 확인하지 못했습니다.', 503, 'ACCESS_SCOPE_UNAVAILABLE')
  }
  const { allowedProjectIds, capabilities } = scopeResolution.scope
  const scope = validateChatProjectScope(request, allowedProjectIds)
  if (!scope.ok) return jsonError(scope.message, scope.status, scope.code)

  const id = requestId()
  const registry = createDefaultChatToolRegistry(sb)

  // 플래너 경로: 계획 생성·검증에 실패하면 어떤 오류도 노출하지 않고 기존 501 폴백으로 수렴한다(§7.3).
  let plan: ToolPlan | undefined
  if (plannerEligible) {
    const allowedTools = registry.names()
    const rawPlan = await planWithConfiguredLlm(request, { allowedTools, now: now.toISOString() })
    const validated = validateToolPlan(rawPlan, { allowedTools, allowedProjectIds })
    if (!validated.ok) {
      console.warn('[chat-v2] 플래너 계획 기각 → 레거시 폴백:', validated.code)
      return jsonError('기존 DK Bot으로 전환합니다.', 501, 'CHAT_V2_UNSUPPORTED')
    }
    plan = validated.plan
  }

  const events = orchestrateChatV2(request, {
    requestId: id,
    registry,
    now,
    route: plannedRoute,
    ...(plan ? { plan } : {}),
    context: {
      userId: user.id,
      role: effectiveLegacyRole(actor),
      teamId: actor?.teamId ?? null,
      capabilities,
      allowedProjectIds,
      pageContext: request.pageContext ?? null,
      now: now.toISOString(),
      timezone: 'Asia/Seoul',
      signal: req.signal,
    },
  })
  return new Response(createChatNdjsonStream(events, { requestId: id, signal: req.signal }), {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': id,
    },
  })
}
