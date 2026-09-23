import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import { HEARTBEAT_PHASES, LEAD_PHASES } from '@/lib/domain/seatState'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'

/**
 * heartbeat — 좌석표 v1 스펙 §3-2. 진행 중 주문의 "살아 있음"을 서버에 남긴다.
 * report 와 달리 보고 행·스냅샷·알림·revalidate 가 없다: 60초마다 오는 신호가 행을 늘리면
 * 승인 화면의 이력이 오염되고 디스크가 찬다(2026-08-05 장애 경로). 열 4개 touch 뿐이다.
 * 예외: reported·approved 주문의 merge_conflict 설정·해제(팀장 대리, 2026-09-23 머지 충돌 §7.2)는 phase·note 두 열만 쓴다.
 */
export const dynamic = 'force-dynamic'

const AGENT_MAX = 120
const NOTE_MAX = 500
/** 실행 모델(0100) — 모델 id 나 별칭(opus · claude-opus-4-8 · gpt-5-codex …). 공백·제어문자 없이 64자. */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,63}$/
/** 팀장 대리 표시(머지 충돌 설계 2026-09-23 §7.2)를 받는 주문 상태. 워커 phase 는 여전히 claimed 에서만 받는다. */
const LEAD_STATUSES = ['reported', 'approved'] as const
const ALL_PHASES = [...HEARTBEAT_PHASES, ...LEAD_PHASES] as readonly string[]

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const agent = typeof b.agent === 'string' ? b.agent.trim() : ''
  if (!agent || agent.length > AGENT_MAX) return apiBadRequest(`agent 는 1~${AGENT_MAX}자여야 합니다.`)
  const phase = b.phase === undefined || b.phase === null ? null : b.phase
  if (phase !== null && (typeof phase !== 'string' || !ALL_PHASES.includes(phase))) {
    return apiBadRequest(`phase 는 ${ALL_PHASES.join('|')} 중 하나여야 합니다.`)
  }
  // 팀장 대리 해제 — 현재 값이 merge_conflict 일 때만 지운다(아래 writeLeadMark).
  const clear = b.clear === undefined || b.clear === null ? null : b.clear
  if (clear !== null && clear !== 'merge_conflict') return apiBadRequest('clear 는 merge_conflict 만 받습니다.')
  if (clear !== null && phase !== null) return apiBadRequest('clear 와 phase 를 함께 보낼 수 없습니다.')
  const lead = phase === 'merge_conflict' || clear !== null
  const note = typeof b.note === 'string' ? b.note.trim() : ''
  if (note.length > NOTE_MAX) return apiBadRequest(`note 는 ${NOTE_MAX}자 이하여야 합니다.`)
  if (phase === 'merge_conflict' && !note) return apiBadRequest('merge_conflict 는 note 가 필요합니다(충돌 파일·해소 단계).')
  // model 은 선택이다 — 생략하면 열을 건드리지 않는다(사람이 부르는 blocked heartbeat 가 모델을 지우지 않게).
  const model = b.model === undefined || b.model === null || b.model === '' ? null : b.model
  if (model !== null && (typeof model !== 'string' || !MODEL_RE.test(model.trim()))) {
    return apiBadRequest('model 은 영숫자로 시작하는 64자 이하 모델 이름이어야 합니다.')
  }

  try {
    const admin = createAdminClient()
    const actor = await resolveWriteActor(req, admin, raw, 'work:claim')
    if (!actor.ok) return actor.res
    // 팀장 대리 표시는 PAT 전용 — 레거시 소유 판정(claimed_by 라벨)으로는 팀장이 통과할 수 없다(§7.2).
    if (lead && actor.principal.kind !== 'pat') {
      return apiFail(400, 'identity_required', 'merge_conflict 표시는 PAT 로만 보낼 수 있습니다.')
    }
    const loaded = actor.principal.kind === 'pat'
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res
    const order = loaded.order
    // 사람이 중단한 주문(2026-09-19 중단 설계 §2) — 워커가 구분해 멈추도록 전용 코드를 준다(훅·dflow.sh exit 10).
    // 소유 판정보다 먼저 본다: 중단은 점유 흔적을 지우므로 뒤에 두면 403 not_claim_owner 로 뭉개진다.
    if (order.status === 'cancelled') return apiFail(409, 'cancelled', '작업이 중단되었습니다.')
    if (lead) {
      if (order.status === 'claimed') return apiBadRequest('merge_conflict 는 완료 보고(reported)·승인(approved) 주문에만 씁니다.')
      if (!(LEAD_STATUSES as readonly string[]).includes(order.status)) {
        return apiFail(409, 'conflict', `merge_conflict 를 표시할 수 있는 상태가 아닙니다(현재: ${order.status}).`)
      }
    } else if (order.status !== 'claimed') {
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

    if (lead) return await writeLeadMark(admin, id, clear !== null, note)

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
        // 에이전트 보기 명찰(0100) — Phase 서브에이전트의 모델. 실린 때만 덮어쓴다.
        ...(model !== null ? { heartbeat_model: (model as string).trim() } : {}),
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

/**
 * 팀장 대리 표시 — heartbeat_phase·heartbeat_note 두 열만 쓴다.
 * updated_at 을 건드리지 않는 이유: 승인분 좌석은 updated_at 7일 창으로 고른다(agentSeatmap.ts DONE_WINDOW_MS).
 * heartbeat_agent 를 건드리지 않는 이유: 좌석 이름이 heartbeat_agent ?? claimed_by 라 팀장 라벨로 바뀐다.
 */
async function writeLeadMark(admin: ReturnType<typeof createAdminClient>, id: string, clear: boolean, note: string) {
  const patch = clear ? { heartbeat_phase: null, heartbeat_note: null } : { heartbeat_phase: 'merge_conflict', heartbeat_note: note }
  let q = admin.from('agent_work_orders').update(patch).eq('id', id).in('status', [...LEAD_STATUSES])
  // 해제는 현재 값이 merge_conflict 일 때만 — 워커가 남긴 다른 phase 를 지우지 않는다.
  if (clear) q = q.eq('heartbeat_phase', 'merge_conflict')
  const { data, error } = await q.select('id')
  if (error) {
    console.error('[agent-api] merge_conflict 표시 실패:', error.message)
    return apiInternalError()
  }
  const n = ((data as unknown[] | null) ?? []).length
  if (clear) return NextResponse.json({ ok: true, phase: null, cleared: n > 0 })
  if (n === 0) return apiFail(409, 'conflict', '주문 상태가 바뀌어 merge_conflict 를 표시하지 못했습니다.')
  return NextResponse.json({ ok: true, phase: 'merge_conflict' })
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
