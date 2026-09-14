// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  pathname: '/minutes',
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({
  queueUiPref: vi.fn(),
}))
// 실시간 구독은 향상 계층 — 테스트 대상 아님(supabase 클라이언트 생성을 피한다).
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: () => {} }))

import { Sidebar, type SidebarProject } from '@/components/app/Sidebar'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'

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
    mocks.push.mockReset()
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

  async function renderAt(pathname: string) {
    mocks.pathname = pathname
    await act(async () => {
      root.render(
        <ProjectNavigationProvider
          projects={projects}
          initialLastProjectId="p1"
        >
          <ShellStateProvider>
            <Sidebar projects={projects} />
          </ShellStateProvider>
        </ProjectNavigationProvider>,
      )
    })
    await act(async () => {}) // /api/shell 응답 flush
  }

  it('프로젝트 메뉴에 에이전트 페이지 링크가 있다 — 근태 다음, 설정 앞', async () => {
    await renderAt('/p/p1/wbs')
    const hrefs = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/p/p1/"]')].map(a => a.getAttribute('href'))
    expect(hrefs).toContain('/p/p1/agents')
    expect(hrefs.indexOf('/p/p1/agents')).toBe(hrefs.indexOf('/p/p1/attendance') + 1)
    expect(container.querySelector('a[href="/p/p1/agents"]')?.textContent).toContain('nav.projectAgents')
  })

  it('전역 오피스(/agents)는 사이드바에 없다 — 입구는 프로젝트 오피스 탭의 전체 오피스 링크 한 곳(2026-09-14)', async () => {
    await renderAt('/p/p1/wbs')
    expect(container.querySelector('a[href="/agents"]')).toBeNull()
  })

  it('가상 오피스(/p/p1/agents/office)에서도 사이드바 활성 항목은 에이전트 하나다', async () => {
    await renderAt('/p/p1/agents/office')
    const link = container.querySelector<HTMLAnchorElement>('a[href="/p/p1/agents"]')
    expect(link?.className).toContain('side-link-active')
    expect(link?.getAttribute('aria-current')).toBe('page')
    expect(container.querySelector('a[href="/agents"]')).toBeNull()
  })

  it('회의록에서는 전역 메뉴를 활성화하면서 최근 프로젝트 하위 메뉴를 유지한다', async () => {
    await renderAt('/minutes')

    const minutesLink = container.querySelector<HTMLAnchorElement>('a[href="/minutes"]')
    expect(minutesLink?.className).toContain('side-link-active')
    expect(minutesLink?.getAttribute('aria-current')).toBe('page')

    // 돌아가기 링크는 제거됐다(2026-08-20) — 하위 메뉴 링크 하나만 남는다.
    const wbsLinks = container.querySelectorAll<HTMLAnchorElement>('a[href="/p/p1/wbs"]')
    expect(wbsLinks).toHaveLength(1)
    expect(container.textContent).not.toContain('돌아가기')

    const wbsMenuLink = wbsLinks[0]
    expect(wbsMenuLink?.textContent).toContain('nav.wbsGantt')
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
