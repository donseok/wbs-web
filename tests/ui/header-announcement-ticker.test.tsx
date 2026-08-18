// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// react-dom/client의 act를 쓰려면 필요한 플래그.
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 상위 공지는 이제 ShellStateProvider 가 /api/shell GET 1왕복으로 내려준다(티커는 표현만).
// 조회 검증은 fetch 스텁의 route 파라미터로, 표시 분기는 실제 프로바이더+티커 조합으로 본다.
const mocks = vi.hoisted(() => ({ pathname: '/projects' }))
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}))
// next/link는 라우터 컨텍스트 없이 동작하지 않으므로 앵커로 대체.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
// ProjectNavigationProvider 의 최근 프로젝트 저장 — 실제 구현은 디바운스 타이머를 걸어
// fake timer 카운트를 오염시키므로 목킹한다.
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))
// 실시간 구독은 향상 계층 — 테스트 대상 아님(supabase 클라이언트 생성을 피한다).
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: () => {} }))

import { HeaderAnnouncementTicker } from '@/components/app/HeaderAnnouncementTicker'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'

function ha(id: string, title: string, opts: Partial<{ category: 'general' | 'important' | 'event'; isPinned: boolean }> = {}) {
  return { id, title, category: opts.category ?? 'general', isPinned: opts.isPinned ?? false }
}

/** jsdom matchMedia 대체 — min-width(뷰포트 폭)와 prefers-reduced-motion만 분기. */
function stubMatchMedia({ wide = true, reduce = false }: { wide?: boolean; reduce?: boolean } = {}) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : wide,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const PROJECTS = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }]

describe('HeaderAnnouncementTicker', () => {
  let container: HTMLDivElement
  let root: Root
  /** 프로젝트별 상위 공지 — fetch 스텁이 route 파라미터로 골라 payload 에 싣는다. */
  let announcements: Record<string, ReturnType<typeof ha>[]>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    announcements = {}
    fetchMock = vi.fn(async (input: unknown) => {
      const url = new URL(String(input), 'https://dflow.local')
      const route = url.searchParams.get('route')
      return {
        ok: true,
        json: async () => ({
          inbox: { items: [], unseen: 0 },
          notifications: { items: [], count: 0 },
          unreadAnnouncements: 0,
          headerAnnouncements: (route && announcements[route]) || [],
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    stubMatchMedia()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function mount(projectId: string | null) {
    // 실제 앱과 동일하게 URL 프로젝트(route)가 곧 티커의 projectId 다.
    mocks.pathname = projectId ? `/p/${projectId}/dashboard` : '/projects'
    await act(async () => root.render(
      <ProjectNavigationProvider projects={PROJECTS}>
        <ShellStateProvider>
          <HeaderAnnouncementTicker projectId={projectId} />
        </ShellStateProvider>
      </ProjectNavigationProvider>,
    ))
    // 셸 fetch promise 해소 플러시
    await act(async () => {})
  }

  it('첫 공지 제목·카테고리 칩·공지 페이지 링크를 렌더한다', async () => {
    announcements.p1 = [ha('a', '7월 정기 점검 안내', { category: 'important', isPinned: true })]
    await mount('p1')

    const link = container.querySelector<HTMLAnchorElement>('a')!
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toBe('/p/p1/announcements')
    expect(link.textContent).toContain('7월 정기 점검 안내')
    // 기본 컨텍스트의 t()는 키를 그대로 반환 — 카테고리 칩이 dict 키로 연결됐는지 확인
    expect(link.textContent).toContain('ann.cat.important')
  })

  it('2건 이상이면 5초마다 다음 공지로 순환하고 끝에서 처음으로 돌아온다', async () => {
    announcements.p1 = [ha('a', '공지 A'), ha('b', '공지 B'), ha('c', '공지 C')]
    await mount('p1')

    expect(container.textContent).toContain('공지 A')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(container.textContent).toContain('공지 B')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(container.textContent).toContain('공지 C')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(container.textContent).toContain('공지 A')
  })

  it('공지 1건이면 순환 인터벌을 걸지 않는다', async () => {
    announcements.p1 = [ha('a', '공지 A')]
    await mount('p1')

    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(15000) })
    expect(container.textContent).toContain('공지 A')
  })

  it('공지가 없으면 아무것도 렌더하지 않는다', async () => {
    announcements.p1 = []
    await mount('p1')
    expect(container.innerHTML).toBe('')
  })

  it('projectId가 없으면 셸 조회에 route 를 싣지 않고 렌더하지 않는다', async () => {
    announcements.p1 = [ha('a', '공지 A')] // 데이터가 있어도 프로젝트 밖에서는 표시하지 않는다
    await mount(null)
    expect(fetchMock).toHaveBeenCalled()
    expect(String(fetchMock.mock.lastCall?.[0])).not.toContain('route=')
    expect(container.innerHTML).toBe('')
  })

  it('프로젝트가 바뀌면 다시 조회하고 첫 공지부터 표시한다', async () => {
    announcements.p1 = [ha('a', 'P1 공지 A'), ha('b', 'P1 공지 B')]
    announcements.p2 = [ha('x', 'P2 공지 X'), ha('y', 'P2 공지 Y')]
    await mount('p1')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(container.textContent).toContain('P1 공지 B')

    await mount('p2')
    expect(String(fetchMock.mock.lastCall?.[0])).toContain('route=p2')
    // 인덱스가 리셋되지 않으면 두 번째 공지(Y)가 보인다
    expect(container.textContent).toContain('P2 공지 X')
  })

  it('md 미만 뷰포트에서는 렌더하지 않는다', async () => {
    stubMatchMedia({ wide: false })
    announcements.p1 = [ha('a', '공지 A')]
    await mount('p1')

    expect(container.innerHTML).toBe('')
  })

  it('prefers-reduced-motion이면 자동 순환하지 않는다', async () => {
    stubMatchMedia({ reduce: true })
    announcements.p1 = [ha('a', '공지 A'), ha('b', '공지 B')]
    await mount('p1')

    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(15000) })
    expect(container.textContent).toContain('공지 A')
  })

  it('포커스 중에는 순환을 멈추고 블러 후 재개한다', async () => {
    announcements.p1 = [ha('a', '공지 A'), ha('b', '공지 B')]
    await mount('p1')

    const link = container.querySelector<HTMLAnchorElement>('a')!
    act(() => link.focus())
    act(() => { vi.advanceTimersByTime(15000) })
    expect(container.textContent).toContain('공지 A')

    act(() => link.blur())
    act(() => { vi.advanceTimersByTime(5000) })
    expect(container.textContent).toContain('공지 B')
  })

  it('호버 중에는 순환을 멈춘다', async () => {
    announcements.p1 = [ha('a', '공지 A'), ha('b', '공지 B')]
    await mount('p1')

    const link = container.querySelector<HTMLAnchorElement>('a')!
    act(() => { link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    act(() => { vi.advanceTimersByTime(15000) })
    expect(container.textContent).toContain('공지 A')

    act(() => { link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })) })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(container.textContent).toContain('공지 B')
  })

  it('언마운트하면 순환 인터벌이 정리된다', async () => {
    announcements.p1 = [ha('a', '공지 A'), ha('b', '공지 B')]
    await mount('p1')
    expect(vi.getTimerCount()).toBe(1)
    act(() => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
    // afterEach의 중복 unmount는 무해
    root = createRoot(container)
  })
})
