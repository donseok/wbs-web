// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const queueUiPref = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  usePathname: () => '/p/p1/wbs',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }))
vi.mock('@/app/actions/announcements', () => ({ getUnreadAnnouncementCount: vi.fn(async () => 0) }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref }))

import { Sidebar } from '@/components/app/Sidebar'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'

describe('Sidebar 회의록 메뉴', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    localStorage.clear()
    queueUiPref.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('회의록 메뉴를 클릭하면 사이드바를 접고 설정을 저장한다', async () => {
    await act(async () => root.render(
      <ProjectNavigationProvider projects={[]}>
        <Sidebar projects={[]} />
      </ProjectNavigationProvider>,
    ))

    const minutesLink = container.querySelector<HTMLAnchorElement>('a[href="/minutes"]')
    expect(minutesLink).not.toBeNull()

    act(() => minutesLink!.click())

    expect(localStorage.getItem('dflow-sidebar')).toBe('1')
    expect(queueUiPref).toHaveBeenCalledWith({ sidebarCollapsed: true })
    expect(container.querySelector('aside')?.className ?? '').toContain('w-[78px]')
  })
})
