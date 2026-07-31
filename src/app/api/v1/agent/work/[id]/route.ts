import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/minutes/externalApi'
import { isClaimStale } from '@/lib/domain/agentWork'
import {
  apiBadRequest, apiInternalError, apiNotFound, gateAgentApi, requireAgentProject,
} from '@/lib/agent/externalApi'

/** GET /api/v1/agent/work/{id} — 상태 폴링. 에이전트는 여기서 승인/반려·반려 사유를 읽는다(스펙 §3.4-2). */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = gateAgentApi(req)
  if (gate) return gate
  const { id } = await ctx.params
  if (!isUuid(id)) return apiBadRequest('유효한 작업 ID가 필요합니다.')
  try {
    const admin = createAdminClient()
    const { data: order, error } = await admin
      .from('agent_work_orders')
      .select('id, project_id, status, priority, instructions, claimed_by, claimed_at, wbs_item_id')
      .eq('id', id).maybeSingle()
    if (error) {
      console.error('[agent-api] 주문 조회 실패:', error.message)
      return apiInternalError()
    }
    if (!order) return apiNotFound()
    const row = order as { project_id: string; claimed_at: string | null; wbs_item_id: string | null }
    // 미등록 프로젝트의 주문은 존재 자체를 숨긴다 — 게이트 순서상 등록 해제 뒤에도 새지 않게.
    if (!(await requireAgentProject(admin, row.project_id))) return apiNotFound()

    const { data: reports, error: repErr } = await admin
      .from('agent_work_reports')
      .select('id, kind, percent, summary, links, agent, review_action, review_note, created_at')
      .eq('work_order_id', id).order('created_at', { ascending: true })
    if (repErr) {
      console.error('[agent-api] 보고 이력 조회 실패:', repErr.message)
      return apiInternalError()
    }
    let item: unknown = null
    if (row.wbs_item_id) {
      const { data: items, error: itemErr } = await admin
        .from('wbs_items')
        .select('id, code, name, biz, deliverable, planned_start, planned_end')
        .in('id', [row.wbs_item_id])
      if (itemErr) {
        console.error('[agent-api] 항목 컨텍스트 조회 실패:', itemErr.message)
        return apiInternalError()
      }
      item = (items ?? [])[0] ?? null
    }
    const { project_id: _, ...orderWithoutProject } = order
    return NextResponse.json({
      ok: true,
      order: { ...orderWithoutProject, item, stale: isClaimStale(row.claimed_at) },
      reports: reports ?? [],
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
