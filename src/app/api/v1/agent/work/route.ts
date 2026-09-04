import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import {
  apiBadRequest, apiInternalError, apiNotFound, isAgentProjectMember, patProjectAllowed,
  requireAgentProject, requireScope, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'

/** GET /api/v1/agent/work?project_id=[&status=] — 작업 목록 + 항목 컨텍스트. 계약: 스펙 §3.2. */
export const dynamic = 'force-dynamic'

/** agent_work_orders.status 체크 제약(0057:25)과 같은 집합. 여기서만 검증한다. */
const ORDER_STATUSES = ['ready', 'claimed', 'reported', 'approved', 'cancelled'] as const

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('project_id') ?? ''
  if (!projectId || !isUuidLike(projectId)) return apiBadRequest('project_id가 필요합니다.')
  // status 미지정은 종전대로 ready — 기존 클라이언트의 응답이 바뀌지 않는다.
  // 지정하면 쉼표로 여럿. 종전에는 어떤 목록 엔드포인트도 approved·cancelled 를 돌려주지 않아
  // 주문 id 를 통째로 알고 있어야만 그 주문을 볼 수 있었다 — 알아야 볼 수 있고 보려면 알아야 하는
  // 구조라, 승인 뒤 무슨 일이 있었는지 추적할 방법이 없었다(2026-08-27 감사).
  const statusParam = req.nextUrl.searchParams.get('status')
  const statuses = statusParam === null
    ? ['ready']
    : statusParam.split(',').map(v => v.trim()).filter(v => v !== '')
  if (statuses.length === 0) return apiBadRequest('status 가 비었습니다.')
  const unknown = statuses.filter(v => !(ORDER_STATUSES as readonly string[]).includes(v))
  // 모르는 값을 조용히 버리면 오타가 "그 상태의 주문이 없다"로 위장한다 — 400 으로 되돌린다.
  if (unknown.length > 0) {
    return apiBadRequest(`알 수 없는 status: ${unknown.join(', ')} (허용: ${ORDER_STATUSES.join(', ')})`)
  }
  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'pat') {
      const scopeErr = requireScope(principal, 'work:read')
      if (scopeErr) return scopeErr
      if (!patProjectAllowed(principal, projectId)) return apiNotFound()
    }
    if (!(await requireAgentProject(admin, projectId))) return apiNotFound()
    if (principal.kind === 'pat' && !(await isAgentProjectMember(admin, principal.userId, projectId))) {
      return apiNotFound() // 비멤버 404 — 존재 은닉 관례(§2.2)
    }

    const { data: orders, error } = await admin
      .from('agent_work_orders')
      .select('id, status, priority, instructions, claimed_by, claimed_at, wbs_item_id')
      .eq('project_id', projectId).in('status', statuses)
      .order('priority', { ascending: false }).order('created_at', { ascending: true })
    if (error) {
      console.error('[agent-api] 주문 목록 조회 실패:', error.message)
      return apiInternalError()
    }
    const rows = (orders ?? []) as Array<{ wbs_item_id: string | null } & Record<string, unknown>>
    const itemIds = [...new Set(rows.map(o => o.wbs_item_id).filter((v): v is string => !!v))]
    const itemById = new Map<string, unknown>()
    if (itemIds.length > 0) {
      const { data: items, error: itemErr } = await admin
        .from('wbs_items')
        .select('id, code, name, biz, deliverable, planned_start, planned_end')
        .in('id', itemIds)
      if (itemErr) {
        console.error('[agent-api] 항목 컨텍스트 조회 실패:', itemErr.message)
        return apiInternalError()
      }
      for (const it of (items ?? []) as Array<{ id: string }>) itemById.set(it.id, it)
    }
    return NextResponse.json({
      ok: true,
      orders: rows.map(o => ({ ...o, item: o.wbs_item_id ? itemById.get(o.wbs_item_id) ?? null : null })),
    })
  } catch (e) {
    console.error('[agent-api] 목록 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
