// 에이전트 허브 조회 — 서버 전용(service_role). 1차 6건 병렬 + 2차(살아 있는 주문의 완료 보고) 1건.
// 실패는 throw 한다(에러 3원칙: 조회 실패를 데이터 없음으로 위장하지 않는다).
// 스펙: docs/superpowers/specs/2026-09-14-agent-hub-design.md §4-1
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import type { OrderRow, WatcherRow } from '@/lib/domain/seatmap'
import { DONE_WINDOW_MS, viewerEmail } from '@/lib/data/agentSeatmap'
import {
  assembleAgentHub, type AgentHub, type AgentHubRows, type HubItemRow, type HubMemberRow, type HubReportRow,
} from '@/lib/domain/agentHub'

export const HUB_ITEM_COLS = 'id, project_id, parent_id, code, name, sort_order, milestone, dev_workflow, tags, assignee_member_id, agent_prompt, actual_pct, stage, external_ref, depends'
const ORDER_COLS = 'id, project_id, wbs_item_id, status, claimed_by, claimed_by_user_id, claimed_at, created_at, updated_at, last_heartbeat_at, heartbeat_phase, heartbeat_agent, heartbeat_note'
const REPORT_COLS = 'work_order_id, percent, summary, links, agent, review_action, review_note, created_at'
const WATCHER_COLS = 'id, user_id, project_id, agent, host, slots, busy, until_label, last_seen_at'

function must<T>(what: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`[agent-hub] ${what} 조회 실패: ${r.error.message}`)
  return (r.data ?? []) as T
}

export async function fetchAgentHubRows(admin: AdminClient, projectId: string, nowMs: number): Promise<AgentHubRows> {
  const doneSince = new Date(nowMs - DONE_WINDOW_MS).toISOString()
  const [items, agentProject, orders, watchers, members, projects] = await Promise.all([
    admin.from('wbs_items').select(HUB_ITEM_COLS).eq('project_id', projectId).then(r => must<HubItemRow[]>('항목', r)),
    admin.from('agent_projects').select('enabled').eq('project_id', projectId).maybeSingle().then(r => {
      if (r.error) throw new Error(`[agent-hub] 등록 조회 실패: ${r.error.message}`)
      return r.data ? { enabled: (r.data as { enabled: boolean }).enabled === true } : null
    }),
    admin.from('agent_work_orders').select(ORDER_COLS).eq('project_id', projectId)
      .or(`status.in.(ready,claimed,reported),and(status.eq.approved,updated_at.gte.${doneSince})`)
      .order('created_at', { ascending: false }).limit(2000).then(r => must<OrderRow[]>('주문', r)),
    admin.from('agent_watchers').select(WATCHER_COLS)
      .gte('last_seen_at', new Date(nowMs - WATCHER_TTL_MS).toISOString()).then(r => must<WatcherRow[]>('감시자', r)),
    admin.from('project_members').select('id, name, email, user_id').eq('project_id', projectId).then(r => must<HubMemberRow[]>('로스터', r)),
    admin.from('projects').select('id, name').eq('id', projectId).then(r => must<Array<{ id: string; name: string }>>('프로젝트', r)),
  ])
  // 완료 보고는 주문 id 로만 거를 수 있어 2차로 간다(PostgREST 에 project_id 조인이 없다). 살아 있는 주문이 없으면 생략.
  const liveIds = orders.filter(o => o.status === 'ready' || o.status === 'claimed' || o.status === 'reported').map(o => o.id)
  const reports = liveIds.length
    ? must<HubReportRow[]>('완료 보고', await admin.from('agent_work_reports').select(REPORT_COLS).in('work_order_id', liveIds).eq('kind', 'completion'))
    : []
  // 선행 승인 여부 — 위임 항목의 depends 가 가리키는 항목 id 로 approved 주문을 1회(주문 조회는 7일 창이라 오래전 승인이 빠진다). 선행이 없으면 생략.
  const refs = new Set(items.filter(i => (i.tags ?? []).includes('agent')).flatMap(i => i.depends ?? []))
  const predIds = items.filter(i => i.external_ref !== null && refs.has(i.external_ref)).map(i => i.id)
  const approvedItemIds = predIds.length
    ? must<Array<{ wbs_item_id: string }>>('선행 승인 주문', await admin.from('agent_work_orders').select('wbs_item_id').in('wbs_item_id', predIds).eq('status', 'approved')).map(r => r.wbs_item_id)
    : []
  return { project: projects[0] ?? null, agentProject, items, orders, reports, watchers, members, approvedItemIds }
}

export async function getAgentHub(projectId: string, viewer: { userId: string; isAdmin: boolean }, nowMs = Date.now()): Promise<AgentHub> {
  const admin = createAdminClient()
  const [rows, userEmail] = await Promise.all([fetchAgentHubRows(admin, projectId, nowMs), viewerEmail(admin, viewer.userId)])
  return assembleAgentHub(rows, nowMs, { userId: viewer.userId, userEmail, isAdmin: viewer.isAdmin })
}
