import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import { HEARTBEAT_PHASES } from '@/lib/domain/seatState'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'

/**
 * heartbeat — 좌석표 v1 스펙 §3-2. 진행 중 주문의 "살아 있음"을 서버에 남긴다.
 * report 와 달리 보고 행·스냅샷·알림·revalidate 가 없다: 60초마다 오는 신호가 행을 늘리면
 * 승인 화면의 이력이 오염되고 디스크가 찬다(2026-08-05 장애 경로). 열 4개 touch 뿐이다.
 */
export const dynamic = 'force-dynamic'

const AGENT_MAX = 120
const NOTE_MAX = 500

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const agent = typeof b.agent === 'string' ? b.agent.trim() : ''
  if (!agent || agent.length > AGENT_MAX) return apiBadRequest(`agent 는 1~${AGENT_MAX}자여야 합니다.`)
  const phase = b.phase === undefined || b.phase === null ? null : b.phase
  if (phase !== null && (typeof phase !== 'string' || !(HEARTBEAT_PHASES as readonly string[]).includes(phase))) {
    return apiBadRequest(`phase 는 ${HEARTBEAT_PHASES.join('|')} 중 하나여야 합니다.`)
  }
  const note = typeof b.note === 'string' ? b.note.trim() : ''
  if (note.length > NOTE_MAX) return apiBadRequest(`note 는 ${NOTE_MAX}자 이하여야 합니다.`)

  try {
    const admin = createAdminClient()
    const actor = await resolveWriteActor(req, admin, raw, 'work:claim')
    if (!actor.ok) return actor.res
    const loaded = actor.principal.kind === 'pat'
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res
    const order = loaded.order
    if (order.status !== 'claimed') {
      return apiFail(409, 'conflict', `heartbeat 가능한 상태가 아닙니다(현재: ${order.status}).`)
    }
    // 소유 판정 — report 라우트와 같은 규칙(교차 소유 양방향 403).
    if (actor.principal.kind === 'pat') {
      if (order.claimed_by_user_id === null) return apiFail(403, 'not_claim_owner', '레거시 세션이 점유한 주문입니다.')
      if (order.claimed_by_user_id !== actor.userId) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    } else {
      if (order.claimed_by_user_id !== null) return apiFail(403, 'not_claim_owner', 'PAT 사용자가 점유한 주문입니다.')
      if (order.claimed_by !== actor.agentLabel) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    }

    const now = new Date().toISOString()
    // phase 를 생략하면 null — 사람이 답한 뒤 팀원의 다음 heartbeat 가 BLOCKED 를 푼다(훅은 항상 phase 를 보낸다).
    const { data: updated, error } = await admin
      .from('agent_work_orders')
      .update({
        last_heartbeat_at: now, updated_at: now, heartbeat_agent: agent,
        heartbeat_phase: phase, heartbeat_note: phase === 'blocked' && note ? note : null,
        // 재개 요청(0099)은 워커가 다시 숨을 쉬면 해소된다 — 사람이 따로 지우지 않아도
        // 좌석의 「재개 요청됨」 표시와 팀장 watch 목록에서 같이 사라진다.
        resume_requested_at: null, resume_requested_by: null, resume_requested_host: null,
      })
      .eq('id', id).eq('status', 'claimed')
      .select('id')
    if (error) {
      console.error('[agent-api] heartbeat 갱신 실패:', error.message)
      return apiInternalError()
    }
    if (!updated || (updated as unknown[]).length === 0) {
      return apiFail(409, 'conflict', '주문 상태가 바뀌어 heartbeat 를 기록하지 못했습니다.')
    }
    return NextResponse.json({ ok: true, last_heartbeat_at: now })
  } catch (e) {
    console.error('[agent-api] heartbeat 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
