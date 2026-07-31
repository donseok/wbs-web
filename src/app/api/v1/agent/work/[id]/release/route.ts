import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/minutes/externalApi'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound, gateAgentApi } from '@/lib/agent/externalApi'
import { loadGatedOrder, parseAgentActor } from '@/lib/agent/routeShared'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = gateAgentApi(req)
  if (gate) return gate
  const { id } = await ctx.params
  if (!isUuid(id)) return apiBadRequest('경로 id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const actor = parseAgentActor(raw)
  if ('error' in actor) return apiBadRequest(actor.error)
  try {
    const admin = createAdminClient()
    const loaded = await loadGatedOrder(admin, id, actor.userEmail)
    if (!loaded.ok) return loaded.res
    // 본인 점유만 반납 — 남의 점유를 뺏는 회수는 사람(UI, Task 8) 몫이다.
    if (loaded.order.claimed_by !== actor.agent) {
      return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 반납할 수 있습니다.')
    }
    const { data: updated, error } = await admin
      .from('agent_work_orders')
      .update({ status: 'ready', claimed_by: null, claimed_at: null, updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'claimed').eq('claimed_by', actor.agent)
      .select('id')
    if (error) {
      console.error('[agent-api] release 갱신 실패:', error.message)
      return apiInternalError()
    }
    if (!updated || (updated as unknown[]).length === 0) {
      return apiFail(409, 'conflict', '반납 가능한 상태가 아닙니다.')
    }
    return NextResponse.json({ ok: true, status: 'ready' })
  } catch (e) {
    console.error('[agent-api] release 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
