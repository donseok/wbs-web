// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))

import { ProgressPopover } from '@/components/kanban/ProgressPopover'

describe('ProgressPopover', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('프리셋 버튼을 누르면 해당 %로 onSubmit 된다', async () => {
    const onSubmit = vi.fn()
    await act(async () => root.render(
      <ProgressPopover open title="t" initial={30} onSubmit={onSubmit} onClose={() => {}} />,
    ))
    const btn = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === '50%')!
    await act(async () => btn.click())
    expect(onSubmit).toHaveBeenCalledWith(50)
  })
})
