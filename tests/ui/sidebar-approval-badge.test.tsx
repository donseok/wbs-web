// @vitest-environment jsdom
// 사이드바 「에이전트」 메뉴의 결재 대기 배지(2026-09-18) — 셸 payload 의 pendingApprovals 를 그린다.
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

function stubShell(pendingApprovals: number | undefined) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      inbox: { items: [], unseen: 0 },
      notifications: { items: [], count: 0 },
      unreadAnnouncements: 2,
      headerAnnouncements: [],
      ...(pendingApprovals === undefined ? {} : { pendingApprovals }),
    }),
  })))
}

describe('Sidebar 에이전트 결재 대기 배지', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.pathname = '/p/p1/dashboard'
    localStorage.removeItem('dflow-sidebar')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    localStorage.removeItem('dflow-sidebar')
  })

  async function render() {
    await act(async () => {
      root.render(
        <ProjectNavigationProvider projects={projects} initialLastProjectId="p1">
          <ShellStateProvider>
            <Sidebar projects={projects} />
          </ShellStateProvider>
        </ProjectNavigationProvider>,
      )
    })
    await act(async () => {})
  }
  const agentLink = () => container.querySelector('a[href="/p/p1/agents/office"]') as HTMLAnchorElement

  it('승인할 것이 있으면 에이전트 메뉴에 수를 단다 — 공지 배지와 따로', async () => {
    stubShell(3)
    await render()
    const badge = agentLink().querySelector('[data-nav-badge="nav.projectAgents"]')
    expect(badge?.textContent).toBe('3')
    expect(badge?.getAttribute('title')).toBe('결재 대기 3건')
    expect(container.querySelector('a[href="/p/p1/announcements"] [data-nav-badge="nav.announcements"]')?.textContent).toBe('2')
  })
  it('없으면(0 · 옛 응답) 배지를 달지 않는다', async () => {
    stubShell(0)
    await render()
    expect(agentLink().querySelector('[data-nav-badge]')).toBeNull()
    act(() => root.unmount()); root = createRoot(container)
    stubShell(undefined)
    await render()
    expect(agentLink().querySelector('[data-nav-badge]')).toBeNull()
  })
  it('100 이상은 99+', async () => {
    stubShell(120)
    await render()
    expect(agentLink().querySelector('[data-nav-badge]')?.textContent).toBe('99+')
  })
  it('접힌 사이드바는 점으로 줄인다', async () => {
    localStorage.setItem('dflow-sidebar', '1')
    stubShell(3)
    await render()
    expect(agentLink().querySelector('[data-nav-dot="nav.projectAgents"]')).not.toBeNull()
    expect(agentLink().querySelector('[data-nav-badge]')).toBeNull()
  })
})

function stubShellWith(extra: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      inbox: { items: [], unseen: 0 },
      notifications: { items: [], count: 0 },
      unreadAnnouncements: 0,
      headerAnnouncements: [],
      ...extra,
    }),
  })))
}

describe('Sidebar 결재 대기 배지 — 확인 필요 결정(과제 C)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.pathname = '/p/p1/dashboard'
    localStorage.removeItem('dflow-sidebar')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render() {
    await act(async () => {
      root.render(
        <ProjectNavigationProvider projects={projects} initialLastProjectId="p1">
          <ShellStateProvider>
            <Sidebar projects={projects} />
          </ShellStateProvider>
        </ProjectNavigationProvider>,
      )
    })
    await act(async () => {})
  }
  const badge = () => container.querySelector('a[href="/p/p1/agents/office"] [data-nav-badge="nav.projectAgents"]')

  it('결정이 딸리면 수는 그대로, title 에 결정 수, 배지에 점', async () => {
    stubShellWith({ pendingApprovals: 3, pendingDecisions: 2, pendingDecisionsPartial: false })
    await render()
    expect(badge()?.textContent).toBe('3')
    expect(badge()?.getAttribute('title')).toBe('결재 대기 3건 · 확인 필요 결정 2건')
    expect(badge()?.querySelector('[data-nav-decision-dot]')).not.toBeNull()
  })
  it('구 CLI 보고가 섞이면 "이상 · 일부 구버전 보고"', async () => {
    stubShellWith({ pendingApprovals: 3, pendingDecisions: 2, pendingDecisionsPartial: true })
    await render()
    expect(badge()?.getAttribute('title')).toBe('결재 대기 3건 · 확인 필요 결정 2건 이상 · 일부 구버전 보고')
  })
  it('결정 수 조회 실패(null)는 실패라고 말하고 점을 달지 않는다', async () => {
    stubShellWith({ pendingApprovals: 3, pendingDecisions: null, pendingDecisionsPartial: false })
    await render()
    expect(badge()?.getAttribute('title')).toBe('결재 대기 3건 · 확인 필요 결정 수 조회 실패')
    expect(badge()?.querySelector('[data-nav-decision-dot]')).toBeNull()
  })
  it('결정 0건이면 종전 그대로', async () => {
    stubShellWith({ pendingApprovals: 3, pendingDecisions: 0, pendingDecisionsPartial: false })
    await render()
    expect(badge()?.getAttribute('title')).toBe('결재 대기 3건')
    expect(badge()?.querySelector('[data-nav-decision-dot]')).toBeNull()
  })
})
