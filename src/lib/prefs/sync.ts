import type { UiPrefs } from '@/lib/domain/types'

/** 로컬 캐시가 항상 채워 갖는 확정 형태(서버 UiPrefs 는 부분적일 수 있음). */
export type LocalPrefs = {
  heroCollapsed: boolean
  sidebarCollapsed: boolean
  theme: 'light' | 'dark'
  locale: 'ko' | 'en'
}

const KEYS: (keyof LocalPrefs)[] = ['heroCollapsed', 'sidebarCollapsed', 'theme', 'locale']

/**
 * 서버 값과 로컬 현재값을 비교해 UI에 적용할 것(apply)과 서버에 백필할 것(backfill)을 계산한다.
 * - 서버에 값 없음 → 로컬값 백필
 * - 서버에 값 있고 로컬과 다름 → UI에 적용
 * - 같음 → 둘 다 스킵
 */
export function computePrefsSync(
  server: UiPrefs,
  local: LocalPrefs,
): { apply: Partial<LocalPrefs>; backfill: Partial<UiPrefs> } {
  const apply: Partial<LocalPrefs> = {}
  const backfill: Partial<UiPrefs> = {}
  for (const k of KEYS) {
    const sv = server[k]
    if (sv === undefined || sv === null) {
      ;(backfill as Record<string, unknown>)[k] = local[k]
    } else if (sv !== local[k]) {
      ;(apply as Record<string, unknown>)[k] = sv
    }
  }
  return { apply, backfill }
}
