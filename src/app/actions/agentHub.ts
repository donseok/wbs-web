'use server'
// 에이전트 허브 액션 — 재조회와 일괄 위임. 판정은 authz 가드로만, 본체는 src/lib/agent/delegation.ts.
// 스펙: docs/superpowers/specs/2026-09-14-agent-hub-design.md §5
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin, requireProjectMember } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAgentHub } from '@/lib/data/agentHub'
import { applyDelegation } from '@/lib/agent/delegation'
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

/** 일괄 위임/해제 — 관리자. 항목은 전부 이 프로젝트 소속이어야 하고, 개별 실패는 모아 계속 간다. */
export async function setAgentDelegationBulk(projectId: string, itemIds: string[], delegated: boolean): Promise<
  { ok: true; applied: number; failed: { itemId: string; error: string }[]; warning?: string } | { ok: false; error: string }
> {
  if (!isUuidLike(projectId) || !Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > BULK_MAX
    || !itemIds.every(isUuidLike) || typeof delegated !== 'boolean') {
    return { ok: false, error: ERR_BAD }
  }
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const unique = [...new Set(itemIds)]
  const { data, error } = await admin.from('wbs_items').select('id').eq('project_id', projectId).in('id', unique)
  if (error) return { ok: false, error: `항목 조회 실패: ${error.message}` }
  if (((data ?? []) as { id: string }[]).length !== unique.length) return { ok: false, error: '이 프로젝트의 항목이 아닌 것이 있습니다.' }
  let applied = 0
  const failed: { itemId: string; error: string }[] = []
  const warnings = new Set<string>()
  for (const itemId of unique) {
    const r = await applyDelegation(admin, { itemId, projectId, delegated, actorUserId: g.actor.userId, isAdmin: true })
    if (r.ok) { applied++; if (r.warning) warnings.add(r.warning) }
    else failed.push({ itemId, error: r.error ?? '실패' })
  }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true, applied, failed, ...(warnings.size ? { warning: [...warnings].join(' ') } : {}) }
}
