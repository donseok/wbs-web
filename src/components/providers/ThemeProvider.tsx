'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void; setTheme: (t: Theme) => void }>({
  theme: 'light',
  toggle: () => {},
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')

  // no-flash 스크립트가 이미 <html> 클래스를 설정 → 마운트 시 동기화
  useEffect(() => {
    setThemeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  const apply = useCallback((next: Theme) => {
    setThemeState(next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    try {
      localStorage.setItem('dflow-theme', next)
      document.cookie = `dflow-theme=${next};path=/;max-age=31536000;samesite=lax`
    } catch {}
  }, [])

  const toggle = useCallback(() => apply(theme === 'dark' ? 'light' : 'dark'), [theme, apply])

  return <ThemeCtx.Provider value={{ theme, toggle, setTheme: apply }}>{children}</ThemeCtx.Provider>
}

export const useTheme = () => useContext(ThemeCtx)
