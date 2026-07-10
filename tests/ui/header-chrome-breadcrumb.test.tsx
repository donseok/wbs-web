// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  pathname: '/p/p1/dashboard',
  getNotifications: vi.fn(async () => ({ items: [] })),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/providers/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggle: vi.fn() }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'ko',
    setLocale: vi.fn(),
    t: (key: string) => ({
      'nav.minutes': '회의록',
      'nav.myMeetings': '내 회의',
      'nav.workspace': '워크스페이스',
      'brand.tagline': '일하는 방식이 바뀐다',
    } as Record<string, string>)[key] ?? key,
  }),
}))
vi.mock('@/app/actions/notifications', () => ({
  getNotifications: mocks.getNotifications,
}))
vi.mock('@/app/actions/announcements', () => ({
  getUnreadAnnouncementCount: vi.fn(async () => 0),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { signOut: vi.fn() } }),
}))
vi.mock('@/components/app/HeaderAnnouncementTicker', () => ({
  HeaderAnnouncementTicker: () => null,
}))
vi.mock('@/components/account/ChangePasswordModal', () => ({
  ChangePasswordModal: () => null,
}))

import { HeaderChrome } from '@/components/app/HeaderChrome'

const projects = [{ id: 'p1', name: 'D-CUBE 프로젝트', status: 'active' as const }]

describe('HeaderChrome 브레드크럼', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.pathname = '/p/p1/dashboard'
    mocks.getNotifications.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function renderAt(pathname: string) {
    mocks.pathname = pathname
    await act(async () => root.render(
      <HeaderChrome membership={null} projects={projects} />,
    ))
    return container.querySelector<HTMLElement>('nav[aria-label="현재 위치"]')
  }

  it.each([
    ['/minutes', '회의록'],
    ['/minutes/11111111-2222-4333-8444-555555555555', '회의록'],
    ['/meetings', '내 회의'],
  ])('%s에서 프로젝트 경로와 동일한 크롬으로 %s 항목을 표시한다', async (pathname, label) => {
    const projectBreadcrumb = await renderAt('/p/p1/dashboard')
    expect(projectBreadcrumb).not.toBeNull()
    expect(projectBreadcrumb!.textContent).toContain('D-CUBE 프로젝트')
    expect(projectBreadcrumb!.textContent).toContain('대시보드')

    const globalBreadcrumb = await renderAt(pathname)
    expect(globalBreadcrumb).not.toBeNull()
    expect(globalBreadcrumb!.className).toBe(projectBreadcrumb!.className)
    expect(globalBreadcrumb!.querySelectorAll('svg')).toHaveLength(2)
    expect(globalBreadcrumb!.textContent).toContain('워크스페이스')
    expect(globalBreadcrumb!.textContent).toContain(label)
  })
})
