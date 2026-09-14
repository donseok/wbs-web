'use server'
// 에이전트 허브 액션 — 재조회와 위임 묶음 저장. 판정은 authz 가드로만, 본체는 src/lib/agent/delegation.ts.
// 스펙: docs/superpowers/specs/2026-09-14-agent-hub-design.md §5
import { requireProjectMember } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAgentHub } from '@/lib/data/agentHub'
import { viewerEmail } from '@/lib/data/agentSeatmap'
import { myMemberIds } from '@/lib/agent/assignee'
import { applyDelegation, ERR_NOT_ASSIGNEE } from '@/lib/agent/delegation'
import type { AgentHub } from '@/lib/domain/agentHub'

const ERR_BAD = '잘못된 요청입니다.'
const BULK_MAX = 200

export async function refreshAgentHub(projectId: string): Promise<{ ok: true; hub: AgentHub } | { ok: false; error: string }> {
  if (!isUuidLike(projectId)) return { ok: false, error: ERR_BAD }
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  try {
    return { ok: true, hub: await getAgentHub(projectId, { userId: g.actor.userId, isAdmin: isProjectAdmin(g.actor, projectId) }) }
  } catch (e) {
    // 상세는 로그에, 화면에는 고정 문구 — 조회 실패를 빈 화면으로 위장하지 않되 내부 오류 문자열을 흘리지 않는다.
    console.error('[agentHub] 재조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: '에이전트 현황 재조회에 실패했습니다.' }
  }
}

export type HubDelegationChange = { itemId: string; delegated: boolean }
export type HubDelegationsResult =
  | {
      ok: true
      /** 저장 뒤 다시 읽은 허브. 재조회만 실패하면 null + hubError — 변경은 이미 저장된 상태다. */
      hub: AgentHub | null
      hubError?: string
      failed: { itemId: string; error: string }[]
      warnings: { itemId: string; warning: string }[]
    }
  | { ok: false; error: string }

/**
 * 위임 변경 묶음 저장(2026-09-14 체크 지연 개선). 허브 표의 체크는 클라이언트가 1.5초 모았다가 여기로 한 번에 보낸다.
 *
 * 종전엔 체크 하나 = 액션 2건 직렬(쓰기 + 재조회)에 각각 가드가 붙고, 쓰기 응답에는 revalidatePath 가 만든
 * 페이지 재렌더(18KB·서버 0.5초)까지 실렸는데 허브는 useState(initial) 이라 그 재렌더를 쓰지도 않았다
 * (스테이징 실측 0.8~1.0초 잠김). 이 액션은 가드 1회 → 항목별 applyDelegation → 허브 재조회를 한 응답에 담고
 * revalidatePath 를 부르지 않는다. 허브·WBS 페이지는 둘 다 동적 렌더라 다음 방문 때 새로 읽는다.
 *
 * 자격은 항목마다 setAgentDelegation 과 같다(허브 스펙 §3): 관리자, 또는 그 항목의 담당자 본인(멤버).
 * 멤버의 로스터 판정은 묶음당 1회만 하고, 자격 없는 항목은 그 항목만 failed 로 돌려보낸다.
 * 같은 항목이 여러 번 오면 마지막 값만 적용한다. 다른 프로젝트 항목이 섞이면 묶음 전체를 거부한다.
 */
export async function applyHubDelegations(projectId: string, changes: HubDelegationChange[]): Promise<HubDelegationsResult> {
  if (!isUuidLike(projectId) || !Array.isArray(changes) || changes.length === 0 || changes.length > BULK_MAX
    || !changes.every(c => c != null && typeof c === 'object' && isUuidLike(c.itemId) && typeof c.delegated === 'boolean')) {
    return { ok: false, error: ERR_BAD }
  }
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const isAdmin = isProjectAdmin(g.actor, projectId)
  const wanted = new Map<string, boolean>()
  for (const c of changes) wanted.set(c.itemId, c.delegated)
  const ids = [...wanted.keys()]

  const admin = createAdminClient()
  const { data, error } = await admin.from('wbs_items').select('id, assignee_member_id').eq('project_id', projectId).in('id', ids)
  if (error) return { ok: false, error: `항목 조회 실패: ${error.message}` }
  const items = new Map(((data ?? []) as { id: string; assignee_member_id: string | null }[]).map(i => [i.id, i]))
  if (items.size !== ids.length) return { ok: false, error: '이 프로젝트의 항목이 아닌 것이 있습니다.' }

  // 멤버(비관리자)는 담당자 본인 항목만 — 로스터 판정은 묶음당 1회. 조회 실패는 거부(fail-closed).
  let mine: Set<string> | null = null
  if (!isAdmin) {
    try {
      const email = await viewerEmail(admin, g.actor.userId)
      mine = new Set(await myMemberIds(admin, { userId: g.actor.userId, userEmail: email ?? '', projectId }))
    } catch (e) {
      console.error('[agentHub] 담당자 판정 실패:', e instanceof Error ? e.message : e)
      return { ok: false, error: '담당자 판정에 실패했습니다.' }
    }
  }

  const failed: { itemId: string; error: string }[] = []
  const warnings: { itemId: string; warning: string }[] = []
  for (const itemId of ids) {
    const assignee = items.get(itemId)?.assignee_member_id ?? null
    if (mine && !(assignee && mine.has(assignee))) { failed.push({ itemId, error: ERR_NOT_ASSIGNEE }); continue }
    const r = await applyDelegation(admin, {
      itemId, projectId, delegated: wanted.get(itemId) as boolean, actorUserId: g.actor.userId, isAdmin,
    })
    if (!r.ok) failed.push({ itemId, error: r.error ?? '실패' })
    else if (r.warning) warnings.push({ itemId, warning: r.warning })
  }

  try {
    const hub = await getAgentHub(projectId, { userId: g.actor.userId, isAdmin })
    return { ok: true, hub, failed, warnings }
  } catch (e) {
    // 저장은 끝났다. 재조회만 실패했음을 분명히 알려 클라이언트가 대기분을 되돌리지 않게 한다(표시 = 로깅).
    console.error('[agentHub] 저장 뒤 재조회 실패:', e instanceof Error ? e.message : e)
    return { ok: true, hub: null, hubError: '변경은 저장됐지만 현황 재조회에 실패했습니다. 새로고침을 누르세요.', failed, warnings }
  }
}
