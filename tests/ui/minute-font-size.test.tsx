// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Minute } from '@/lib/domain/types'
import {
  MINUTE_FS_DEFAULT, MINUTE_FS_MAX, MINUTE_FS_MIN, MINUTE_FS_STORAGE_KEY,
} from '@/lib/minutes/fontSize'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ queueUiPref: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: mocks.queueUiPref }))
// 본문 렌더는 이 테스트의 관심사가 아니다 — 재파싱 없이 CSS 변수만 바뀌는지를 본다.
// 핵심 성능 계약(글자크기 변경이 MarkdownView props 를 건드리지 않는다)을 감시하려고 호출을 기록한다.
const mdCalls = vi.hoisted(() => ({ props: [] as { content: string; marks?: unknown }[] }))
vi.mock('@/components/minutes/MarkdownView', () => ({
  MarkdownView: (p: { content: string; marks?: unknown }) => {
    mdCalls.props.push(p)
    return <p data-mblock="0" data-testid="md-body">본문</p>
  },
}))
vi.mock('@/components/minutes/MinuteInsightCard', () => ({ MinuteInsightCard: () => null }))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({ MinuteBlockPopover: () => null }))

import { MinuteViewer } from '@/components/minutes/MinuteViewer'
import { ShareViewer } from '@/components/minutes/ShareViewer'

const minute: Minute = {
  id: 'm1', minuteDate: '2026-07-16', teamCode: 'PMO', title: '주간회의',
  bodyMd: '본문', meetingId: null, createdBy: 'u1', createdByName: '작성자',
  createdAt: '2026-07-16T00:00:00Z', updatedAt: '2026-07-16T00:00:00Z',
}

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: number[] = []
}

describe('회의록 뷰어 글자크기 조절', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IntersectionObserver = IntersectionObserverStub
    localStorage.clear()
    mocks.queueUiPref.mockClear()
    mdCalls.props.length = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function mountViewer(initialFontSize: number | null = null) {
    act(() => root.render(
      <StrictMode>
        <MinuteViewer
          minute={minute} files={[]} canManage={false}
          annotations={{ highlights: [], insights: [] }} userId="u1" projects={[]}
          initialFontSize={initialFontSize}
        />
      </StrictMode>,
    ))
  }

  /** 본문 카드 = MarkdownView 를 감싸는 .card. --minutes-fs 는 반드시 여기 붙어야 한다.
   *  (아무 조상이나 잡으면 앵커가 어긋나도 통과하는 가짜 테스트가 된다) */
  function bodyCard(): HTMLElement {
    const el = container.querySelector<HTMLElement>('[data-testid="md-body"]')
      ?.closest<HTMLElement>('div.card')
    if (!el) throw new Error('본문 카드(.card)를 찾지 못했습니다')
    return el
  }
  function fsVar(): string { return bodyCard().style.getPropertyValue('--minutes-fs') }
  function btn(label: string): HTMLButtonElement {
    const el = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (!el) throw new Error(`버튼을 찾지 못했습니다: ${label}`)
    return el
  }
  function resetBtn(): HTMLButtonElement {
    const el = [...container.querySelectorAll('button')]
      .find(b => b.getAttribute('aria-label')?.includes('min.fs.reset'))
    if (!el) throw new Error('리셋 버튼을 찾지 못했습니다')
    return el
  }

  it('기본값 14px 로 렌더되고 본문 카드에 CSS 변수로 내려간다', () => {
    mountViewer()
    expect(fsVar()).toBe(`${MINUTE_FS_DEFAULT}px`)
  })

  it('서버 초기값이 있으면 첫 렌더부터 그 값 — 하이드레이션 파리티', () => {
    mountViewer(22)
    expect(fsVar()).toBe('22px')
    expect(container.textContent).toContain('22')
  })

  it('오염된 서버값은 기본값으로 흡수한다', () => {
    mountViewer(999)
    expect(fsVar()).toBe(`${MINUTE_FS_MAX}px`)
  })

  it('A+ / A- 가 1px 씩 움직이고 localStorage·서버 저장을 함께 부른다', () => {
    mountViewer(14)
    act(() => btn('min.fs.increase').click())
    expect(fsVar()).toBe('15px')
    expect(localStorage.getItem(MINUTE_FS_STORAGE_KEY)).toBe('15')
    expect(mocks.queueUiPref).toHaveBeenCalledWith({ minuteFontSize: 15 })

    act(() => btn('min.fs.decrease').click())
    expect(fsVar()).toBe('14px')
    expect(mocks.queueUiPref).toHaveBeenLastCalledWith({ minuteFontSize: 14 })
  })

  it('경계에서 해당 버튼이 비활성화된다', () => {
    mountViewer(MINUTE_FS_MAX)
    expect(btn('min.fs.increase').disabled).toBe(true)
    expect(btn('min.fs.decrease').disabled).toBe(false)

    act(() => root.unmount())
    root = createRoot(container)
    mountViewer(MINUTE_FS_MIN)
    expect(btn('min.fs.decrease').disabled).toBe(true)
    expect(btn('min.fs.increase').disabled).toBe(false)
  })

  it('숫자 버튼 클릭은 기본 크기로 리셋한다', () => {
    mountViewer(26)
    act(() => resetBtn().click())
    expect(fsVar()).toBe(`${MINUTE_FS_DEFAULT}px`)
  })

  it('서버값이 없으면 마운트 후 localStorage 값을 적용한다', () => {
    localStorage.setItem(MINUTE_FS_STORAGE_KEY, '20')
    mountViewer(null)
    expect(fsVar()).toBe('20px')
  })

  it('서버값이 있으면 localStorage 보다 우선하고 캐시를 서버값으로 맞춘다', () => {
    localStorage.setItem(MINUTE_FS_STORAGE_KEY, '20')
    mountViewer(16)
    expect(fsVar()).toBe('16px')
    expect(localStorage.getItem(MINUTE_FS_STORAGE_KEY)).toBe('16')
  })

  it('손상된 localStorage 값(빈 문자열)은 값 없음으로 보고 기본값을 유지한다', () => {
    localStorage.setItem(MINUTE_FS_STORAGE_KEY, '   ')
    mountViewer(null)
    expect(fsVar()).toBe(`${MINUTE_FS_DEFAULT}px`)
  })

  // 핵심 성능 계약(스펙 §3): 글자크기가 바뀌어도 MarkdownView props 는 그대로여야 한다.
  // 깨지면 1px 조절마다 최대 10만 자 마크다운이 재파싱된다.
  it('글자크기 변경이 MarkdownView props 를 바꾸지 않는다 — 재파싱 회귀 가드', () => {
    mountViewer(14)
    const before = mdCalls.props.at(-1)!
    const rendersBefore = mdCalls.props.length
    act(() => btn('min.fs.increase').click())
    act(() => btn('min.fs.increase').click())
    expect(fsVar()).toBe('16px')
    // 모킹된 MarkdownView 는 memo 가 아니라 매번 다시 불린다 — 그래야 props 참조를 실제로 비교할 수 있다
    expect(mdCalls.props.length).toBeGreaterThan(rendersBefore)
    const after = mdCalls.props.at(-1)!
    expect(after.content).toBe(before.content)
    // 참조 동일성까지 본다 — 새 객체가 만들어지면 memo 가 뚫려 ReactMarkdown 이 재파싱한다
    expect(after.marks).toBe(before.marks)
  })
})

