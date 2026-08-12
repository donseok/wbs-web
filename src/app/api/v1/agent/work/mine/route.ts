import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  apiBadRequest, apiFail, apiInternalError,
  requireScope, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'
import { accessibleProjectIds, myMemberIdsAcrossProjects } from '@/lib/agent/mineShared'

/** GET /api/v1/agent/work/mine — 크로스 프로젝트 "내 작업". PAT 전용(계약 v2.0). */
export const dynamic = 'force-dynamic'

const SUPPORTED_SCOPES = ['available', 'claimed', 'all', 'assigned'] as const

type Row = { wbs_item_id: string | null } & Record<string, unknown>

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('scope') ?? 'available'
  const limitRaw = req.nextUrl.searchParams.get('limit')
  const limit = limitRaw === null ? 20 : Number(limitRaw)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return apiBadRequest('limit은 1~100 정수입니다.')
  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'legacy') return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
    const scopeErr = requireScope(principal, 'work:read')
    if (scopeErr) return scopeErr
    if (!(SUPPORTED_SCOPES as readonly string[]).includes(scope)) {
      return apiFail(400, 'unsupported_scope', `지원하지 않는 scope 입니다: ${scope}`)
    }
    const wantClaimed = scope === 'claimed' || scope === 'all'
    const wantAssigned = scope === 'assigned' || scope === 'all'
    const wantAvailable = scope === 'available' || scope === 'all'

    const projectIds = await accessibleProjectIds(admin, principal)
    if (projectIds.length === 0) {
      const empty: Record<string, unknown> = { ok: true, scope }
      if (wantClaimed) empty.claimed = []
      if (wantAssigned) empty.assigned = []
      if (wantAvailable) empty.available = []
      return NextResponse.json(empty)
    }

    let claimedRows: Row[] = []
    let assignedRows: Row[] = []
    let availableRows: Row[] = []

    // §2.4 — all 응답은 claimed → assigned → available 순으로 구획을 채운다: available 의
    // limit 절단이 방금 claim/배정된 주문을 밀어내 "내 작업이 안 보이는" 문제를 구획 분리로 막는다.
    if (wantClaimed) {
      const { data: claimed, error: claimedErr } = await admin
        .from('agent_work_orders')
        .select('id, project_id, status, priority, instructions, claimed_at, wbs_item_id, created_at')
        .in('project_id', projectIds).eq('claimed_by_user_id', principal.userId).in('status', ['claimed', 'reported'])
        .order('priority', { ascending: false }).order('created_at', { ascending: true })
        .limit(limit)
      if (claimedErr) {
        console.error('[agent-api] mine claimed 조회 실패:', claimedErr.message)
        return apiInternalError()
      }
      claimedRows = (claimed ?? []) as Row[]
    }
    if (wantAssigned) {
      const memberIds = await myMemberIdsAcrossProjects(admin, {
        userId: principal.userId, userEmail: principal.userEmail, projectIds,
      })
      if (memberIds.length > 0) {
        const { data: assignedItems, error: assignedItemErr } = await admin
          .from('wbs_items').select('id')
          .in('project_id', projectIds).in('assignee_member_id', memberIds)
        if (assignedItemErr) {
          console.error('[agent-api] mine 배정 항목 조회 실패:', assignedItemErr.message)
          return apiInternalError()
        }
        const assignedItemIds = (assignedItems ?? []).map((i) => (i as { id: string }).id)
        if (assignedItemIds.length > 0) {
          const { data: assigned, error: assignedErr } = await admin
            .from('agent_work_orders')
            .select('id, project_id, status, priority, instructions, claimed_at, wbs_item_id, created_at')
            // project_id 방어 — wbs_item_id→project_id 를 잇는 DB 제약이 없다(0057, 복합 FK 아님).
            // 항목이 접근 가능해도 주문 project_id 는 별도로 다시 좁힌다(claimed·available 과 동일 관례).
            .in('project_id', projectIds).in('wbs_item_id', assignedItemIds).in('status', ['ready', 'claimed', 'reported'])
            .order('priority', { ascending: false }).order('created_at', { ascending: true })
            .limit(limit)
          if (assignedErr) {
            console.error('[agent-api] mine assigned 조회 실패:', assignedErr.message)
            return apiInternalError()
          }
          assignedRows = (assigned ?? []) as Row[]
        }
      }
    }
    if (wantAvailable) {
      const { data: orders, error } = await admin
        .from('agent_work_orders')
        .select('id, project_id, status, priority, instructions, claimed_at, wbs_item_id, created_at')
        .in('project_id', projectIds).eq('status', 'ready')
        .order('priority', { ascending: false }).order('created_at', { ascending: true })
        .limit(limit)
      if (error) {
        console.error('[agent-api] mine 목록 조회 실패:', error.message)
        return apiInternalError()
      }
      availableRows = (orders ?? []) as Row[]
    }

    const allRows = [...claimedRows, ...assignedRows, ...availableRows]
    const itemIds = [...new Set(allRows.map(o => o.wbs_item_id).filter((v): v is string => !!v))]
    const itemById = new Map<string, unknown>()
    if (itemIds.length > 0) {
      const { data: items, error: itemErr } = await admin
        .from('wbs_items').select('id, code, name, planned_start, planned_end').in('id', itemIds)
      if (itemErr) {
        console.error('[agent-api] mine 항목 컨텍스트 조회 실패:', itemErr.message)
        return apiInternalError()
      }
      for (const it of (items ?? []) as Array<{ id: string }>) itemById.set(it.id, it)
    }
    const withItem = (rows: Row[]) =>
      rows.map(o => ({ ...o, item: o.wbs_item_id ? itemById.get(o.wbs_item_id) ?? null : null }))

    const body: Record<string, unknown> = { ok: true, scope }
    if (wantClaimed) body.claimed = withItem(claimedRows)
    if (wantAssigned) body.assigned = withItem(assignedRows)
    if (wantAvailable) body.available = withItem(availableRows)
    return NextResponse.json(body)
  } catch (e) {
    console.error('[agent-api] mine 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const POST = () => apiFail(404, 'not_found', 'Not Found')
export const PUT = POST
export const DELETE = POST
export const PATCH = POST
export const OPTIONS = POST
