import { NextRequest, NextResponse } from 'next/server'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiBadRequest, apiInternalError, apiNotFound, gateAgentApi } from '@/lib/agent/externalApi'
import { loadGatedOrder, parseAgentActor } from '@/lib/agent/routeShared'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = gateAgentApi(req)
  if (gate) return gate
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('경로 id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const actor = parseAgentActor(raw)
  if ('error' in actor) return apiBadRequest(actor.error)
  try {
    const admin = createAdminClient()
    const loaded = await loadGatedOrder(admin, id, actor.userEmail)
    if (!loaded.ok) return loaded.res

    // CAS: ready 일 때만 점유된다 — 동시 claim 은 한쪽이 0행을 본다.
    const { data: updated, error: casErr } = await admin
      .from('agent_work_orders')
      .update({
        status: 'claimed', claimed_by: actor.agent,
        claimed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      .eq('id', id).eq('status', 'ready')
      .select('id')
    if (casErr) {
      console.error('[agent-api] claim 갱신 실패:', casErr.message)
      return apiInternalError()
    }
    if (!updated || (updated as unknown[]).length === 0) {
      const { data: cur } = await admin
        .from('agent_work_orders').select('status').eq('id', id).maybeSingle()
      return NextResponse.json(
        { error: '이미 다른 에이전트가 점유했거나 점유 불가 상태입니다.', code: 'conflict', status: (cur as { status?: string } | null)?.status ?? 'unknown' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true, status: 'claimed' })
  } catch (e) {
    console.error('[agent-api] claim 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
