// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  usePathname: () => '/p/p1/wbs',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
const queueUiPref = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: (...a: unknown[]) => queueUiPref(...(a as [])) }))
// 실시간 구독은 향상 계층 — 테스트 대상 아님(supabase 클라이언트 생성을 피한다).
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: () => {} }))

import { Sidebar, SIDEBAR_TOGGLE_EVENT, dispatchSidebarToggle } from '@/components/app/Sidebar'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'

describe('Sidebar 서버 동기화 배선', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
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
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

  async function mount() {
    await act(async () => root.render(
      <ProjectNavigationProvider projects={[]}>
        <ShellStateProvider>
          <Sidebar projects={[]} />
        </ShellStateProvider>
      </ProjectNavigationProvider>,
    ))
    await act(async () => {}) // /api/shell 응답 flush
  }

  it('dispatchSidebarToggle 는 localStorage 를 갱신하고 서버 쓰기는 하지 않는다', async () => {
    await mount()
    act(() => dispatchSidebarToggle(true))
    expect(localStorage.getItem('dflow-sidebar')).toBe('1')
    expect(queueUiPref).not.toHaveBeenCalled() // reconcile 재사용 안전
  })

  it('외부 토글 이벤트를 받으면 접힘 클래스가 반영된다', async () => {
    await mount()
    await act(async () => { window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT, { detail: { collapsed: true } })) })
    // 접힌 상태의 aside 폭 클래스(w-[78px]) 존재로 확인
    expect(container.querySelector('aside')?.className ?? '').toContain('w-[78px]')
  })

  it('사용자가 접기 버튼을 클릭하면 queueUiPref 로 서버에도 저장된다', async () => {
    await mount()
    const toggleBtn = container.querySelector<HTMLButtonElement>('button[aria-label="사이드바 접기"]')
    expect(toggleBtn).not.toBeNull()
    act(() => toggleBtn!.click())
    expect(queueUiPref).toHaveBeenCalledTimes(1)
    expect(queueUiPref).toHaveBeenCalledWith({ sidebarCollapsed: true })
    // 사용자 클릭 경로도 이벤트 기반 상태 갱신을 거쳐 DOM에 반영된다.
    expect(container.querySelector('aside')?.className ?? '').toContain('w-[78px]')
  })
})
