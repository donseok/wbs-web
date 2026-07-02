// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// react-dom/client의 act를 쓰려면 필요한 플래그.
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 서버 액션 모듈은 jsdom에서 실행 불가('use server' + supabase) — 액션만 모킹.
const mocks = vi.hoisted(() => ({ getHeaderAnnouncements: vi.fn() }))
vi.mock('@/app/actions/announcements', () => ({
  getHeaderAnnouncements: mocks.getHeaderAnnouncements,
}))
// next/link는 라우터 컨텍스트 없이 동작하지 않으므로 앵커로 대체.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

import { HeaderAnnouncementTicker } from '@/components/app/HeaderAnnouncementTicker'

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

describe('HeaderAnnouncementTicker', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.getHeaderAnnouncements.mockReset()
    stubMatchMedia()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  async function mount(projectId: string | null) {
    await act(async () => root.render(<HeaderAnnouncementTicker projectId={projectId} />))
    // 액션 promise 해소 플러시
    await act(async () => {})
  }

  it('첫 공지 제목·카테고리 칩·공지 페이지 링크를 렌더한다', async () => {
    mocks.getHeaderAnnouncements.mockResolvedValue([ha('a', '7월 정기 점검 안내', { category: 'important', isPinned: true })])
    await mount('p1')

    const link = container.querySelector<HTMLAnchorElement>('a')!
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toBe('/p/p1/announcements')
    expect(link.textContent).toContain('7월 정기 점검 안내')
    // 기본 컨텍스트의 t()는 키를 그대로 반환 — 카테고리 칩이 dict 키로 연결됐는지 확인
    expect(link.textContent).toContain('ann.cat.important')
  })

  it('2건 이상이면 5초마다 다음 공지로 순환하고 끝에서 처음으로 돌아온다', async () => {
    mocks.getHeaderAnnouncements.mockResolvedValue([ha('a', '공지 A'), ha('b', '공지 B'), ha('c', '공지 C')])
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
    mocks.getHeaderAnnouncements.mockResolvedValue([ha('a', '공지 A')])
    await mount('p1')

    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(15000) })
    expect(container.textContent).toContain('공지 A')
  })

  it('공지가 없으면 아무것도 렌더하지 않는다', async () => {
    mocks.getHeaderAnnouncements.mockResolvedValue([])
    await mount('p1')
    expect(container.innerHTML).toBe('')
  })

  it('projectId가 없으면 조회하지 않고 렌더하지 않는다', async () => {
    await mount(null)
    expect(mocks.getHeaderAnnouncements).not.toHaveBeenCalled()
    expect(container.innerHTML).toBe('')
  })

  it('프로젝트가 바뀌면 다시 조회하고 첫 공지부터 표시한다', async () => {
    mocks.getHeaderAnnouncements.mockImplementation(async (pid: string) =>
      pid === 'p1' ? [ha('a', 'P1 공지 A'), ha('b', 'P1 공지 B')] : [ha('x', 'P2 공지 X'), ha('y', 'P2 공지 Y')])
    await mount('p1')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(container.textContent).toContain('P1 공지 B')

    await mount('p2')
    expect(mocks.getHeaderAnnouncements).toHaveBeenLastCalledWith('p2')
    // 인덱스가 리셋되지 않으면 두 번째 공지(Y)가 보인다
    expect(container.textContent).toContain('P2 공지 X')
  })

  it('md 미만 뷰포트에서는 조회하지 않고 렌더하지 않는다', async () => {
    stubMatchMedia({ wide: false })
    mocks.getHeaderAnnouncements.mockResolvedValue([ha('a', '공지 A')])
    await mount('p1')

    expect(mocks.getHeaderAnnouncements).not.toHaveBeenCalled()
    expect(container.innerHTML).toBe('')
  })

  it('prefers-reduced-motion이면 자동 순환하지 않는다', async () => {
    stubMatchMedia({ reduce: true })
    mocks.getHeaderAnnouncements.mockResolvedValue([ha('a', '공지 A'), ha('b', '공지 B')])
    await mount('p1')

    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(15000) })
    expect(container.textContent).toContain('공지 A')
  })

  it('포커스 중에는 순환을 멈추고 블러 후 재개한다', async () => {
    mocks.getHeaderAnnouncements.mockResolvedValue([ha('a', '공지 A'), ha('b', '공지 B')])
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
    mocks.getHeaderAnnouncements.mockResolvedValue([ha('a', '공지 A'), ha('b', '공지 B')])
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
    mocks.getHeaderAnnouncements.mockResolvedValue([ha('a', '공지 A'), ha('b', '공지 B')])
    await mount('p1')
    expect(vi.getTimerCount()).toBe(1)
    act(() => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
    // afterEach의 중복 unmount는 무해
    root = createRoot(container)
  })
})
