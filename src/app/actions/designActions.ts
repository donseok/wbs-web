'use server'
// 설계 방식·설계 버튼 서버 액션(설계 상태 스펙 7절). 자격은 모두 위임 권한(requireDelegationRight, D10).
// 판정 재료·화면 판정은 src/lib/agent/designPanel.ts, 전이는 전이 RPC(apply_workflow_event, 0108) 하나다.
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectMember, resolveProjectId } from '@/lib/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { DESIGN_MODES, designButtons, toDesignMode, type DesignButton, type DesignMode } from '@/lib/domain/designGate'
import { applyDelegation, requireDelegationRight, ERR_NOT_ASSIGNEE, type AgentDelegationResult } from '@/lib/agent/delegation'
import { SKIPPED_WARN, applyWorkflowEvent } from '@/lib/agent/workflowEvent'
import { designPanelOf, loadDesignTarget, type DesignPanel, type DesignTarget } from '@/lib/agent/designPanel'

const ERR_BAD = '잘못된 요청입니다.'
const ERR_MISSING = '대상을 찾을 수 없습니다.'
const ERR_LOAD = '설계 상태를 읽지 못했습니다.'
const ERR_STALE = '지금은 누를 수 없습니다 — 화면을 새로 고친 뒤 다시 보세요.'
const ERR_CHANGED = '그 사이 상태가 바뀌었습니다 — 화면을 새로 고친 뒤 다시 보세요.'
const DEFAULT_REOPEN_NOTE = '사람이 설계를 되돌렸습니다.'
/** design_note 상한(0108 CHECK 500자). */
const NOTE_MAX = 500

export type DesignPanelResult = { ok: true; panel: DesignPanel; canAct: boolean } | { ok: false; error: string }
export type DesignOpResult = { ok: boolean; error?: string; warning?: string }

const isDesignMode = (v: unknown): v is DesignMode => typeof v === 'string' && (DESIGN_MODES as readonly string[]).includes(v)

