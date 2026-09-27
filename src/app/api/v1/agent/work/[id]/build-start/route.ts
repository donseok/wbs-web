import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { loadDependsInfo, type DependInfo } from '@/lib/agent/depends'
import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'
import { orderFactsOf } from '@/lib/agent/designFacts'
import { BUILD_SCOPES, canBuildStart, predsState, runnerFree, toDesignMode, type BuildScope } from '@/lib/domain/designGate'

export const dynamic = 'force-dynamic'

/**
 * 설계 끝 → 구현 시작(계약 v2.9·v2.11, 설계 상태 스펙 5.2). 범위(scope)로 관문을 본다 — 검사 순서 runner → 설계 → 선행(계획 P4).
 * 점유자 본인·claimed 여야 한다. 통과하면 RPC 가 ds·dd → ip 로 옮기고 도는 PC 를 호출자로 적는다(ip 이상이면 단계는 그대로 — 멱등).
 * 주문이 claimed 가 아니거나 판정과 쓰기 사이에 바뀌면 409 design_gate·reason order_changed 다(12절 Y7) — 워커는 설계 되돌림처럼
 * 끝내고 폴더를 지운다. 선행 미충족은 403 dependency_not_met(워커는 설계 선행 대기로 멈춘다).
 */
const orderChanged = (message: string) =>
  NextResponse.json({ error: message, code: 'design_gate', reason: 'order_changed' }, { status: 409 })

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('경로 id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  // 범위(계약 2.11, D21) — 없으면 legacy(옛 킷). legacy 는 보내는 값이 아니라 "안 보냄"이다.
  const requestScopes: readonly string[] = BUILD_SCOPES.filter(sc => sc !== 'legacy')
  const scopeRaw = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).scope : undefined
  if (scopeRaw !== undefined && (typeof scopeRaw !== 'string' || !requestScopes.includes(scopeRaw))) {
    return apiBadRequest(`scope 는 ${requestScopes.join('|')} 중 하나여야 합니다.`)
  }
  const scope: BuildScope = (scopeRaw as BuildScope | undefined) ?? 'legacy'
  try {
    const admin = createAdminClient()
    const actor = await resolveWriteActor(req, admin, raw, 'work:claim')
    if (!actor.ok) return actor.res

    const loaded = actor.principal.kind === 'pat'
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res
    const row = loaded.order
    // 사람이 중단한 주문은 전용 코드(report 와 같다) — 소유 판정보다 먼저 본다(중단은 점유 흔적을 지운다).
    if (row.status === 'cancelled') return apiFail(409, 'cancelled', '작업이 중단되었습니다.')
    if (row.status !== 'claimed') return orderChanged(`구현을 시작할 수 있는 상태가 아닙니다(현재: ${row.status}).`)

    // 소유 판정(§2.3) — 교차 소유는 양방향 모두 403 not_claim_owner(report·release 와 같다).
    if (actor.principal.kind === 'pat') {
      if (row.claimed_by_user_id === null) return apiFail(403, 'not_claim_owner', '레거시 세션이 점유한 주문입니다.')
      if (row.claimed_by_user_id !== actor.userId) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    } else {
      if (row.claimed_by_user_id !== null) return apiFail(403, 'not_claim_owner', 'PAT 사용자가 점유한 주문입니다.')
      if (row.claimed_by !== actor.agentLabel) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    }

    const order = orderFactsOf(row)
    const nowMs = Date.now()
    let dependsInfo: DependInfo[] = []
    let mode = toDesignMode(null)
    if (row.wbs_item_id) {
      const { data: itemRow, error: itemErr } = await admin
        .from('wbs_items').select('depends, depends_waived, stage, actual_pct, tags, design_mode').eq('id', row.wbs_item_id).maybeSingle()
      if (itemErr) {
        console.error('[agent-api] build-start 항목 조회 실패(거절):', itemErr.message) // fail-closed
        return apiInternalError()
      }
      const item = itemRow as { depends?: string[] | null; depends_waived?: string[] | null; stage?: string | null
        actual_pct?: number | string | null; tags?: string[] | null; design_mode?: string | null } | null
      if (item) {
        const depends = item.depends ?? []
        if (depends.length > 0) dependsInfo = await loadDependsInfo(admin, { projectId: row.project_id, depends, waived: item.depends_waived ?? [] })
        const unmet = dependsInfo.filter((d) => !d.reached)
        mode = toDesignMode(item.design_mode)
        const refusal = canBuildStart({
          mode, stage: item.stage ?? null, actualPct: item.actual_pct == null ? null : Number(item.actual_pct),
          delegated: (item.tags ?? []).includes('agent'), hasApprovedOrder: false, preds: predsState(unmet),
        }, order, scope, actor.agentLabel, nowMs)
        if (refusal) {
          if (refusal.code === 'runner_active') {
            return NextResponse.json({ error: refusal.message, code: 'runner_active', runner: order.runner, runner_seen_at: order.runnerSeenAt }, { status: 409 })
          }
          if (refusal.code === 'dependency_not_met') {
            return NextResponse.json({ error: refusal.message, code: 'dependency_not_met', unmet: unmet.map((d) => ({ external_ref: d.external_ref, stage: d.stage })) }, { status: 403 })
          }
          return NextResponse.json({ error: refusal.message, code: refusal.code, ...(refusal.reason ? { reason: refusal.reason } : {}) }, { status: refusal.status })
        }
      }
    }
    // 항목이 지워진 주문은 설계 관문을 보지 않는다(RPC 가 단계를 건너뛴다). 도는 PC 조건만 본다.
    if (!runnerFree(order, actor.agentLabel, nowMs)) {
      return NextResponse.json({ error: `다른 PC 가 이 작업을 돌리는 중입니다(${order.runner}).`, code: 'runner_active', runner: order.runner, runner_seen_at: order.runnerSeenAt }, { status: 409 })
    }

    // 원자 전이 — claimed·점유자·읽은 값(CAS)을 RPC 가 잠근 행으로 다시 본다. 판정과 쓰기 사이에 바뀌면 Y7.
    // CAS 에는 runner_seen_at 을 넣지 않는다 — 도는 PC 자신의 heartbeat(Task 12)가 이 값을 계속 갱신하므로,
    // 넣으면 같은 PC 의 heartbeat 가 build-start 의 읽기·쓰기 사이에 끼어들 때 정상 워커가 409 를 받는다
    // (계획 P6 이 heartbeat 자신의 CAS 에서 이 값을 뺀 것과 같은 까닭).
    const transition = await applyWorkflowEvent(admin, {
      event: 'build_start', actorUserId: loaded.userId, orderId: id,
      scope: scope === 'legacy' ? null : scope,
      cas: { design_state: order.designState, design_mode: mode, runner: order.runner, claim_scope: row.claim_scope ?? null },
      agent: actor.principal.kind === 'pat' ? null : actor.agentLabel,
      agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
      runner: actor.agentLabel,
    })
    if (!transition.ok) {
      if (transition.conflict) return orderChanged('상태가 바뀌어 구현을 시작하지 못했습니다(설계가 되돌려졌거나 다른 PC 가 이어받음).')
      console.error('[agent-api] build-start 전이 실패:', transition.error)
      return apiInternalError()
    }
    // claim 라우트와 같은 후처리 — 실적이 바뀌었으면 화면 갱신·진척 스냅샷(실패는 로깅만).
    if (transition.actualChanged) {
      revalidatePath(`/p/${row.project_id}`, 'layout')
      after(() => recordProgressSnapshot(row.project_id, admin as never))
    }
    return NextResponse.json({
      ok: true, status: 'claimed', stage: transition.stage, stage_changed: transition.stageChanged,
      depends_evidence: dependsInfo, runner: actor.agentLabel,
    })
  } catch (e) {
    console.error('[agent-api] build-start 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
