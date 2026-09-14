import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound, requireScope, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'

/**
 * watch — 감시자(팀장 /dflow-team · 단독 /dflow-poll) 존재 신호. 좌석표 v1 스펙 §3-3.
 * (user_id, agent) 당 1행 upsert. 살아 있음(TTL 70분)은 화면이 판정하고, stop 은 행을 지운다.
 * PAT 전용 — 레거시 시크릿은 신원이 없어 user_id 를 못 채운다.
 */
export const dynamic = 'force-dynamic'

const AGENT_MAX = 120
const STALE_ROW_MS = 7 * 24 * 3600_000

function nonNegInt(v: unknown, name: string): number | null | { error: string } {
  if (v === undefined || v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return { error: `${name} 은 0 이상의 정수여야 합니다.` }
  return v
}

export async function POST(req: NextRequest) {
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const agent = typeof b.agent === 'string' ? b.agent.trim() : ''
  if (!agent || agent.length > AGENT_MAX) return apiBadRequest(`agent 는 1~${AGENT_MAX}자여야 합니다.`)
  const stop = b.stop === true
  const host = typeof b.host === 'string' && b.host.trim() ? b.host.trim().slice(0, 80) : null
  const until = typeof b.until === 'string' && b.until.trim() ? b.until.trim().slice(0, 16) : null
  const slots = nonNegInt(b.slots, 'slots'); if (slots !== null && typeof slots === 'object') return apiBadRequest(slots.error)
  const busy = nonNegInt(b.busy, 'busy'); if (busy !== null && typeof busy === 'object') return apiBadRequest(busy.error)
  const bodyProject = b.project_id === undefined || b.project_id === null ? null : b.project_id
  if (bodyProject !== null && (typeof bodyProject !== 'string' || !isUuidLike(bodyProject))) {
    return apiBadRequest('project_id 형식이 올바르지 않습니다.')
  }

  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'legacy') return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
    const scopeErr = requireScope(principal, 'work:claim')
    if (scopeErr) return scopeErr
    // 프로젝트 한정 PAT 는 그 프로젝트로 강제 — 다른 값을 대면 사칭 신호라 조용히 덮지 않는다.
    let projectId: string | null = bodyProject
    if (principal.projectId !== null) {
      if (bodyProject !== null && bodyProject !== principal.projectId) {
        return apiFail(403, 'forbidden_role', 'PAT 가 한정된 프로젝트와 다릅니다.')
      }
      projectId = principal.projectId
    }

    if (stop) {
      const { error } = await admin.from('agent_watchers').delete().eq('user_id', principal.userId).eq('agent', agent)
      if (error) { console.error('[agent-api] watch stop 실패:', error.message); return apiInternalError() }
      return NextResponse.json({ ok: true, stopped: true })
    }

    const now = new Date()
    const { error: upErr } = await admin
      .from('agent_watchers')
      .upsert({
        user_id: principal.userId, project_id: projectId, agent, host, slots, busy,
        until_label: until, last_seen_at: now.toISOString(),
      }, { onConflict: 'user_id,agent' })
    if (upErr) { console.error('[agent-api] watch upsert 실패:', upErr.message); return apiInternalError() }
    // 청소를 따로 두지 않는다 — 7일 넘게 조용한 행은 여기서 지운다. 실패는 로깅만.
    const { error: gcErr } = await admin
      .from('agent_watchers').delete().lt('last_seen_at', new Date(now.getTime() - STALE_ROW_MS).toISOString())
    if (gcErr) console.error('[agent-api] watch 오래된 행 정리 실패:', gcErr.message)
    return NextResponse.json({ ok: true, expires_at: new Date(now.getTime() + WATCHER_TTL_MS).toISOString() })
  } catch (e) {
    console.error('[agent-api] watch 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