describe('글자크기 SSR/CSR 파리티', () => {
  it('서버 초기값이 SSR HTML 에 그대로 들어간다 — 하이드레이션 불일치 없음', async () => {
    const { renderToString } = await import('react-dom/server')
    const html = renderToString(
      <MinuteViewer
        minute={minute} files={[]} canManage={false}
        annotations={{ highlights: [], insights: [] }} userId="u1" projects={[]}
        initialFontSize={22}
      />,
    )
    // effect 가 돌지 않는 서버 렌더에서도 22px 이 나와야 클라이언트 첫 렌더와 일치한다
    expect(html).toContain('--minutes-fs:22px')
  })

  it('서버값이 없으면 SSR 은 기본값으로 렌더한다 — localStorage 를 초기 렌더에 쓰지 않는다', async () => {
    const { renderToString } = await import('react-dom/server')
    localStorage.setItem(MINUTE_FS_STORAGE_KEY, '26')
    const html = renderToString(
      <MinuteViewer
        minute={minute} files={[]} canManage={false}
        annotations={{ highlights: [], insights: [] }} userId="u1" projects={[]}
        initialFontSize={null}
      />,
    )
    expect(html).toContain(`--minutes-fs:${MINUTE_FS_DEFAULT}px`)
  })
})

describe('공유 뷰어 글자크기 조절(비로그인)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IntersectionObserver = IntersectionObserverStub
    localStorage.clear()
    mocks.queueUiPref.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(
      <StrictMode>
        <ShareViewer minuteDate="2026-07-16" teamCode="PMO" title="주간회의" bodyMd="본문" />
      </StrictMode>,
    ))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('컨트롤이 노출되고 조절되지만 서버 저장은 부르지 않는다', () => {
    const inc = container.querySelector<HTMLButtonElement>('button[aria-label="min.fs.increase"]')!
    act(() => inc.click())
    const card = container.querySelector<HTMLElement>('[data-mblock]')?.closest<HTMLElement>('[style]')
    expect(card?.style.getPropertyValue('--minutes-fs')).toBe('15px')
    expect(localStorage.getItem(MINUTE_FS_STORAGE_KEY)).toBe('15')
    expect(mocks.queueUiPref).not.toHaveBeenCalled()
  })
})
