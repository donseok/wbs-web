'use client'
import { saveUiPrefs, saveWbsCollapse } from '@/app/actions/preferences'
import type { UiPrefs } from '@/lib/domain/types'

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
    void saveUiPrefs(p).catch(() => {})
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
    void saveWbsCollapse(projectId, v).catch(() => {})
  }, delay))
}
