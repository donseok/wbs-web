import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike, isClaimStale } from '@/lib/domain/agentWork'
import {
  apiBadRequest, apiInternalError, apiNotFound, isAgentProjectMember, patProjectAllowed,
  requireAgentProject, requireScope, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'
import { ITEM_DETAIL_COLUMNS, loadDependsInfo, type DependInfo } from '@/lib/agent/depends'

const LEGACY_ITEM_COLUMNS = 'id, code, name, biz, deliverable, planned_start, planned_end' // v1 회귀 기준선 — 확장 금지

/** GET /api/v1/agent/work/{id} — 상태 폴링. 에이전트는 여기서 승인/반려·반려 사유를 읽는다(스펙 §3.4-2). */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('유효한 작업 ID가 필요합니다.')
  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'pat') {
      const scopeErr = requireScope(principal, 'work:read')
      if (scopeErr) return scopeErr
    }

    const { data: order, error } = await admin
      .from('agent_work_orders')
      .select('id, project_id, status, priority, instructions, claimed_by, claimed_by_user_id, claimed_at, wbs_item_id')
      .eq('id', id).maybeSingle()
    if (error) {
      console.error('[agent-api] 주문 조회 실패:', error.message)
      return apiInternalError()
    }
    if (!order) return apiNotFound()
    const row = order as { project_id: string; claimed_at: string | null; wbs_item_id: string | null }
    if (principal.kind === 'pat' && !patProjectAllowed(principal, row.project_id)) return apiNotFound()
    // 미등록 프로젝트의 주문은 존재 자체를 숨긴다 — 게이트 순서상 등록 해제 뒤에도 새지 않게.
    if (!(await requireAgentProject(admin, row.project_id))) return apiNotFound()
    if (principal.kind === 'pat' && !(await isAgentProjectMember(admin, principal.userId, row.project_id))) {
      return apiNotFound() // 비멤버 404 — 존재 은닉 관례(§2.2)
    }

    const { data: reports, error: repErr } = await admin
      .from('agent_work_reports')
      .select('id, kind, percent, summary, links, agent, review_action, review_note, created_at')
      .eq('work_order_id', id).order('created_at', { ascending: true })
    if (repErr) {
      console.error('[agent-api] 보고 이력 조회 실패:', repErr.message)
      return apiInternalError()
    }
    // PAT 응답만 ITEM_DETAIL_COLUMNS 로 확장한다(클라이언트 spec.md 캐시 재료 — 결정 A).
    // 레거시 응답은 v1 그대로 — 회귀 기준선.
    const itemColumns = principal.kind === 'pat' ? ITEM_DETAIL_COLUMNS : LEGACY_ITEM_COLUMNS
    let item: unknown = null
    if (row.wbs_item_id) {
      const { data: items, error: itemErr } = await admin
        .from('wbs_items')
        .select(itemColumns)
        .in('id', [row.wbs_item_id])
      if (itemErr) {
        console.error('[agent-api] 항목 컨텍스트 조회 실패:', itemErr.message)
        return apiInternalError()
      }
      item = (items ?? [])[0] ?? null
    }
    let dependsInfo: DependInfo[] = []
    if (principal.kind === 'pat' && item) {
      const depends = (item as { depends?: string[] | null }).depends ?? []
      if (depends.length > 0) {
        dependsInfo = await loadDependsInfo(admin, { projectId: row.project_id, depends })
      }
    }
    const full = order as {
      id: string; status: string; priority: number; instructions: string
      claimed_by: string | null; claimed_by_user_id: string | null
      claimed_at: string | null; wbs_item_id: string | null
    }
    let extra: Record<string, unknown> = {}
    if (principal.kind === 'pat') {
      // claimed_by_user_email 은 계약 원문대로 무조건 노출한다(게이팅 없음) — 0004_ops_rls.sql
      // read_all_members(using true)로 project_members.email 이 이미 전원 조회 가능하고 claimed_by
      // 라벨도 무조건 노출 중이라, 여기만 게이팅해도 실질 보호는 없이 동결 계약만 이탈하게 된다.
      let claimedByUserEmail: string | null = null
      if (full.claimed_by_user_id) {
        const { data: ownerData, error: ownerErr } = await admin.auth.admin.getUserById(full.claimed_by_user_id)
        if (ownerErr || !ownerData?.user?.email) {
          console.error('[agent-api] 점유자 이메일 조회 실패:', ownerErr?.message ?? '이메일 없음')
        } else {
          claimedByUserEmail = ownerData.user.email
        }
      }
      extra = { mine: full.claimed_by_user_id === principal.userId, claimed_by_user_email: claimedByUserEmail }
    }
    return NextResponse.json({
      ok: true,
      order: {
        id: full.id, status: full.status, priority: full.priority, instructions: full.instructions,
        claimed_by: full.claimed_by, claimed_at: full.claimed_at, wbs_item_id: full.wbs_item_id,
        item, stale: isClaimStale(row.claimed_at), ...extra,
      },
      reports: reports ?? [],
      // 레거시 응답은 v1 그대로(회귀 기준선) — depends_evidence 는 PAT 전용 확장.
      ...(principal.kind === 'pat' ? { depends_evidence: dependsInfo } : {}),
    })
  } catch (e) {
    console.error('[agent-api] 상세 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
