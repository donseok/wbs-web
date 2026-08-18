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
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref }))
// 실시간 구독은 향상 계층 — 테스트 대상 아님(supabase 클라이언트 생성을 피한다).
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: () => {} }))

import { Sidebar } from '@/components/app/Sidebar'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'

describe('Sidebar 회의록 메뉴', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    localStorage.clear()
    queueUiPref.mockClear()
    // 공지 배지 등 셸 상태는 ShellStateProvider 가 /api/shell GET 1회로 채운다 — 고정 payload 스텁.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        inbox: { items: [], unseen: 0 },
        notifications: { items: [], count: 0 },
        unreadAnnouncements: 0,
        headerAnnouncements: [],
      }),
    })))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('회의록 메뉴를 클릭하면 사이드바를 접고 설정을 저장한다', async () => {
    await act(async () => root.render(
      <ProjectNavigationProvider projects={[]}>
        <ShellStateProvider>
          <Sidebar projects={[]} />
        </ShellStateProvider>
      </ProjectNavigationProvider>,
    ))
    await act(async () => {}) // /api/shell 응답 flush

    const minutesLink = container.querySelector<HTMLAnchorElement>('a[href="/minutes"]')
    expect(minutesLink).not.toBeNull()

    act(() => minutesLink!.click())

    expect(localStorage.getItem('dflow-sidebar')).toBe('1')
    expect(queueUiPref).toHaveBeenCalledWith({ sidebarCollapsed: true })
    expect(container.querySelector('aside')?.className ?? '').toContain('w-[78px]')
  })
})
