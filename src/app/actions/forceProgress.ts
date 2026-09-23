'use server'
// 강제 진행 액션 — 가드만 하고 본체(src/lib/agent/forceProgress.ts)를 부른다. 권한: 관리자 또는 후행의 서브트리 관리자(스펙 §3.2).
import { revalidatePath } from 'next/cache'
import { resolveProjectId } from '@/lib/authz'
import { requireSubtreeManagerOrAdmin } from '@/lib/agent/subtreeManager'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import { ERR_NOT_STUB, applyWaiver, cancelStub } from '@/lib/agent/forceProgress'

export async function setDependencyWaiver(itemId: string, predRef: string, waive: boolean, reason: string) {
  if (!isUuidLike(itemId) || typeof predRef !== 'string' || predRef.trim() === '') return { ok: false as const, error: '잘못된 요청입니다.' }
  if (typeof reason !== 'string' || reason.trim() === '') return { ok: false as const, error: '사유를 입력하세요.' }
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false as const, error: found.error }
  if (!found.projectId) return { ok: false as const, error: '프로젝트 확인 실패' }
  const g = await requireSubtreeManagerOrAdmin(itemId, found.projectId)
  if (!g.ok) return { ok: false as const, error: g.error }
  const r = await applyWaiver(createAdminClient(), {
    projectId: found.projectId, itemId, predRef: predRef.trim(), waive, reason: reason.trim(), actorUserId: g.actor.userId,
  })
  if (r.ok) revalidatePath(`/p/${found.projectId}`, 'layout')
  return r
}

export async function cancelStubTask(subTaskId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isUuidLike(subTaskId)) return { ok: false, error: '잘못된 요청입니다.' }
  const admin = createAdminClient()
  const { data: row, error } = await admin.from('wbs_items').select('id, parent_id, stub_for').eq('id', subTaskId).maybeSingle()
  if (error) return { ok: false, error: `항목 조회 실패: ${error.message}` }
  const sub = row as { id: string; parent_id: string | null; stub_for: string | null } | null
  if (!sub) return { ok: false, error: '항목 없음' }
  if (!sub.stub_for || !sub.parent_id) return { ok: false, error: ERR_NOT_STUB }
  const found = await resolveProjectId('wbs_items', sub.parent_id)
  if (!found.ok) return { ok: false, error: found.error }
  if (!found.projectId) return { ok: false, error: '프로젝트 확인 실패' }
  // 권한은 후행 기준 — 면제와 같은 사람이 치운다.
  const g = await requireSubtreeManagerOrAdmin(sub.parent_id, found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const r = await cancelStub(admin, subTaskId)
  if (r.ok) revalidatePath(`/p/${found.projectId}`, 'layout')
  return r
}
