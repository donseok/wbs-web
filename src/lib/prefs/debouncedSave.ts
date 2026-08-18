'use client'
import type { UiPrefs } from '@/lib/domain/types'

// 서버 액션이 아니라 /api/prefs POST 를 쓴다 — 액션은 성공할 때마다 클라이언트 라우터
// 캐시를 통째로 비워, 내비게이션마다 도는 이 저장이 staleTimes(30s) 재방문 캐시를
// 무효화했다(2026-08-18 실측). keepalive 라 페이지 이탈 직전 저장도 유실되지 않는다.
// 실패는 무시(로컬 캐시가 진실) — 종전 액션 경로와 같은 계약.
function postPrefs(body: { prefs?: Partial<UiPrefs>; wbsCollapse?: { projectId: string; ids: string[] } }): void {
  void fetch('/api/prefs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {})
}

let pendingPrefs: Partial<UiPrefs> = {}
let prefsTimer: ReturnType<typeof setTimeout> | null = null

/** 전역 설정 변경을 병합해 debounce 저장. 실패는 무시(로컬 캐시가 진실). */
export function queueUiPref(patch: Partial<UiPrefs>, delay = 600): void {
  pendingPrefs = { ...pendingPrefs, ...patch }
  if (prefsTimer) clearTimeout(prefsTimer)
  prefsTimer = setTimeout(() => {
    const p = pendingPrefs
    pendingPrefs = {}
    prefsTimer = null
    postPrefs({ prefs: p })
  }, delay)
}

const wbsPending = new Map<string, string[]>()
const wbsTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 프로젝트별 WBS 접힘 상태를 debounce 저장(최신값만). 실패는 무시. */
export function queueWbsCollapse(projectId: string, ids: string[], delay = 600): void {
  wbsPending.set(projectId, ids)
  const existing = wbsTimers.get(projectId)
  if (existing) clearTimeout(existing)
  wbsTimers.set(projectId, setTimeout(() => {
    const v = wbsPending.get(projectId) ?? []
    wbsPending.delete(projectId)
    wbsTimers.delete(projectId)
    postPrefs({ wbsCollapse: { projectId, ids: v } })
  }, delay))
}
