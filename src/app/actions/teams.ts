'use server'

// 팀 기준정보 관리(pmo_admin 전용) — 추가/활성 토글/정렬/진척표시.
// 삭제는 없다: 비활성화(active=false)가 삭제다(데이터 보존, 사용자 결정 2026-07-24).
// 쓰기 후 refreshTeams()로 인메모리 캐시를 즉시 갱신한다(LLM 설정 액션과 동일 관례).

import { revalidatePath } from 'next/cache'
import { getMembership } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeNewTeamCode } from '@/lib/domain/teams'
import { refreshTeams } from '@/lib/teams/master'

export type TeamActionResult = { ok: true } | { ok: false; error: string }

async function isAdmin(): Promise<boolean> {
  const m = await getMembership()
  return m?.role === 'pmo_admin'
}

/** 팀 추가 — teams insert + 자동 편철용 시드 루트 폴더(created_by null) 생성 + 캐시 즉시 갱신. */
export async function addTeam(input: string): Promise<TeamActionResult> {
  if (!(await isAdmin())) return { ok: false, error: 'PMO 관리자만 팀을 관리할 수 있습니다.' }
  const norm = normalizeNewTeamCode(input)
  if (!norm.ok) return norm
  const admin = createAdminClient()

  const dup = await admin.from('teams').select('id').eq('code', norm.code).maybeSingle()
  if (dup.error) return { ok: false, error: `팀 조회 실패: ${dup.error.message}` }
  if (dup.data) return { ok: false, error: `'${norm.code}' 팀이 이미 존재합니다.` }

  const max = await admin.from('teams')
    .select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
  if (max.error) return { ok: false, error: `팀 조회 실패: ${max.error.message}` }
  const sortOrder = Number((max.data as { sort_order?: number } | null)?.sort_order ?? -1) + 1

  const ins = await admin.from('teams').insert({ code: norm.code, name: norm.code, sort_order: sortOrder })
  if (ins.error) return { ok: false, error: `팀 생성 실패: ${ins.error.message}` }

  // 자동 편철 앵커(0043 계약): 팀코드 동명 시드 루트 폴더. 실패해도 팀은 유지하되 관리자에게
  // 표시한다(편철은 미분류 폴백이라 치명적이진 않지만 조용히 넘기지 않는다 — 에러 3원칙).
  const seed = await admin.from('minute_folders')
    .select('id').is('parent_id', null).is('created_by', null).eq('name', norm.code).maybeSingle()
  let seedError: string | null = seed.error ? seed.error.message : null
  if (!seed.error && !seed.data) {
    const folder = await admin.from('minute_folders')
      .insert({ name: norm.code, parent_id: null, created_by: null, sort: 100 + sortOrder })
    if (folder.error) seedError = folder.error.message
  }

  await refreshTeams()
  revalidatePath('/admin/teams')
  if (seedError) {
    console.error('[teams] 시드 폴더 생성 실패:', seedError)
    return { ok: false, error: `팀은 생성됐지만 회의록 기본 폴더 생성에 실패했습니다: ${seedError}` }
  }
  return { ok: true }
}

/** 활성/진척현황 표시/정렬 변경. */
export async function updateTeam(
  id: string,
  patch: { active?: boolean; progressVisible?: boolean; sortOrder?: number },
): Promise<TeamActionResult> {
  if (!(await isAdmin())) return { ok: false, error: 'PMO 관리자만 팀을 관리할 수 있습니다.' }
  const row: Record<string, unknown> = {}
  if (typeof patch.active === 'boolean') row.active = patch.active
  if (typeof patch.progressVisible === 'boolean') row.progress_visible = patch.progressVisible
  if (typeof patch.sortOrder === 'number' && Number.isInteger(patch.sortOrder)) row.sort_order = patch.sortOrder
  if (Object.keys(row).length === 0) return { ok: false, error: '변경할 항목이 없습니다.' }
  const admin = createAdminClient()
  const upd = await admin.from('teams').update(row).eq('id', id)
  if (upd.error) return { ok: false, error: `팀 수정 실패: ${upd.error.message}` }
  await refreshTeams()
  revalidatePath('/admin/teams')
  return { ok: true }
}

/** 관리 화면 목록(비활성 포함) — 페이지 서버 컴포넌트 전용. */
export async function listTeamsAdmin(): Promise<
  Array<{ id: string; code: string; sortOrder: number; active: boolean; progressVisible: boolean }>
> {
  if (!(await isAdmin())) return []
  const admin = createAdminClient()
  const { data, error } = await admin.from('teams')
    .select('id, code, sort_order, active, progress_visible')
    .order('sort_order').order('code')
  if (error) {
    console.error('[teams] 관리 목록 조회 실패:', error.message)
    return []
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    code: String(r.code),
    sortOrder: Number(r.sort_order ?? 0),
    active: r.active !== false,
    progressVisible: r.progress_visible !== false,
  }))
}
