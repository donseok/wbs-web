'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { DICT, type DictKey, type Locale } from '@/lib/i18n/dict'

const LocaleCtx = createContext<{ locale: Locale; setLocale: (l: Locale) => void; t: (k: DictKey) => string }>({
  locale: 'ko',
  setLocale: () => {},
  t: (k) => k,
})

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ko')

  useEffect(() => {
    try {
      const stored = localStorage.getItem('dflow-locale') as Locale | null
      if (stored === 'ko' || stored === 'en') setLocaleState(stored)
    } catch {}
  }, [])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem('dflow-locale', next)
    } catch {}
  }, [])

  const t = useCallback((key: DictKey) => DICT[locale][key] ?? DICT.ko[key] ?? key, [locale])

  return <LocaleCtx.Provider value={{ locale, setLocale, t }}>{children}</LocaleCtx.Provider>
}

export const useLocale = () => useContext(LocaleCtx)
