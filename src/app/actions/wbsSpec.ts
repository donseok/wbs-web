'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { isUuidLike } from '@/lib/domain/agentWork'

/**
 * WBS 명세(spec 마크다운·참조 필드) 조회·편집 — 결정 B: 실물 문서는 로컬 git, DB 에는
 * 참조 문자열(prd_ref·entry_point)과 조립된 마크다운 본문(spec)만 둔다. import(0076
 * import_wbs_upsert)가 구조·명세 필드의 정본이고, 이 액션들은 웹에서의 보정 편집 경로다.
 * 편집 권한은 배정(§2.5)과 동일 — 프로젝트 관리자. wbsAssign.ts(Task 12)의
 * loadItem·requireProjectAdmin 패턴을 그대로 따른다(파일 스코프상 import 하지 않고 이 파일에 둔다).
 */

const SPEC_MAX = 1_048_576 // 1MB — spec 은 본문이지 저장소가 아니다(실물 문서는 로컬 git, 결정 A)
const PRIORITY_LABELS = new Set(['critical', 'high', 'medium', 'low'])

export type WbsPriority = 'critical' | 'high' | 'medium' | 'low'

export interface WbsSpecDetail {
  category: string | null
  domain: string | null
  priority: WbsPriority | null
  model: string | null
  tags: string[]
  depends: string[]
  prdRef: string | null
  entryPoint: string | null
  /** 정본은 import(0076) — 이 화면에서는 읽기 전용 체크리스트로만 표시. */
  acceptance: string[]
  spec: string | null
  externalRef: string | null
}

async function loadItemProject(itemId: string): Promise<
  | { ok: true; projectId: string }
  | { ok: false; error: string }
> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('wbs_items').select('id, project_id').eq('id', itemId).maybeSingle()
  if (error) return { ok: false, error: `항목 조회 실패: ${error.message}` }
  if (!data) return { ok: false, error: '항목 없음' }
  return { ok: true, projectId: (data as { project_id: string }).project_id }
}

/**
 * 선택된 항목의 명세 조회 — RowDetailPanel 선택 변경 시 클라이언트에서 별도 로드
 * (getWbsAssigneeStage 관례와 동일. ComputedItem 을 확장하지 않는다).
 *
 * 실패는 null — 3원칙 ①: "조회 안 됨"을 "명세 없음"으로 위장하면 관리자가 실제 값을
 * 못 본 채 편집 폼을 열어 조용히 덮어쓸 수 있다. 패널은 null 을 "표시 불가"로 렌더한다.
 */
export async function getWbsSpec(itemId: string): Promise<WbsSpecDetail | null> {
  if (!isUuidLike(itemId)) return null
  const resolved = await resolveProjectId('wbs_items', itemId)
  if (!resolved.ok) {
    console.error('[getWbsSpec] 프로젝트 조회 실패:', resolved.error)
    return null
  }
  const g = await requireProjectMember(resolved.projectId)
  if (!g.ok) {
    console.error('[getWbsSpec] 권한 없음:', g.error)
    return null
  }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('wbs_items')
    .select('category, domain, priority, model, tags, depends, prd_ref, entry_point, acceptance, spec, external_ref')
    .eq('id', itemId).maybeSingle()
  if (error) {
    console.error('[getWbsSpec] 조회 실패:', error.message)
    return null
  }
  if (!data) return null
  const row = data as {
    category: string | null
    domain: string | null
    priority: string | null
    model: string | null
    tags: string[] | null
    depends: string[] | null
    prd_ref: string | null
    entry_point: string | null
    acceptance: unknown
    spec: string | null
    external_ref: string | null
  }
  return {
    category: row.category ?? null,
    domain: row.domain ?? null,
    priority: (row.priority as WbsPriority | null) ?? null,
    model: row.model ?? null,
    tags: row.tags ?? [],
    depends: row.depends ?? [],
    prdRef: row.prd_ref ?? null,
    entryPoint: row.entry_point ?? null,
    acceptance: Array.isArray(row.acceptance) ? row.acceptance.filter((v): v is string => typeof v === 'string') : [],
    spec: row.spec ?? null,
    externalRef: row.external_ref ?? null,
  }
}

export async function updateWbsSpec(itemId: string, spec: string): Promise<{ ok: boolean; error?: string }> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  if (spec.length > SPEC_MAX) return { ok: false, error: '명세가 너무 큽니다(1MB 상한).' }
  const loaded = await loadItemProject(itemId)
  if (!loaded.ok) return loaded
  const g = await requireProjectAdmin(loaded.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('wbs_items').update({ spec, updated_at: new Date().toISOString() })
    .eq('id', itemId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  const { error: logErr } = await admin.from('change_logs').insert({
    user_id: g.actor.userId, wbs_item_id: itemId, field: 'spec',
    old_value: null, new_value: '(명세 갱신)', // 본문 전문을 로그에 넣지 않는다 — 크기·노이즈
  })
  if (logErr) console.error('[wbsSpec] 명세 변경 이력 기록 실패:', logErr.message)
  revalidatePath(`/p/${loaded.projectId}`, 'layout')
  return { ok: true }
}

export async function updateWbsSpecFields(
  itemId: string,
  fields: { prd_ref?: string | null; entry_point?: string | null; priority?: WbsPriority | null },
): Promise<{ ok: boolean; error?: string }> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  if (fields.priority !== undefined && fields.priority !== null && !PRIORITY_LABELS.has(fields.priority)) {
    return { ok: false, error: '허용되지 않는 우선순위입니다.' }
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('prd_ref' in fields) patch.prd_ref = fields.prd_ref
  if ('entry_point' in fields) patch.entry_point = fields.entry_point
  if ('priority' in fields) patch.priority = fields.priority
  if (Object.keys(patch).length === 1) return { ok: false, error: '갱신할 필드가 없습니다.' }
  const loaded = await loadItemProject(itemId)
  if (!loaded.ok) return loaded
  const g = await requireProjectAdmin(loaded.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('wbs_items').update(patch).eq('id', itemId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  revalidatePath(`/p/${loaded.projectId}`, 'layout')
  return { ok: true }
}
