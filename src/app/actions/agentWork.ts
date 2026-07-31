'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin, requireSuperuser } from '@/lib/authz'
import { updateActual } from '@/app/actions/wbs'
import { isUuidLike } from '@/lib/domain/agentWork'

/**
 * 에이전트 작업 루프 UI 서버 액션 — 스펙 §5.
 * 쓰기는 admin(service_role) 경유(신규 테이블은 쓰기 RLS 가 없다 — 서버 가드가 유일한 관문).
 * 조회(fetchAgentOps)만 세션 클라이언트로 해 RLS 조회 정책을 2차 방어선으로 쓴다.
 */

const AGENT_OPS_PATH = '/agent-ops'

type ActionResult = { ok: boolean; error?: string }

export async function registerAgentProject(projectId: string, note: string): Promise<ActionResult> {
  if (!isUuidLike(projectId)) return { ok: false, error: '잘못된 요청입니다.' }
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { data, error } = await admin.from('agent_projects')
    .insert({ project_id: projectId, note: note.trim() || null, created_by: g.actor.userId })
    .select('project_id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: '등록에 실패했습니다.' }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export async function unregisterAgentProject(projectId: string): Promise<ActionResult> {
  if (!isUuidLike(projectId)) return { ok: false, error: '잘못된 요청입니다.' }
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { error } = await admin.from('agent_projects').delete().eq('project_id', projectId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export async function createAgentWorkOrder(
  projectId: string, wbsItemId: string, instructions: string, priority: number,
): Promise<ActionResult & { id?: string }> {
  if (!isUuidLike(projectId) || !isUuidLike(wbsItemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  // 등록 게이트 — 에이전트 루프가 이 프로젝트에 열려 있지 않으면 발행 자체를 막는다.
  // 외부 API(§2 "프로젝트 게이트")와 같은 조건이라 여기서도 통과 못 하면 애초에 claim 될 수 없는 주문이 쌓인다.
  const { data: reg, error: regErr } = await admin
    .from('agent_projects').select('project_id, enabled').eq('project_id', projectId).maybeSingle()
  if (regErr) return { ok: false, error: `등록 조회 실패: ${regErr.message}` }
  if (!reg || !(reg as { enabled: boolean }).enabled) {
    return { ok: false, error: '에이전트 루프가 등록되지 않은 프로젝트입니다.' }
  }
  // 쓰기 선행조회 — 항목 실재·프로젝트 일치·리프 여부. 실패는 중단(3원칙).
  const { data: item, error: itemErr } = await admin
    .from('wbs_items').select('id, project_id').eq('id', wbsItemId).maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '항목 없음' }
  if ((item as { project_id: string }).project_id !== projectId) {
    return { ok: false, error: '이 프로젝트의 항목이 아닙니다.' }
  }
  const { data: child, error: childErr } = await admin
    .from('wbs_items').select('id').eq('parent_id', wbsItemId).limit(1).maybeSingle()
  if (childErr) return { ok: false, error: `하위 항목 확인 실패: ${childErr.message}` }
  if (child) return { ok: false, error: '리프 항목만 발행할 수 있습니다.' }

  const { data, error } = await admin.from('agent_work_orders')
    .insert({
      project_id: projectId, wbs_item_id: wbsItemId,
      instructions: instructions.trim(), priority: Math.trunc(priority) || 0,
      created_by: g.actor.userId,
    })
    .select('id')
  if (error) return { ok: false, error: error.message }
  const id = (data?.[0] as { id?: string } | undefined)?.id
  if (!id) return { ok: false, error: '발행에 실패했습니다.' }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true, id }
}

async function loadOrderForAdmin(orderId: string): Promise<
  | { ok: true; order: { id: string; project_id: string; status: string; wbs_item_id: string | null }; actor: { userId: string } }
  | { ok: false; error: string }
> {
  if (!isUuidLike(orderId)) return { ok: false, error: '잘못된 요청입니다.' }
  const admin = createAdminClient()
  const { data: order, error } = await admin
    .from('agent_work_orders').select('id, project_id, status, wbs_item_id').eq('id', orderId).maybeSingle()
  if (error) return { ok: false, error: `주문 조회 실패: ${error.message}` }
  if (!order) return { ok: false, error: '주문 없음' }
  const row = order as { id: string; project_id: string; status: string; wbs_item_id: string | null }
  const g = await requireProjectAdmin(row.project_id)
  if (!g.ok) return { ok: false, error: g.error }
  return { ok: true, order: row, actor: g.actor }
}

/** 승인 — WBS 100% 반영이 먼저다. 반영 실패면 주문은 reported 로 남아 재시도 가능해야 한다. */
export async function approveAgentCompletion(orderId: string): Promise<ActionResult> {
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  const { order, actor } = loaded
  if (order.status !== 'reported') return { ok: false, error: `승인 가능한 상태가 아닙니다(${order.status}).` }
  if (!order.wbs_item_id) return { ok: false, error: 'WBS 항목이 삭제된 주문입니다. 취소로 정리하세요.' }

  const applied = await updateActual(order.wbs_item_id, 100)
  if (!applied.ok) return { ok: false, error: applied.error ?? 'WBS 반영 실패' }

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data: updated, error: casErr } = await admin
    .from('agent_work_orders')
    .update({ status: 'approved', updated_at: now })
    .eq('id', orderId).eq('status', 'reported')
    .select('id')
  if (casErr) return { ok: false, error: casErr.message }
  if (!updated || updated.length === 0) {
    // WBS 는 100 이 됐는데 주문 전이가 경합으로 밀렸다 — 재시도하면 updateActual(100) 은 멱등.
    // 경합 시나리오: 승인자 A 가 updateActual(100) 을 실행하는 사이 다른 관리자 B 가 같은 주문을
    // 반려(reported→claimed)하면, 이 CAS(.eq('status','reported')) 는 0행이 된다. 이때 WBS 실적은
    // 이미 100%로 반영된 채 남고 주문은 claimed(반려됨)로 보인다 — 침묵하면 사람이 그 사실을 놓친다.
    // 그래서 현재 상태를 재조회해 claimed 면 "실적이 이미 100%로 반영됐다"고 명시적으로 알린다.
    const { data: current, error: reErr } = await admin
      .from('agent_work_orders').select('status').eq('id', orderId).maybeSingle()
    if (reErr) {
      console.error('[agentWork] 승인 경합 재조회 실패:', reErr.message)
    } else if ((current as { status?: string } | null)?.status === 'claimed') {
      return {
        ok: false,
        error: '다른 관리자의 반려와 경합했습니다. WBS 실적이 이미 100%로 반영되었으니 확인 후 정정하세요.',
      }
    }
    return { ok: false, error: '상태가 바뀌어 승인하지 못했습니다. 다시 시도하세요.' }
  }
  const { data: latest, error: latestErr } = await admin
    .from('agent_work_reports').select('id').eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (latestErr || !latest) {
    console.error('[agentWork] 승인 보고 조회 실패:', latestErr?.message ?? '0행')
  } else {
    const { error: revErr } = await admin.from('agent_work_reports')
      .update({ review_action: 'approve', reviewed_by: actor.userId, reviewed_at: now })
      .eq('id', (latest as { id: string }).id).select('id')
    if (revErr) console.error('[agentWork] 승인 기록 실패:', revErr.message)
  }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export async function rejectAgentCompletion(orderId: string, note: string): Promise<ActionResult> {
  const trimmed = note.trim()
  if (!trimmed) return { ok: false, error: '반려 사유가 필요합니다.' }
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  const { order, actor } = loaded
  if (order.status !== 'reported') {
    return { ok: false, error: `반려 가능한 상태가 아닙니다(${order.status}).` }
  }
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data: updated, error: casErr } = await admin
    .from('agent_work_orders')
    .update({ status: 'claimed', updated_at: now })
    .eq('id', orderId).eq('status', 'reported')
    .select('id')
  if (casErr) return { ok: false, error: casErr.message }
  if (!updated || updated.length === 0) return { ok: false, error: '상태가 바뀌어 반려하지 못했습니다.' }
  const { data: latest, error: latestErr } = await admin
    .from('agent_work_reports').select('id').eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (latestErr || !latest) {
    console.error('[agentWork] 반려 보고 조회 실패:', latestErr?.message ?? '0행')
  } else {
    const { error: revErr } = await admin.from('agent_work_reports')
      .update({ review_action: 'reject', reviewed_by: actor.userId, reviewed_at: now, review_note: trimmed })
      .eq('id', (latest as { id: string }).id).select('id')
    if (revErr) console.error('[agentWork] 반려 기록 실패:', revErr.message)
  }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export async function reclaimAgentOrder(orderId: string): Promise<ActionResult> {
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  if (loaded.order.status !== 'claimed') return { ok: false, error: '점유 상태가 아닙니다.' }
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('agent_work_orders')
    .update({ status: 'ready', claimed_by: null, claimed_at: null, updated_at: new Date().toISOString() })
    .eq('id', orderId).eq('status', 'claimed')
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '상태가 바뀌어 회수하지 못했습니다.' }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export async function cancelAgentOrder(orderId: string): Promise<ActionResult> {
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  if (!['ready', 'claimed', 'reported'].includes(loaded.order.status)) {
    return { ok: false, error: '취소 가능한 상태가 아닙니다.' }
  }
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('agent_work_orders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', orderId).in('status', ['ready', 'claimed', 'reported'])
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '상태가 바뀌어 취소하지 못했습니다.' }
  revalidatePath(AGENT_OPS_PATH)
  return { ok: true }
}

export type AgentOpsReport = {
  id: string; kind: 'progress' | 'completion'; percent: number; summary: string
  links: { label?: string; url: string }[]; agent: string
  review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string
}
export type AgentOpsOrder = {
  id: string; status: string; priority: number; instructions: string
  claimed_by: string | null; claimed_at: string | null; updated_at: string
  wbs_item_id: string | null; item_name: string | null; item_code: string | null
  reports: AgentOpsReport[]
}

/** 관제 보드 데이터 — 세션 클라이언트(RLS 조회 정책이 2차 방어선). 조회 실패는 위장하지 않는다. */
export async function fetchAgentOps(projectId: string): Promise<
  | { ok: true; registered: boolean; orders: AgentOpsOrder[] }
  | { ok: false; error: string }
> {
  if (!isUuidLike(projectId)) return { ok: false, error: '잘못된 요청입니다.' }
  const sb = await createServerClient()
  const { data: reg, error: regErr } = await sb
    .from('agent_projects').select('project_id, enabled').eq('project_id', projectId).maybeSingle()
  if (regErr) return { ok: false, error: `등록 조회 실패: ${regErr.message}` }
  if (!reg) return { ok: true, registered: false, orders: [] }

  const { data: orders, error: ordErr } = await sb
    .from('agent_work_orders')
    .select('id, status, priority, instructions, claimed_by, claimed_at, updated_at, wbs_item_id')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
  if (ordErr) return { ok: false, error: `주문 조회 실패: ${ordErr.message}` }
  const rows = (orders ?? []) as Array<Omit<AgentOpsOrder, 'reports' | 'item_name' | 'item_code'>>

  const itemIds = [...new Set(rows.map(o => o.wbs_item_id).filter((v): v is string => !!v))]
  const itemById = new Map<string, { name: string; code: string }>()
  if (itemIds.length > 0) {
    const { data: items, error: itemErr } = await sb
      .from('wbs_items').select('id, name, code').in('id', itemIds)
    if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
    for (const it of (items ?? []) as Array<{ id: string; name: string; code: string }>) {
      itemById.set(it.id, { name: it.name, code: it.code })
    }
  }
  const orderIds = rows.map(o => o.id)
  const reportsByOrder = new Map<string, AgentOpsReport[]>()
  if (orderIds.length > 0) {
    const { data: reports, error: repErr } = await sb
      .from('agent_work_reports')
      .select('id, work_order_id, kind, percent, summary, links, agent, review_action, review_note, created_at')
      .in('work_order_id', orderIds)
      .order('created_at', { ascending: true })
    if (repErr) return { ok: false, error: `보고 조회 실패: ${repErr.message}` }
    for (const r of (reports ?? []) as Array<AgentOpsReport & { work_order_id: string }>) {
      const list = reportsByOrder.get(r.work_order_id) ?? []
      list.push(r)
      reportsByOrder.set(r.work_order_id, list)
    }
  }
  return {
    ok: true, registered: (reg as { enabled: boolean }).enabled,
    orders: rows.map(o => ({
      ...o,
      item_name: o.wbs_item_id ? itemById.get(o.wbs_item_id)?.name ?? null : null,
      item_code: o.wbs_item_id ? itemById.get(o.wbs_item_id)?.code ?? null : null,
      reports: reportsByOrder.get(o.id) ?? [],
    })),
  }
}
