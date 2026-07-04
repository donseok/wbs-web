// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const queueUiPref = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: (...a: unknown[]) => queueUiPref(...(a as [])) }))

import { ThemeProvider, useTheme } from '@/components/providers/ThemeProvider'

function Probe() {
  const { setTheme } = useTheme()
  return <button onClick={() => setTheme('dark')}>go</button>
}

describe('ThemeProvider 서버 쓰기', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); queueUiPref.mockClear() })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('테마 변경 시 queueUiPref({theme}) 를 호출한다', async () => {
    await act(async () => root.render(<ThemeProvider><Probe /></ThemeProvider>))
    await act(async () => { container.querySelector('button')!.click() })
    expect(queueUiPref).toHaveBeenCalledWith({ theme: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
