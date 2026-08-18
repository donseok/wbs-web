'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { t as translate, ensureEnLoaded, isEnLoaded, type DictKey, type Locale } from '@/lib/i18n/dict'
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
  // EN 사전은 지연 청크 — 로드 완료 시 t 의 identity 를 바꿔 컨텍스트 소비자를 재렌더한다.
  const [enReady, setEnReady] = useState(isEnLoaded)
  const migrated = useRef(false)

  useEffect(() => {
    if (locale !== 'en' || enReady) return
    let alive = true
    void ensureEnLoaded().then(() => { if (alive) setEnReady(true) }).catch(() => {})
    return () => { alive = false }
  }, [locale, enReady])

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

  // enReady 는 조회에 직접 쓰이지 않지만 의존성에 둔다 — EN 로드 완료 순간 t 가 새 함수가
  // 되어야 en 화면이 ko 폴백에서 실제 번역으로 갈아탄다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useCallback((key: DictKey) => translate(locale, key), [locale, enReady])

  return <LocaleCtx.Provider value={{ locale, setLocale, t }}>{children}</LocaleCtx.Provider>
}

export const useLocale = () => useContext(LocaleCtx)
