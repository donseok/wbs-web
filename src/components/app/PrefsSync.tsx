'use client'
import { useEffect, useRef } from 'react'
import { getUiPrefs } from '@/app/actions/preferences'
import { computePrefsSync, type LocalPrefs } from '@/lib/prefs/sync'
import { queueUiPref } from '@/lib/prefs/debouncedSave'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import { dispatchHeroToggle, readHeroCollapsed } from '@/components/ui/PageHero'
import { dispatchSidebarToggle, SIDEBAR_STORAGE_KEY } from '@/components/app/Sidebar'

/**
 * 현재 로컬 상태를 LocalPrefs 로 읽는다. 테마는 DOM 클래스(no-flash 스크립트가 이미 설정),
 * 언어는 쿠키에서 직접 읽는다 — context 값은 렌더 시점 초기값이라 effect 시점에 stale 하다.
 */
function readLocal(): LocalPrefs {
  let sidebarCollapsed = false
  try { sidebarCollapsed = localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1' } catch {}
  const theme: 'light' | 'dark' = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  const cookieLocale = document.cookie.match(/(?:^|; )dflow-locale=([^;]+)/)?.[1]
  const locale: 'ko' | 'en' = cookieLocale === 'en' ? 'en' : 'ko'
  return { heroCollapsed: readHeroCollapsed(), sidebarCollapsed, theme, locale }
}

/**
 * 로그인 시 서버 설정을 읽어 로컬 캐시/UI 를 reconcile 한다(로컬 우선 + 서버 동기화).
 * 서버 값이 있으면 UI에 적용, 없으면 로컬값을 서버에 백필. 렌더 출력 없음.
 */
export function PrefsSync() {
  const { setTheme } = useTheme()
  const { setLocale } = useLocale()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    let alive = true
    void getUiPrefs().then(server => {
      if (!alive) return
      const local = readLocal()
      const { apply, backfill } = computePrefsSync(server, local)
      // 적용: 각 설정의 기존 변경 경로 재사용(같은 값이면 computePrefsSync 가 이미 걸러냄).
      if (apply.theme !== undefined) setTheme(apply.theme)
      if (apply.locale !== undefined) setLocale(apply.locale)
      if (apply.heroCollapsed !== undefined) dispatchHeroToggle(apply.heroCollapsed)
      if (apply.sidebarCollapsed !== undefined) dispatchSidebarToggle(apply.sidebarCollapsed)
      // 백필: 서버에 없던 키를 현재 로컬값으로 1회 저장(debounce 병합).
      if (Object.keys(backfill).length) queueUiPref(backfill)
    }).catch(() => {})
    return () => { alive = false }
    // 마운트 1회만. setTheme/setLocale 은 안정적 콜백이고 로컬 상태는 readLocal 이 DOM/쿠키에서 직접 읽음.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
