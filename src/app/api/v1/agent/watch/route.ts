import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import { HOLDER_RE } from '@/lib/agent/leadLease'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound, requireScope, resolveAgentPrincipal, type AgentPrincipal,
} from '@/lib/agent/externalApi'
import { accessibleProjectIds } from '@/lib/agent/mineShared'
import { isMine, listFilterPass, parseWpList } from '@/lib/domain/designGate'
import {
  ITEM_FACT_COLUMNS, ORDER_FACT_COLUMNS, decide, loadItemFacts, orderFactsOf, type FactItemRow, type FactOrderRow,
} from '@/lib/agent/designFacts'

/**
 * watch — 감시자(팀장 /dflow-team · 단독 /dflow-poll) 존재 신호. 좌석표 v1 스펙 §3-3.
 * (user_id, agent) 당 1행 upsert. 살아 있음(TTL 70분)은 화면이 판정하고, stop 은 행을 지운다.
 * PAT 전용 — 레거시 시크릿은 신원이 없어 user_id 를 못 채운다.
 */
export const dynamic = 'force-dynamic'

const AGENT_MAX = 120
const STALE_ROW_MS = 7 * 24 * 3600_000
/** 한 번에 실어 보내는 재개 요청 수 — 요청이 걸린 주문은 늘 소수다. */
const RESUME_MAX = 50

export interface ResumeRequest {
  order_id: string; id8: string; project_id: string; wbs_item_id: string | null
  code: string | null; name: string | null
  /** 이어받아야 하는 PC. 팀장은 자기 host(watch 가 보내는 값과 같은 슬러그)와 맞을 때만 가져간다. */
  host: string | null
  claimed_by: string | null
  requested_at: string
  /** 계약 2.11 — 5.3 mine(같은 신원 ∧ 도는 PC). 사람의 명시 요청이라 목록 거르기는 보지 않는다(12절 Y10). */
  mine: boolean
  /** 계약 2.11 — 설계 상태(null·review·accepted). */
  design_state: string | null
}

/**
 * 내 신원이 점유한 주문 중 사람이 좌석표에서 「이어서 시작」을 누른 것(0099).
 * 팀장은 매 기상마다 watch 를 부르므로 여기에 실으면 왕복이 늘지 않는다.
 * 조회에 실패하면 빈 배열로 위장하지 않고 null 을 돌려준다 — 호출자는 "요청 없음"과 구별해야 한다.
 */
async function loadResumeRequests(
  admin: ReturnType<typeof createAdminClient>, userId: string, projectId: string | null,
  leased: string[] | null | undefined, agentLabel: string,
): Promise<ResumeRequest[] | null> {
  // 팀장이 holder 를 보내면 그 holder 로 쥔 lease 의 프로젝트만 돌려준다(스펙 §9) — leased 는 leasedProjectIds 가 읽은 값이다
  // (null 은 holder 없음, undefined 는 lease 조회 실패). 신원+프로젝트마다 팀장이 하나이므로 hostname 이 겹치는 다른 PC 의
  // 팀장이 남의 재개 요청을 가져가지 않는다.
  if (leased === undefined) return null
  // lease 가 하나도 없으면 이 신원은 어느 프로젝트에서도 팀장이 아니다 — orders 조회 자체를
  // 건너뛴다. 건너뛰지 않으면 held 프로젝트가 없는 신원이라도 RESUME_MAX(50)를 다른(비-lease)
  // 프로젝트의 오래된 요청이 다 채워, 뒤에 오는 held 프로젝트 요청이 잘릴 수 있다.
  if (leased !== null && leased.length === 0) return []
  let q = admin
    .from('agent_work_orders')
    .select('id, project_id, wbs_item_id, claimed_by, claimed_by_user_id, runner, runner_seen_at, design_state, resume_requested_at, resume_requested_host')
    .eq('claimed_by_user_id', userId).eq('status', 'claimed')
    .not('resume_requested_at', 'is', null)
  if (projectId !== null) q = q.eq('project_id', projectId)
  // leased 가 있으면 DB 단에서 먼저 그 프로젝트로 좁혀 limit(RESUME_MAX) 가 held 프로젝트를
  // 밀어내지 않게 한다. 아래 in-memory 필터는 그대로 두어 이중 방어선을 유지한다.
  if (leased !== null) q = q.in('project_id', leased)
  const { data, error } = await q.order('resume_requested_at', { ascending: true }).limit(RESUME_MAX)
  if (error) { console.error('[agent-api] 재개 요청 조회 실패:', error.message); return null }
  const allRows = (data ?? []) as Array<{
    id: string; project_id: string; wbs_item_id: string | null; claimed_by: string | null
    claimed_by_user_id: string | null; runner: string | null; runner_seen_at: string | null; design_state: string | null
    resume_requested_at: string; resume_requested_host: string | null
  }>
  const rows = leased === null ? allRows : allRows.filter(r => leased.includes(r.project_id))
  if (rows.length === 0) return []
  // 팀장이 표로 보고할 때 TSK 코드가 있어야 사람이 어느 작업인지 안다 — 행이 소수라 한 번 더 읽는다.
  const itemIds = [...new Set(rows.map(r => r.wbs_item_id).filter((x): x is string => x !== null))]
  const labels = new Map<string, { code: string; name: string }>()
  if (itemIds.length > 0) {
    const { data: items, error: itemErr } = await admin.from('wbs_items').select('id, code, name').in('id', itemIds)
    if (itemErr) { console.error('[agent-api] 재개 요청 항목 조회 실패:', itemErr.message); return null }
    for (const it of (items ?? []) as Array<{ id: string; code: string; name: string }>) {
      labels.set(it.id, { code: it.code, name: it.name })
    }
  }
  const nowMs = Date.now()
  return rows.map(r => {
    const label = r.wbs_item_id ? labels.get(r.wbs_item_id) : undefined
    const order = {
      status: 'claimed' as const, claimedBy: r.claimed_by, claimedByUserId: r.claimed_by_user_id ?? null,
      runner: r.runner ?? null, runnerSeenAt: r.runner_seen_at ?? null,
    }
    return {
      order_id: r.id, id8: r.id.slice(0, 8), project_id: r.project_id, wbs_item_id: r.wbs_item_id,
      code: label?.code ?? null, name: label?.name ?? null,
      host: r.resume_requested_host, claimed_by: r.claimed_by, requested_at: r.resume_requested_at,
      // Y10 — 재개 요청 ∧ mine 이면 팀장은 5.3 2행 skip 이어도 재개한다(사람의 명시 요청이라 목록 거르기는 보지 않는다).
      mine: isMine(order, { userId, label: agentLabel, lead: false, filtersPass: true }, nowMs),
      design_state: r.design_state ?? null,
    }
  })
}

