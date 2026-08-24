// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SidebarProject } from '@/components/app/Sidebar'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ pathname: '/projects', push: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => ({ 'nav.agentOps': '에이전트 관제' } as Record<string, string>)[key] ?? key }),
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: () => {} }))

import { Sidebar } from '@/components/app/Sidebar'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'

const projects: SidebarProject[] = [{ id: 'p1', name: 'ERP', status: 'active' }]

/** 에이전트 관제(/agent-ops)는 슈퍼유저 전용 전역 화면 — 종전에는 진입 링크가 없어 URL 직접 접근뿐이었다. */
describe('Sidebar 에이전트 관제 링크', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    // localStorage.clear() 는 쓰지 않는다 — Node 24 의 실험 localStorage 가 jsdom 것을 가려 undefined 다(기존 사이드바 테스트 실패 원인).
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ inbox: { items: [], unseen: 0 }, notifications: { items: [], count: 0 }, unreadAnnouncements: 0, headerAnnouncements: [] }),
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

  async function render(pathname: string, showAgentOps: boolean) {
    mocks.pathname = pathname
    await act(async () => {
      root.render(
        <ProjectNavigationProvider projects={projects} initialLastProjectId={null}>
          <ShellStateProvider>
            <Sidebar projects={projects} showAgentOps={showAgentOps} />
          </ShellStateProvider>
        </ProjectNavigationProvider>,
      )
    })
    await act(async () => {})
  }

  it('슈퍼유저(showAgentOps) — 전역 화면·프로젝트 화면 양쪽에 /agent-ops 링크가 있다', async () => {
    await render('/projects', true)
    expect(container.querySelector('a[href="/agent-ops"]')?.textContent).toContain('에이전트 관제')

    await render('/p/p1/dashboard', true)
    expect(container.querySelector('a[href="/agent-ops"]')?.textContent).toContain('에이전트 관제')
  })

  it('/agent-ops 에 있으면 링크가 활성 표시된다', async () => {
    await render('/agent-ops', true)
    const link = container.querySelector('a[href="/agent-ops"]')
    expect(link?.getAttribute('aria-current')).toBe('page')
  })

  it('비슈퍼유저 — 링크 자체가 없다(기본값 false)', async () => {
    await render('/projects', false)
    expect(container.querySelector('a[href="/agent-ops"]')).toBeNull()
    await render('/p/p1/dashboard', false)
    expect(container.querySelector('a[href="/agent-ops"]')).toBeNull()
  })
})
