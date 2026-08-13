// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  pathname: '/p/p1/dashboard',
  getNotifications: vi.fn(async () => ({ items: [] })),
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({
    push: mocks.routerPush,
    replace: mocks.routerReplace,
    refresh: mocks.routerRefresh,
  }),
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
      'common.selectProject': '프로젝트 선택',
      'common.noProjects': '프로젝트 없음',
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
vi.mock('@/lib/prefs/debouncedSave', () => ({
  queueUiPref: vi.fn(),
}))

import { HeaderChrome } from '@/components/app/HeaderChrome'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'

const projects = [
  { id: 'p1', name: 'D-CUBE 프로젝트', status: 'active' as const },
  { id: 'p2', name: 'ERP 혁신 프로젝트', status: 'ready' as const },
]

describe('HeaderChrome 브레드크럼', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.pathname = '/p/p1/dashboard'
    mocks.getNotifications.mockClear()
    mocks.routerPush.mockClear()
    mocks.routerReplace.mockClear()
    mocks.routerRefresh.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function renderAt(
    pathname: string,
    visibleProjects = projects,
    initialLastProjectId: string | null = 'p1',
  ) {
    mocks.pathname = pathname
    await act(async () => root.render(
      <ProjectNavigationProvider
        projects={visibleProjects}
        initialLastProjectId={initialLastProjectId}
        initialLastProjectHref={initialLastProjectId ? `/p/${initialLastProjectId}/dashboard` : null}
      >
        <HeaderChrome identity={null} projects={visibleProjects} />
      </ProjectNavigationProvider>,
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

  it('모바일 회의록 메뉴에서도 최근 프로젝트 하위 메뉴와 복귀 링크를 유지한다', async () => {
    await renderAt('/minutes')

    const openButton = container.querySelector<HTMLButtonElement>('button[aria-label="메뉴 열기"]')
    expect(openButton).not.toBeNull()
    await act(async () => openButton!.click())

    const menu = container.querySelector<HTMLElement>('[role="dialog"][aria-label="모바일 메뉴"]')
    expect(menu).not.toBeNull()
    expect(menu!.textContent).toContain('D-CUBE 프로젝트')
    expect(menu!.textContent).toContain('프로젝트로 돌아가기')

    const projectSelect = menu!.querySelector<HTMLSelectElement>('select[aria-label="프로젝트 선택"]')
    expect(projectSelect?.value).toBe('')

    const minutesLink = menu!.querySelector<HTMLAnchorElement>('a[href="/minutes"]')
    expect(minutesLink?.getAttribute('aria-current')).toBe('page')
    const wbsLink = menu!.querySelector<HTMLAnchorElement>('a[href="/p/p1/wbs"]')
    expect(wbsLink).not.toBeNull()
    expect(wbsLink?.getAttribute('aria-current')).toBeNull()

    await act(async () => {
      if (!projectSelect) return
      projectSelect.value = 'p1'
      projectSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(mocks.routerPush).toHaveBeenCalledWith('/p/p1/dashboard')
    expect(container.querySelector('[role="dialog"][aria-label="모바일 메뉴"]')).toBeNull()
  })

  it('모바일 프로젝트 선택 시 대상 대시보드로 이동하고 메뉴를 닫는다', async () => {
    await renderAt('/p/p1/issues')

    const openButton = container.querySelector<HTMLButtonElement>('button[aria-label="메뉴 열기"]')
    await act(async () => openButton?.click())

    const projectSelect = container.querySelector<HTMLSelectElement>(
      '[role="dialog"][aria-label="모바일 메뉴"] select[aria-label="프로젝트 선택"]',
    )
    expect(projectSelect?.value).toBe('p1')

    await act(async () => {
      if (!projectSelect) return
      projectSelect.value = 'p2'
      projectSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(mocks.routerPush).toHaveBeenCalledTimes(1)
    expect(mocks.routerPush).toHaveBeenCalledWith('/p/p2/dashboard')
    expect(container.querySelector('[role="dialog"][aria-label="모바일 메뉴"]')).toBeNull()
  })

  it('Wiki 상세 경로에서도 프로젝트 지식 브레드크럼과 모바일 활성 링크를 유지한다', async () => {
    const breadcrumb = await renderAt('/p/p1/wiki/topics/topic-1')
    expect(breadcrumb?.textContent).toContain('프로젝트 지식')

    const openButton = container.querySelector<HTMLButtonElement>('button[aria-label="메뉴 열기"]')
    await act(async () => openButton?.click())

    const wikiLink = container.querySelector<HTMLAnchorElement>(
      '[role="dialog"][aria-label="모바일 메뉴"] a[href="/p/p1/wiki"]',
    )
    expect(wikiLink).not.toBeNull()
    expect(wikiLink?.getAttribute('aria-current')).toBe('page')
  })

  it('프로젝트가 많아도 모바일 메뉴에는 프로젝트 선택 상자 하나만 둔다', async () => {
    const manyProjects = Array.from({ length: 100 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `프로젝트 ${index + 1}`,
      status: 'active' as const,
    }))
    await renderAt('/projects', manyProjects, null)

    const openButton = container.querySelector<HTMLButtonElement>('button[aria-label="메뉴 열기"]')
    await act(async () => openButton?.click())

    const menu = container.querySelector<HTMLElement>('[role="dialog"][aria-label="모바일 메뉴"]')
    const projectSelects = menu?.querySelectorAll<HTMLSelectElement>('select[aria-label="프로젝트 선택"]')
    expect(projectSelects).toHaveLength(1)
    expect(projectSelects?.[0].value).toBe('')
    expect([...projectSelects![0].options].filter(option => option.value)).toHaveLength(100)
    expect(menu?.querySelectorAll('a[href^="/p/"][href$="/dashboard"]')).toHaveLength(0)
  })

  it('프로젝트가 없으면 모바일 프로젝트 선택을 비활성화한다', async () => {
    await renderAt('/projects', [], null)

    const openButton = container.querySelector<HTMLButtonElement>('button[aria-label="메뉴 열기"]')
    await act(async () => openButton?.click())

    const projectSelect = container.querySelector<HTMLSelectElement>(
      '[role="dialog"][aria-label="모바일 메뉴"] select[aria-label="프로젝트 선택"]',
    )
    expect(projectSelect?.disabled).toBe(true)
    expect(projectSelect?.options).toHaveLength(1)
    expect(projectSelect?.options[0].textContent).toBe('프로젝트 없음')
    expect(mocks.routerPush).not.toHaveBeenCalled()
  })
})