/** 이 holder 로 쥔 살아 있는 lease 의 프로젝트(스펙 §9). holder 가 없으면 null(거르지 않음), 조회 실패는 undefined. */
async function leasedProjectIds(
  admin: ReturnType<typeof createAdminClient>, userId: string, holder: string | null,
): Promise<string[] | null | undefined> {
  if (holder === null) return null
  const { data, error } = await admin
    .from('agent_lead_leases').select('project_id')
    .eq('user_id', userId).eq('holder', holder).gt('expires_at', new Date().toISOString())
  if (error) { console.error('[agent-api] lease 조회 실패:', error.message); return undefined }
  return ((data ?? []) as Array<{ project_id: string }>).map(r => r.project_id)
}

/**
 * build_ready 가 볼 프로젝트 집합(I-1 보안 수정, 리뷰 1회차) — holder 가 있으면 그 lease 의 프로젝트(이미 lease
 * 발급 때 접근이 검증된 것으로 본다), 없으면 이 PAT 가 접근 가능한 프로젝트(`accessibleProjectIds`, `/work/mine`
 * 과 같은 기준 — enabled agent_projects ∩ 멤버)로 좁힌다. 그 위에 body `project_id`(또는 PAT 한정 프로젝트)가
 * 있으면 교집합한다 — 집합 밖이면 빈 배열이지 400 이 아니다(기존 watch 의 다른 칸 동작은 그대로 둔다).
 * 접근 가능 프로젝트 조회 실패는 undefined(위장 금지 — 호출자가 build_ready:null + 사유로 답한다).
 */
async function buildReadyProjectIds(
  admin: ReturnType<typeof createAdminClient>, principal: Extract<AgentPrincipal, { kind: 'pat' }>,
  leased: string[] | null, projectId: string | null,
): Promise<string[] | undefined> {
  let base: string[]
  if (leased !== null) {
    base = leased
  } else {
    try {
      base = await accessibleProjectIds(admin, principal)
    } catch (e) {
      console.error('[agent-api] build 목록 접근 프로젝트 조회 실패:', e instanceof Error ? e.message : e)
      return undefined
    }
  }
  return projectId !== null ? base.filter(p => p === projectId) : base
}

/**
 * D22 — 이 신원·이 PC 가 띄울 action build 주문(승인·확정된 설계). 팀장은 이 목록에서 슬롯에 있는 id·제외한 id 를 빼고 남으면
 * TICK 을 건너뛰지 않는다. build 는 설계 상태 accepted 에서만 나오므로 그것만 읽는다. 실패는 null(위장 금지).
 * projectIds 는 buildReadyProjectIds 가 이미 접근 가능한 집합으로 좁힌 값이다 — 여기서 다시 거르지 않는다.
 */
