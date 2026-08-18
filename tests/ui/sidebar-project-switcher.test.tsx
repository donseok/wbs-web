// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SidebarProject } from '@/components/app/Sidebar'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  pathname: '/projects',
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({
    t: (key: string) => ({
      'common.selectProject': '프로젝트 선택',
      'common.noProjects': '등록된 프로젝트 없음',
      'common.viewAll': '전체 보기',
    } as Record<string, string>)[key] ?? key,
  }),
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))
// 실시간 구독은 향상 계층 — 테스트 대상 아님(supabase 클라이언트 생성을 피한다).
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: () => {} }))

import { dispatchSidebarToggle, Sidebar } from '@/components/app/Sidebar'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'

const projects: SidebarProject[] = [
  { id: 'p1', name: 'ERP 프로젝트', status: 'active' },
  { id: 'p2', name: '물류 혁신', status: 'ready' },
]

describe('Sidebar 프로젝트 콤보박스', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.pathname = '/projects'
    mocks.push.mockReset()
    localStorage.clear()
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

  async function render(
    pathname: string,
    items: SidebarProject[] = projects,
    initialLastProjectId: string | null = null,
  ) {
    mocks.pathname = pathname
    await act(async () => {
      root.render(
        <ProjectNavigationProvider
          projects={items}
          initialLastProjectId={initialLastProjectId}
          initialLastProjectHref={initialLastProjectId ? `/p/${initialLastProjectId}/wbs` : null}
        >
          <ShellStateProvider>
            <Sidebar projects={items} />
          </ShellStateProvider>
        </ProjectNavigationProvider>,
      )
    })
    await act(async () => {}) // /api/shell 응답 flush
  }

  function selector(): HTMLSelectElement {
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="프로젝트 선택"]')
    if (!select) throw new Error('프로젝트 선택 콤보박스를 찾지 못했습니다.')
    return select
  }

  it('현재 프로젝트를 표시하고 다른 프로젝트 선택 시 기존처럼 대시보드로 이동한다', async () => {
    await render('/p/p1/issues')

    const select = selector()
    expect(select.value).toBe('p1')
    expect([...select.options].map(option => option.textContent)).toEqual([
      '프로젝트 선택',
      'ERP 프로젝트 · 진행중',
      '물류 혁신 · 준비',
    ])
    expect(container.querySelector('a[href="/projects"]')?.textContent).toBe('전체 보기')

    act(() => {
      select.value = 'p2'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(mocks.push).toHaveBeenCalledOnce()
    expect(mocks.push).toHaveBeenCalledWith('/p/p2/dashboard')
  })

  it('회의록의 최근 프로젝트는 메뉴 문맥으로만 유지하고 콤보에서는 다시 선택할 수 있다', async () => {
    await render('/minutes', projects, 'p1')

    const select = selector()
    expect(select.value).toBe('')
    expect(container.textContent).toContain('ERP 프로젝트 메뉴')

    act(() => {
      select.value = 'p1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(mocks.push).toHaveBeenCalledWith('/p/p1/dashboard')
  })

  it('프로젝트가 100개여도 페이지 링크 목록 대신 콤보박스 하나만 렌더링한다', async () => {
    const many: SidebarProject[] = Array.from({ length: 100 }, (_, index) => ({
      id: `project-${index + 1}`,
      name: `프로젝트 ${index + 1}`,
      status: index % 2 === 0 ? 'active' : 'ready',
    }))
    await render('/projects', many)

    expect(container.querySelectorAll('select[aria-label="프로젝트 선택"]')).toHaveLength(1)
    expect(selector().options).toHaveLength(101)
    expect(container.querySelectorAll('a[href^="/p/"][href$="/dashboard"]')).toHaveLength(0)
  })

  it('접힌 사이드바에서도 접근 가능한 콤보박스 하나로 프로젝트를 전환한다', async () => {
    await render('/p/p1/issues')

    await act(async () => dispatchSidebarToggle(true))

    const select = selector()
    expect(container.querySelectorAll('select[aria-label="프로젝트 선택"]')).toHaveLength(1)
    expect(select.disabled).toBe(false)
    expect(select.value).toBe('p1')
    expect(select.options[0].disabled).toBe(true)

    act(() => {
      select.value = 'p2'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(mocks.push).toHaveBeenCalledWith('/p/p2/dashboard')
  })

  it('프로젝트가 없으면 비활성 콤보에 빈 상태만 표시한다', async () => {
    await render('/projects', [])

    const select = selector()
    expect(select.disabled).toBe(true)
    expect(select.options).toHaveLength(1)
    expect(select.options[0].textContent).toBe('등록된 프로젝트 없음')
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
