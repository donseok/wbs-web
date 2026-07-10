// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))

import { ArchiveChatPanel } from '@/components/minutes/ArchiveChatPanel'

describe('ArchiveChatPanel 레이어/닫기', () => {
  let container: HTMLDivElement, root: Root
  const onClose = vi.fn()

  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    onClose.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

  function render(open = true) {
    act(() => root.render(
      <ArchiveChatPanel open={open} onClose={onClose} team={null} from={null} to={null} />,
    ))
  }

  it('앱 헤더(z-70)·DK Bot 패널(z-130)보다 위 레이어에 뜬다', () => {
    render()
    const dialog = container.querySelector('[role="dialog"]')!
    const z = Number(/z-\[(\d+)\]/.exec(dialog.className)?.[1] ?? 0)
    expect(z).toBeGreaterThan(130)
  })

  it('백드롭 클릭으로 닫힌다', () => {
    render()
    const backdrop = container.querySelector<HTMLElement>('[data-backdrop]')!
    act(() => backdrop.click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape 키로 닫힌다', () => {
    render()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('닫힌 상태에서는 Escape 리스너가 없다', () => {
    render(false)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})
