'use server'
import { createServerClient } from '@/lib/supabase/server'
import type { UiPrefs } from '@/lib/domain/types'

/** 현재 사용자의 전역 UI 설정(없으면 빈 객체). 미로그인 시 {}. */
export async function getUiPrefs(): Promise<UiPrefs> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return {}
  const { data, error } = await sb
    .from('user_preferences').select('prefs').eq('user_id', u.user.id).maybeSingle()
  if (error) console.error('[getUiPrefs] 조회 실패:', error.message)
  return (data?.prefs as UiPrefs) ?? {}
}

/** 전역 설정 부분 병합 upsert. 미로그인 시 no-op. */
export async function saveUiPrefs(patch: Partial<UiPrefs>): Promise<void> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return
  const { data: existing, error: readErr } = await sb
    .from('user_preferences').select('prefs').eq('user_id', u.user.id).maybeSingle()
  // 병합 선행 조회 — 실패를 '설정 없음'으로 오인하면 patch 가 전체를 덮어써
  // 테마·언어·사이드바 등 이번에 안 건드린 설정이 소실된다. 읽기 실패 시 저장을 중단한다.
  if (readErr) {
    console.error('[saveUiPrefs] 기존 설정 조회 실패 — 덮어쓰기 방지 위해 저장 중단:', readErr.message)
    return
  }
  const merged = { ...((existing?.prefs as UiPrefs) ?? {}), ...patch }
  const { error } = await sb.from('user_preferences').upsert(
    { user_id: u.user.id, prefs: merged, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  if (error) console.error('[saveUiPrefs] 저장 실패:', error.message)
}

/** 프로젝트의 WBS 접힘 id 배열(행 없으면 null). 미로그인 시 null. */
export async function getWbsCollapse(projectId: string): Promise<string[] | null> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return null
  const { data, error } = await sb
    .from('user_wbs_state').select('collapsed')
    .eq('user_id', u.user.id).eq('project_id', projectId).maybeSingle()
  // 표시용 조회 — 실패 시 접힘 상태만 기본값으로 복귀(데이터 손상 없음)이라 로깅 후 폴백 유지.
  if (error) console.error('[getWbsCollapse] 조회 실패:', error.message)
  return (data?.collapsed as string[]) ?? null
}

/** 프로젝트의 WBS 접힘 상태 upsert. 미로그인 시 no-op. */
export async function saveWbsCollapse(projectId: string, ids: string[]): Promise<void> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return
  const { error } = await sb.from('user_wbs_state').upsert(
    { user_id: u.user.id, project_id: projectId, collapsed: ids, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,project_id' },
  )
  if (error) console.error('[saveWbsCollapse] 저장 실패:', error.message)
}
