import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import {
  apiBadRequest, apiInternalError, apiNotFound, gateAgentApi, requireAgentProject,
} from '@/lib/agent/externalApi'

/** GET /api/v1/agent/work?project_id= — ready 작업 목록 + 항목 컨텍스트. 계약: 스펙 §3.2. */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = gateAgentApi(req)
  if (gate) return gate
  const projectId = req.nextUrl.searchParams.get('project_id') ?? ''
  if (!projectId || !isUuidLike(projectId)) return apiBadRequest('project_id가 필요합니다.')
  try {
    const admin = createAdminClient()
    if (!(await requireAgentProject(admin, projectId))) return apiNotFound()

    const { data: orders, error } = await admin
      .from('agent_work_orders')
      .select('id, status, priority, instructions, claimed_by, claimed_at, wbs_item_id')
      .eq('project_id', projectId).eq('status', 'ready')
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
