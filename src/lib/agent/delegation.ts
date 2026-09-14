// 에이전트 위임(agent 태그) — 자격 판정과 본체. 서버 액션 파일('use server')에서 분리한 이유:
// 'use server' 모듈의 export 는 전부 클라이언트가 부를 수 있는 액션이 되므로, 가드 없는 본체(applyDelegation)를
// 거기 두면 누구나 admin 클라이언트 없이도 호출 경로가 열린다. 액션은 가드만 하고 여기를 부른다.
// 스펙: docs/superpowers/specs/2026-09-14-agent-hub-design.md §3·§5
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { AGENT_TAG } from '@/lib/domain/seatmap'
import { myMemberIds } from '@/lib/agent/assignee'
import { viewerEmail } from '@/lib/data/agentSeatmap'
import { backfillProjectOrders, ensureAgentProject, ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'
import { transitionStage } from '@/lib/agent/stageTransition'

export const ERR_NOT_ASSIGNEE = '담당자 본인 또는 프로젝트 관리자만 바꿀 수 있습니다.'
export const ERR_AGENT_OFF = '프로젝트 에이전트가 꺼져 있습니다. 관리자가 에이전트 페이지에서 켜야 합니다.'

export type AgentDelegationResult = {
  ok: boolean; error?: string
  /** 사람이 알아야 할 부수 상황 — 프로젝트가 중지 상태라 주문이 안 나갔다, 진행 중 주문은 회수하지 않았다 등. */
  warning?: string
}

export type DelegationRight =
  | { ok: true; actor: { userId: string }; projectId: string; isAdmin: boolean }
  | { ok: false; error: string }

/**
 * 위임·프롬프트 편집 자격(2026-09-14 허브 스펙 §3): 프로젝트 관리자 **또는** 그 항목의 담당자 본인(멤버).
 * 관리자 가드를 먼저 물어 관리자는 추가 조회 없이 통과한다. 멤버는 항목의 assignee_member_id 가
 * 내 로스터 행(myMemberIds: user_id 링크 또는 이메일 일치)에 들어 있어야 한다. 조회 실패는 거부(fail-closed).
 */
export async function requireDelegationRight(itemId: string): Promise<DelegationRight> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const resolved = await resolveProjectId('wbs_items', itemId)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  if (resolved.projectId === null) return { ok: false, error: '대상을 찾을 수 없습니다.' }
  const projectId = resolved.projectId
  const a = await requireProjectAdmin(projectId)
  if (a.ok) return { ok: true, actor: { userId: a.actor.userId }, projectId, isAdmin: true }
  const m = await requireProjectMember(projectId)
  if (!m.ok) return { ok: false, error: m.error }
  const admin = createAdminClient()
  const { data: item, error } = await admin.from('wbs_items').select('assignee_member_id').eq('id', itemId).maybeSingle()
  if (error) return { ok: false, error: `항목 조회 실패: ${error.message}` }
  const assignee = (item as { assignee_member_id: string | null } | null)?.assignee_member_id ?? null
  if (!assignee) return { ok: false, error: ERR_NOT_ASSIGNEE }
  try {
    const email = await viewerEmail(admin, m.actor.userId)
    const mine = await myMemberIds(admin, { userId: m.actor.userId, userEmail: email ?? '', projectId })
    if (!mine.includes(assignee)) return { ok: false, error: ERR_NOT_ASSIGNEE }
  } catch (e) {
    console.error('[delegation] 담당자 판정 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: '담당자 판정에 실패했습니다.' }
  }
  return { ok: true, actor: { userId: m.actor.userId }, projectId, isAdmin: false }
}

/**
 * 위임 토글 본체(2026-08-24 재정의 — "위임 체크 = 발행"). 사람이 하는 결정은 이것 하나다:
 *
 * ON : tags 에 agent 추가 → 프로젝트 자동 활성(처음이면 백필) → dev_workflow ON(아니었으면) → 이 항목 주문 보장.
 *      프로젝트가 "에이전트 중지"(enabled=false) 상태면 태그는 붙이되 주문은 안 나간다 — warning 으로 알린다.
 *      멤버(비관리자)는 프로젝트가 등록·활성일 때만 ON 할 수 있다 — 등록·백필은 프로젝트 범위 부작용이라 관리자 행위다.
 * OFF: tags 에서 agent 제거 → 이 항목의 ready·claimed 주문 취소. reported 는 결과물이 올라온 상태라 건드리지 않고 warning.
 *
 * dev_workflow 는 여기서 켜기만 하고 끄지 않는다(위임 해제 ≠ 워크플로 이탈 — 사람이 직접 할 수도 있다).
 * revalidatePath 는 호출부(액션) 책임 — 일괄 위임이 항목마다 부르면서 마지막에 1회만 하려는 것.
 */
export async function applyDelegation(
  admin: AdminClient,
  args: { itemId: string; projectId: string; delegated: boolean; actorUserId: string; isAdmin: boolean },
): Promise<AgentDelegationResult> {
  const { itemId, projectId, delegated, actorUserId } = args
  const { data: row, error: readErr } = await admin
    .from('wbs_items').select('tags, dev_workflow').eq('id', itemId).single()
  if (readErr) return { ok: false, error: readErr.message }
  if (!args.isAdmin && delegated) {
    const { data: reg, error: regErr } = await admin.from('agent_projects').select('enabled').eq('project_id', projectId).maybeSingle()
    if (regErr) return { ok: false, error: `등록 조회 실패: ${regErr.message}` }
    if (!reg || (reg as { enabled: boolean }).enabled !== true) return { ok: false, error: ERR_AGENT_OFF }
  }
  const tags: string[] = (row as { tags: string[] | null } | null)?.tags ?? []
  const alreadyDelegated = tags.includes(AGENT_TAG)
  if (alreadyDelegated !== delegated) {
    const next = delegated ? [...tags, AGENT_TAG] : tags.filter(tg => tg !== AGENT_TAG)
    const { data: updated, error } = await admin
      .from('wbs_items')
      .update({ tags: next, updated_at: new Date().toISOString() })
      .eq('id', itemId).select('id')
    if (error) return { ok: false, error: error.message }
    if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  }

  const warnings: string[] = []
  if (delegated) {
    // 1) 프로젝트 활성 — 처음이면 백필(활성 전에 업로드된 task 들의 주문을 여기서 채운다). 멤버 경로는 위에서 등록·활성을 확인했다.
    const proj = await ensureAgentProject(admin, { projectId, actorUserId })
    if (!proj.ok) return { ok: false, error: proj.error }
    if (proj.activated) {
      const bf = await backfillProjectOrders(admin, { projectId, actorUserId })
      if (!bf.ok) warnings.push(bf.error)
      else if (bf.failed.length > 0) warnings.push(`백필 중 ${bf.failed.length}건 주문 보장 실패(서버 로그 확인)`)
    }
    // 2) dev_workflow ON — 위임은 워크플로 도입을 함의한다(체크 이중화 해소). 이미 ON 이면 no-op.
    //    setWbsDevWorkflow(관리자 가드)를 부르지 않고 같은 부수효과(이력·초기 as 전이)를 여기서 낸다 — 멤버 경로도 같은 길을 가야 한다.
    if ((row as { dev_workflow: boolean | null } | null)?.dev_workflow !== true) {
      const nowIso = new Date().toISOString()
      const { data: dwRows, error: dwErr } = await admin
        .from('wbs_items')
        .update({ dev_workflow: true, updated_at: nowIso })
        .eq('id', itemId).neq('dev_workflow', true)
        .select('id, assignee_member_id, stage')
      if (dwErr) return { ok: false, error: `dev_workflow 갱신 실패: ${dwErr.message}` }
      const dw = ((dwRows ?? []) as Array<{ id: string; assignee_member_id: string | null; stage: string | null }>)[0]
      if (dw) {
        const { error: logErr } = await admin.from('change_logs').insert({
          user_id: actorUserId, wbs_item_id: itemId, field: 'dev_workflow', old_value: 'false', new_value: 'true',
        })
        if (logErr) console.error('[delegation] dev_workflow 변경 이력 기록 실패:', logErr.message)
        if (dw.assignee_member_id && dw.stage === null) {
          try {
            const tr = await transitionStage(admin, { itemId, to: 'as', fromIn: [null], actorUserId })
            if (!tr.ok) console.error('[delegation] dev_workflow ON stage 전이 실패:', itemId)
          } catch (e) {
            console.error('[delegation] dev_workflow ON stage 전이 예외:', e)
          }
        }
      }
    }
    // 3) 이 항목 주문 보장 — 멱등(활성 주문 있으면 skip)
    if (proj.stopped) {
      warnings.push('프로젝트가 "에이전트 중지" 상태라 주문을 발행하지 않았습니다. 에이전트 페이지에서 켜면 발행됩니다.')
    } else {
      const ord = await ensureOrderForWorkflowLeaf(admin, { projectId, wbsItemId: itemId, actorUserId })
      if (!ord.ok) return { ok: false, error: ord.error }
      if (!ord.created && ord.reason === 'not_leaf') warnings.push('리프(하위 없음) 항목만 에이전트가 집어갑니다 — 이 항목은 하위가 있어 주문이 없습니다.')
    }
  } else {
    // ready·claimed 는 체크 해제만으로 취소한다(2026-08-24 — "회수" 버튼을 따로 안 둔다: 위임을
    // 끄면 그 항목엔 에이전트를 더 안 쓰겠다는 뜻이니 대기 중이든 작업 중이든 그대로 끝낸다).
    // reported 는 이미 결과물이 올라온 상태라 취소로 지우지 않는다 — 승인·반려로만 정리한다.
    const { data: active, error: actErr } = await admin
      .from('agent_work_orders').select('id, status').eq('wbs_item_id', itemId)
      .in('status', ['ready', 'claimed', 'reported'])
    if (actErr) return { ok: false, error: `주문 조회 실패: ${actErr.message}` }
    const rows = (active ?? []) as Array<{ id: string; status: string }>
    const cancelIds = rows.filter(o => o.status === 'ready' || o.status === 'claimed').map(o => o.id)
    if (cancelIds.length > 0) {
      const { error: cancelErr } = await admin
        .from('agent_work_orders')
        .update({ status: 'cancelled', claimed_by: null, claimed_by_user_id: null, claimed_at: null, updated_at: new Date().toISOString() })
        .in('id', cancelIds).in('status', ['ready', 'claimed'])
      if (cancelErr) return { ok: false, error: `주문 취소 실패: ${cancelErr.message}` }
    }
    if (rows.some(o => o.status === 'reported')) {
      warnings.push('완료 보고가 이미 올라온 주문은 취소되지 않았습니다 — 진행 상황에서 승인·반려로 정리하세요.')
    }
  }
  return warnings.length > 0 ? { ok: true, warning: warnings.join(' ') } : { ok: true }
}
