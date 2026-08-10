'use server'

// 프로젝트 팀 관리(프로젝트 관리자) — 전역 팀(/admin/teams, 슈퍼유저)과 별개 스코프(0071).
// 회의록 시드 폴더는 만들지 않는다: 회의록·또박또박은 전역 팀 축이다(스펙 §5).
// 삭제 없음: 비활성화=삭제(전역 팀과 동일 관례).

import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeNewTeamCode } from '@/lib/domain/teams'
import { refreshTeams, teamsSync } from '@/lib/teams/master'

export type ProjectTeamActionResult = { ok: true } | { ok: false; error: string }

export async function addProjectTeam(projectId: string, input: string): Promise<ProjectTeamActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const norm = normalizeNewTeamCode(input)
  if (!norm.ok) return norm
  const admin = createAdminClient()

  // 중복은 동일 프로젝트 내에서만 거부 — 전역·타 프로젝트 동명은 허용(복합 유니크와 일치).
  const dup = await admin.from('teams').select('id').eq('project_id', projectId).eq('code', norm.code).maybeSingle()
  if (dup.error) return { ok: false, error: `팀 조회 실패: ${dup.error.message}` }
  if (dup.data) return { ok: false, error: `'${norm.code}' 팀이 이미 이 프로젝트에 있습니다.` }

  const max = await admin.from('teams')
    .select('sort_order').eq('project_id', projectId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()
  if (max.error) return { ok: false, error: `팀 조회 실패: ${max.error.message}` }
  const sortOrder = Number((max.data as { sort_order?: number } | null)?.sort_order ?? -1) + 1

  const ins = await admin.from('teams')
    .insert({ code: norm.code, name: norm.code, sort_order: sortOrder, project_id: projectId })
  if (ins.error) return { ok: false, error: `팀 생성 실패: ${ins.error.message}` }

  await refreshTeams()
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

export async function updateProjectTeam(
  projectId: string, teamId: string,
  patch: { active?: boolean; progressVisible?: boolean; sortOrder?: number },
): Promise<ProjectTeamActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const row: Record<string, unknown> = {}
  if (typeof patch.active === 'boolean') row.active = patch.active
  if (typeof patch.progressVisible === 'boolean') row.progress_visible = patch.progressVisible
  if (typeof patch.sortOrder === 'number' && Number.isInteger(patch.sortOrder)) row.sort_order = patch.sortOrder
  if (Object.keys(row).length === 0) return { ok: false, error: '변경할 항목이 없습니다.' }
  const admin = createAdminClient()
  // .eq('project_id') 를 함께 건다 — 관리자 가드가 통과한 프로젝트의 행만 만진다(전역 행 오수정 차단).
  // .select('id') 로 영향 행을 확인한다 — 0행이면 조용한 no-op 을 성공으로 위장하지 않는다
  // (teams.ts updateTeam 과 대칭되는 방어, revokeProjectInvite 원조 관례).
  const upd = await admin.from('teams').update(row).eq('id', teamId).eq('project_id', projectId).select('id')
  if (upd.error) return { ok: false, error: `팀 수정 실패: ${upd.error.message}` }
  if (!upd.data || upd.data.length === 0) return { ok: false, error: '이 프로젝트의 팀이 아니거나 존재하지 않습니다.' }
  await refreshTeams()
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

/** 전역 활성 팀을 프로젝트 팀으로 복사해 시작 — 프로젝트 팀 0개일 때만(1회성 시작 도구). */
export async function copyGlobalTeams(projectId: string): Promise<ProjectTeamActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const existing = await admin.from('teams').select('id').eq('project_id', projectId).limit(1).maybeSingle()
  if (existing.error) return { ok: false, error: `팀 조회 실패: ${existing.error.message}` }
  if (existing.data) return { ok: false, error: '이미 프로젝트 팀이 정의되어 있습니다.' }
  const globals = teamsSync().filter(t => t.active)
  const ins = await admin.from('teams').insert(globals.map(t => ({
    code: t.code, name: t.code, sort_order: t.sortOrder,
    progress_visible: t.progressVisible, project_id: projectId,
  })))
  if (ins.error) return { ok: false, error: `복사 실패: ${ins.error.message}` }
  await refreshTeams()
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}
