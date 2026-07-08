// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const queueUiPref = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: (...a: unknown[]) => queueUiPref(...(a as [])) }))

import { DetailAccordion } from '@/components/dashboard/DetailAccordion'

const groups = [
  { id: 'teamDeliv', title: '팀 · 산출물', content: <div>팀 본문</div> },
  { id: 'weekly', title: '주간 리듬', content: <div>주간 본문</div> },
]
const STALE = ['analysis', 'scheduleRisk', 'teamDeliv']

describe('DetailAccordion — 낡은 dashSections id', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container); queueUiPref.mockClear()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const mount = () => act(() => {
    root.render(<StrictMode><DetailAccordion groups={groups} initialExpanded={STALE} /></StrictMode>)
  })

  it('낡은 id는 아무 그룹도 열지 않고, teamDeliv만 열린다', () => {
    mount()
    expect(container.textContent).toContain('팀 본문')
    expect(container.textContent).not.toContain('주간 본문')
  })

  it('토글 시 낡은 id를 다시 저장하지 않는다', () => {
    mount()
    const weeklyBtn = [...container.querySelectorAll('button')]
      .find(b => b.textContent?.includes('주간 리듬'))!
    act(() => { weeklyBtn.click() })
    expect(queueUiPref).toHaveBeenCalledWith({ dashSections: ['teamDeliv', 'weekly'] })
  })
})