async function loadBuildReady(
  admin: ReturnType<typeof createAdminClient>, userId: string, projectIds: string[], label: string,
  filters: { requireTag: string | null; wp: string[] | null },
): Promise<Array<{ order_id: string; id8: string; code: string | null; name: string | null; status: string }> | null> {
  // 접근 가능한(또는 lease 쥔) 프로젝트가 하나도 없으면 띄울 것이 없다 — 재개 요청과 같은 이유로 조회하지 않는다.
  if (projectIds.length === 0) return []
  const { data, error } = await admin.from('agent_work_orders')
    .select(`id, project_id, wbs_item_id, status, ${ORDER_FACT_COLUMNS}`)
    .in('status', ['ready', 'claimed']).eq('design_state', 'accepted').in('project_id', projectIds)
    .limit(200)
  if (error) { console.error('[agent-api] build 목록 조회 실패:', error.message); return null }
  const rows = (data ?? []) as Array<FactOrderRow & { id: string; project_id: string; wbs_item_id: string | null }>
  const itemIds = [...new Set(rows.map(r => r.wbs_item_id).filter((x): x is string => x !== null))]
  if (itemIds.length === 0) return []
  const { data: items, error: itemErr } = await admin.from('wbs_items').select(`code, name, ${ITEM_FACT_COLUMNS}`).in('id', itemIds)
  if (itemErr) { console.error('[agent-api] build 목록 항목 조회 실패:', itemErr.message); return null }
  const byId = new Map(((items ?? []) as Array<FactItemRow & { code: string; name: string }>).map(i => [i.id, i]))
  let facts: Awaited<ReturnType<typeof loadItemFacts>>
  try { facts = await loadItemFacts(admin, [...byId.values()]) } catch (e) {
    console.error('[agent-api] build 목록 판단 재료 실패:', e instanceof Error ? e.message : e); return null
  }
  const nowMs = Date.now()
  const out: Array<{ order_id: string; id8: string; code: string | null; name: string | null; status: string }> = []
  for (const r of rows) {
    const it = r.wbs_item_id ? byId.get(r.wbs_item_id) : undefined
    const f = it ? facts.get(it.id) : undefined
    if (!it || !f) continue
    const order = orderFactsOf(r)
    if (decide(f.facts, order, nowMs).action !== 'build') continue
    const filtersPass = listFilterPass({ tags: it.tags, externalRef: it.external_ref }, filters)
    if (!isMine(order, { userId, label, lead: true, filtersPass }, nowMs)) continue
    out.push({ order_id: r.id, id8: r.id.slice(0, 8), code: it.code ?? null, name: it.name ?? null, status: r.status })
  }
  return out
}

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
  const holder = b.holder === undefined || b.holder === null ? null : b.holder
  if (holder !== null && (typeof holder !== 'string' || !HOLDER_RE.test(holder))) {
    return apiBadRequest('holder 형식이 올바르지 않습니다.')
  }
  const requireTag = b.require_tag === undefined || b.require_tag === null ? null : b.require_tag
  if (requireTag !== null && (typeof requireTag !== 'string' || requireTag === '' || requireTag.length > 40)) return apiBadRequest('require_tag 는 1~40자여야 합니다.')
  const wpRaw = b.wp === undefined || b.wp === null ? null : Array.isArray(b.wp) ? (b.wp as unknown[]).join(',') : b.wp
  if (wpRaw !== null && typeof wpRaw !== 'string') return apiBadRequest('wp 는 문자열 또는 배열이어야 합니다.')
  const wp = parseWpList(wpRaw as string | null)
  if (wp === 'invalid') return apiBadRequest('wp 형식 오류 — WP-02 또는 모듈/WP-02.')

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
    const leased = await leasedProjectIds(admin, principal.userId, holder)
    const resume = await loadResumeRequests(admin, principal.userId, projectId, leased, agent)
    const buildProjectIds = leased === undefined ? undefined : await buildReadyProjectIds(admin, principal, leased, projectId)
    const buildReady = buildProjectIds === undefined ? null
      : await loadBuildReady(admin, principal.userId, buildProjectIds, agent, { requireTag: requireTag as string | null, wp })
    return NextResponse.json({
      ok: true,
      expires_at: new Date(now.getTime() + WATCHER_TTL_MS).toISOString(),
      // 배열이면 그게 전부다. null 은 "조회에 실패했다"이며 "요청이 없다"가 아니다(에러 3원칙).
      resume_requests: resume,
      ...(resume === null ? { resume_requests_error: '재개 요청 조회에 실패했습니다.' } : {}),
      build_ready: buildReady,
      ...(buildReady === null ? { build_ready_error: '구현 대기 목록 조회에 실패했습니다.' } : {}),
    })
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