/** WBS 작업 패널의 설계 영역 — 멤버면 누구나 본다. 버튼은 위임 권한(관리자·담당자 본인)이 있을 때만(canAct). */
export async function getDesignPanel(itemId: string): Promise<DesignPanelResult> {
  if (!isUuidLike(itemId)) return { ok: false, error: ERR_BAD }
  const resolved = await resolveProjectId('wbs_items', itemId)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  if (resolved.projectId === null) return { ok: false, error: ERR_MISSING }
  const g = await requireProjectMember(resolved.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  try {
    // 판정 재료와 버튼 자격은 서로 기대지 않는다 — 함께 읽어 패널을 열 때의 왕복을 줄인다.
    const [target, right] = await Promise.all([loadDesignTarget(createAdminClient(), itemId), requireDelegationRight(itemId)])
    if (!target) return { ok: false, error: ERR_MISSING }
    // 담당자 본인이 아니라 거부되는 것은 정상 소음이라 남기지 않는다 — 그 밖의 실패(조회 오류 등)만 로그로 남긴다.
    // canAct 은 그대로 boolean 이다 — 화면은 버튼을 숨길 뿐, 실패 사유를 canAct 하나로 뭉개지 않으려는 것뿐이다.
    if (!right.ok && right.error !== ERR_NOT_ASSIGNEE) {
      console.error('[designActions] 위임 권한 판정 실패(canAct=false 로 열화):', right.error)
    }
    return { ok: true, panel: designPanelOf(target, Date.now()), canAct: right.ok }
  } catch (e) {
    console.error('[designActions] 설계 영역 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_LOAD }
  }
}

/**
 * 위임 표식과 설계 방식을 한 번에 쓴다(스펙 7절). 켤 때는 방식을 먼저 쓰고 위임을 나중에 써서, 표식이 켜진 순간 팀장이 옛 방식으로
 * 가져가는 틈을 없앤다. 끌 때는 위임을 먼저 풀어(주문 취소로 방식 잠금이 풀린다) 방식을 쓴다. 방식이 그대로면 방식 사건을 부르지 않는다 —
 * 승인 이력이 있는 항목의 재위임이 방식 잠금(approved 주문)에 막히지 않게.
 */
export async function setDelegationAndMode(
  itemId: string, delegated: boolean, mode: DesignMode,
): Promise<AgentDelegationResult & { modeChanged?: boolean }> {
  if (!isUuidLike(itemId) || typeof delegated !== 'boolean' || !isDesignMode(mode)) return { ok: false, error: ERR_BAD }
  const right = await requireDelegationRight(itemId)
  if (!right.ok) return { ok: false, error: right.error }
  const admin = createAdminClient()
  // 쓰기 전 선행 조회 — 실패하면 아무것도 쓰지 않는다(에러 3원칙 ②).
  const { data: cur, error: curErr } = await admin.from('wbs_items').select('design_mode').eq('id', itemId).maybeSingle()
  if (curErr) return { ok: false, error: `항목 조회 실패: ${curErr.message}` }
  if (!cur) return { ok: false, error: ERR_MISSING }
  const needMode = toDesignMode((cur as { design_mode: string | null }).design_mode) !== mode
  const setMode = () => applyWorkflowEvent(admin, { event: 'set_design_mode', actorUserId: right.actor.userId, itemId, mode })
  let modeChanged = false
  if (delegated && needMode) {
    const m = await setMode()
    // 방식 잠금(design_mode_locked) 등으로 거부되면 위임은 건드리지 않는다.
    if (!m.ok) return { ok: false, error: m.error }
    modeChanged = m.designModeChanged
  }
  const r = await applyDelegation(admin, { itemId, projectId: right.projectId, delegated, actorUserId: right.actor.userId, isAdmin: right.isAdmin })
  // 방식은 이미 바뀌었을 수 있다 — 실패여도 modeChanged 를 실어 화면이 바뀐 방식을 알게 한다.
  if (!r.ok) return { ...r, modeChanged }
  let warning = r.warning
  if (!delegated && needMode) {
    const m = await setMode()
    if (m.ok) modeChanged = m.designModeChanged
    else {
      // 위임 해제는 이미 끝났다 — 실패로 뒤집지 않고 경고로 드러낸다(표시 = 로깅).
      console.error('[designActions] 위임 해제 뒤 설계 방식 쓰기 실패:', itemId, m.error)
      warning = [warning, `위임은 풀었지만 설계 방식을 바꾸지 못했습니다 — ${m.error}`].filter(Boolean).join(' ')
    }
  }
  revalidatePath(`/p/${right.projectId}`, 'layout')
  if (r.actualChanged) after(() => recordProgressSnapshot(right.projectId))
  return { ...r, ...(warning ? { warning } : {}), modeChanged }
}

/** 세 버튼의 공용 본체 — 위임 권한 → 판정 재료 → 서버 판정으로 버튼 재확인 → CAS 전이. */
async function runDesignOp(
  itemId: string, button: DesignButton, event: 'design_accept' | 'design_reopen', note: string | null,
): Promise<DesignOpResult> {
  if (!isUuidLike(itemId)) return { ok: false, error: ERR_BAD }
  const right = await requireDelegationRight(itemId)
  if (!right.ok) return { ok: false, error: right.error }
  const admin = createAdminClient()
  let target: DesignTarget | null
  try { target = await loadDesignTarget(admin, itemId) } catch (e) {
    console.error('[designActions] 설계 상태 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_LOAD }
  }
  if (!target) return { ok: false, error: ERR_MISSING }
  // 버튼은 서버 판정으로 다시 본다 — 화면이 낡았으면 누른 버튼이 지금은 없다.
  const active = target.active
  if (active === null || !designButtons(target.item, active).includes(button)) return { ok: false, error: ERR_STALE }
  // CAS(P1) — 판정에 쓴 설계 상태·방식이 쓰기 순간에도 같아야 한다. 그 사이 바뀌었으면 RPC 가 conflict 로 거부한다.
  const tr = await applyWorkflowEvent(admin, {
    event, actorUserId: right.actor.userId, orderId: active.id, note,
    cas: { design_state: active.designState, design_mode: target.item.mode },
  })
  if (!tr.ok) {
    if (tr.conflict) return { ok: false, error: ERR_CHANGED }
    console.error('[designActions] 설계 전이 실패:', event, itemId, tr.error)
    return { ok: false, error: tr.error }
  }
  revalidatePath(`/p/${right.projectId}`, 'layout')
  if (tr.actualChanged) after(() => recordProgressSnapshot(right.projectId))
  if (!tr.skipped) return { ok: true }
  // 부모 항목은 이 주문 하나만 처리해선 안 끝난다 — 사람이 위임을 해제해야 주문이 취소되며 끝난다(SKIPPED_WARN 자체는
  // 승인 흐름(agentWork.ts)도 같이 쓰므로 바꾸지 않고, 이 세 버튼(설계 동작)에서만 안내를 덧붙인다).
  const warning = tr.skipped === 'parent'
    ? `${SKIPPED_WARN.parent} 이 주문을 끝내려면 위임을 해제하세요 — 주문이 취소됩니다.`
    : SKIPPED_WARN[tr.skipped]
  return { ok: true, warning }
}

/** 「설계 승인」 — 설계 검토 대기(claimed·review·dd) 작업의 설계를 승인한다. 팀장이 다음 TICK 에 구현을 이어 간다. */
export async function designAccept(itemId: string): Promise<DesignOpResult> {
  return runDesignOp(itemId, 'accept', 'design_accept', null)
}

/** 「설계 확정」 — 구현자동 작업의 사람 설계를 확정한다(ready 주문, 단계 dd). RPC 는 주문 status 로 승인과 가른다. */
export async function designConfirm(itemId: string): Promise<DesignOpResult> {
  return runDesignOp(itemId, 'confirm', 'design_accept', null)
}

/** 「설계 되돌리기」 — 승인·확정된 설계를 구현 전에 되돌린다(review·auto 는 설계 검토 대기, human 은 사람 설계 대기). 빈 사유면 기본 사유. */
export async function designReopen(itemId: string, reason: string): Promise<DesignOpResult> {
  const note = typeof reason === 'string' ? reason.trim().slice(0, NOTE_MAX) : ''
  return runDesignOp(itemId, 'reopen', 'design_reopen', note || DEFAULT_REOPEN_NOTE)
}
