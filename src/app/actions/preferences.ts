'use server'
import { createServerClient } from '@/lib/supabase/server'
import type { UiPrefs } from '@/lib/domain/types'

/** 현재 사용자의 전역 UI 설정(없으면 빈 객체). 미로그인 시 {}. */
export async function getUiPrefs(): Promise<UiPrefs> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return {}
  const { data } = await sb
    .from('user_preferences').select('prefs').eq('user_id', u.user.id).maybeSingle()
  return (data?.prefs as UiPrefs) ?? {}
}

/** 전역 설정 부분 병합 upsert. 미로그인 시 no-op. */
export async function saveUiPrefs(patch: Partial<UiPrefs>): Promise<void> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return
  const { data: existing } = await sb
    .from('user_preferences').select('prefs').eq('user_id', u.user.id).maybeSingle()
  const merged = { ...((existing?.prefs as UiPrefs) ?? {}), ...patch }
  await sb.from('user_preferences').upsert(
    { user_id: u.user.id, prefs: merged, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
}

/** 프로젝트의 WBS 접힘 id 배열(행 없으면 null). 미로그인 시 null. */
export async function getWbsCollapse(projectId: string): Promise<string[] | null> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return null
  const { data } = await sb
    .from('user_wbs_state').select('collapsed')
    .eq('user_id', u.user.id).eq('project_id', projectId).maybeSingle()
  return (data?.collapsed as string[]) ?? null
}

/** 프로젝트의 WBS 접힘 상태 upsert. 미로그인 시 no-op. */
export async function saveWbsCollapse(projectId: string, ids: string[]): Promise<void> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return
  await sb.from('user_wbs_state').upsert(
    { user_id: u.user.id, project_id: projectId, collapsed: ids, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,project_id' },
  )
}
