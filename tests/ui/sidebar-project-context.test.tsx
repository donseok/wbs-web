// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  pathname: '/minutes',
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))
vi.mock('@/app/actions/announcements', () => ({
  getUnreadAnnouncementCount: vi.fn(async () => 0),
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({
  queueUiPref: vi.fn(),
}))

import { Sidebar, type SidebarProject } from '@/components/app/Sidebar'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'

const projects: SidebarProject[] = [{
  id: 'p1',
  name: 'ERP 프로젝트',
  status: 'active',
}]

describe('Sidebar 최근 프로젝트 문맥', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.pathname = '/minutes'
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
    await act(async () => {
      root.render(
        <ProjectNavigationProvider
          projects={projects}
          initialLastProjectId="p1"
          initialLastProjectHref="/p/p1/wbs"
        >
          <Sidebar projects={projects} />
        </ProjectNavigationProvider>,
      )
    })
  }

  it('회의록에서는 전역 메뉴를 활성화하면서 최근 프로젝트 하위 메뉴와 복귀 링크를 유지한다', async () => {
    await renderAt('/minutes')

    const minutesLink = container.querySelector<HTMLAnchorElement>('a[href="/minutes"]')
    expect(minutesLink?.className).toContain('side-link-active')
    expect(minutesLink?.getAttribute('aria-current')).toBe('page')

    const wbsLinks = container.querySelectorAll<HTMLAnchorElement>('a[href="/p/p1/wbs"]')
    expect(wbsLinks).toHaveLength(2)
    expect([...wbsLinks].some(link => link.textContent?.includes('돌아가기'))).toBe(true)

    const wbsMenuLink = [...wbsLinks].find(link => link.textContent?.includes('nav.wbsGantt'))
    expect(wbsMenuLink?.className).not.toContain('side-link-active')
    expect(wbsMenuLink?.getAttribute('aria-current')).toBeNull()
    expect(container.textContent).toContain('ERP 프로젝트 메뉴')
  })

  it('프로젝트 목록 화면에서는 저장된 하위 메뉴를 억지로 노출하지 않는다', async () => {
    await renderAt('/projects')

    expect(container.querySelector('a[href="/p/p1/wbs"]')).toBeNull()
    expect(container.textContent).not.toContain('ERP 프로젝트 메뉴')
  })
})
