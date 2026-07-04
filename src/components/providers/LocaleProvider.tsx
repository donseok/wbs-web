'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DICT, type DictKey, type Locale } from '@/lib/i18n/dict'
import { queueUiPref } from '@/lib/prefs/debouncedSave'

const COOKIE = 'dflow-locale'

const LocaleCtx = createContext<{ locale: Locale; setLocale: (l: Locale) => void; t: (k: DictKey) => string }>({
  locale: 'ko',
  setLocale: () => {},
  t: (k) => k,
})

function writeCookie(next: Locale) {
  document.cookie = `${COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
}

export function LocaleProvider({
  children,
  initialLocale = 'ko',
}: {
  children: React.ReactNode
  initialLocale?: Locale
}) {
  const router = useRouter()
  // 서버가 쿠키에서 읽은 locale로 초기화 → 첫 페인트부터 클라이언트/서버 일치(hydration mismatch 없음).
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const migrated = useRef(false)

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next)
      try {
        writeCookie(next)
        localStorage.setItem(COOKIE, next)
      } catch {}
      queueUiPref({ locale: next })
      // 서버 컴포넌트로 렌더되는 페이지 본문도 새 locale로 재렌더.
      router.refresh()
    },
    [router],
  )

  // 쿠키 도입 이전(localStorage만 쓰던) 사용자 1회 마이그레이션.
  useEffect(() => {
    if (migrated.current) return
    migrated.current = true
    try {
      const hasCookie = new RegExp(`(?:^|; )${COOKIE}=`).test(document.cookie)
      if (hasCookie) return
      const stored = localStorage.getItem(COOKIE) as Locale | null
      if (stored !== 'ko' && stored !== 'en') return
      if (stored === initialLocale) writeCookie(stored)
      else setLocale(stored)
    } catch {}
  }, [initialLocale, setLocale])

  const t = useCallback((key: DictKey) => DICT[locale][key] ?? DICT.ko[key] ?? key, [locale])

  return <LocaleCtx.Provider value={{ locale, setLocale, t }}>{children}</LocaleCtx.Provider>
}

export const useLocale = () => useContext(LocaleCtx)
