// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))

import { MinuteVersionPanel, type MinuteVersionListItem } from '@/components/minutes/MinuteVersionPanel'

const VERSIONS: MinuteVersionListItem[] = [
  { id: 'v2', versionNo: 2, createdAt: '2026-08-03T13:05:00+09:00', createdByName: '장종익', viewHref: '/minutes/m1' },
  { id: 'v1', versionNo: 1, createdAt: '2026-07-31T16:09:00+09:00', createdByName: '장종익', viewHref: '/minutes/m1?v=1' },
]

describe('MinuteVersionPanel 접기 — 과거 버전 열람 화면이 본문을 밀어내지 않게', () => {
  let container: HTMLDivElement, root: Root

  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  function render(embedded: boolean) {
    act(() => root.render(
      <MinuteVersionPanel
        versions={VERSIONS} currentVersionNo={2} selectedVersionNo={embedded ? null : 1}
        embedded={embedded}
      />,
    ))
  }

  it('독립 카드는 기본 접힘 — 헤더 한 줄만 남고 버전 목록·설명이 없다', () => {
    render(false)
    expect(container.querySelector('ul')).toBeNull()
    expect(container.textContent).not.toContain('min.version.desc')
    // 총 개수는 접힌 상태에서도 보인다
    expect(container.textContent).toContain('min.version.total')
    const btn = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.textContent).toContain('min.version.expand')
  })

  it('펼치기 클릭 → 버전 목록이 나타나고, 다시 접으면 사라진다', () => {
    render(false)
    const btn = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    act(() => btn.click())
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.textContent).toContain('min.version.collapse')
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.textContent).toContain('min.version.previous')
    act(() => btn.click())
    expect(container.querySelector('ul')).toBeNull()
  })

  // 기본 접힘이 '위쪽 배너가 계속 있을 것'이라는 외부 가정에 기대지 않게 하는 계약.
  it('접힘 헤더가 열람 중 버전을 스스로 알린다 — 펼치면 항목 쪽으로 넘겨 중복하지 않는다', () => {
    render(false)
    const header = container.querySelector('section > div')!
    expect(header.textContent).toContain('v1')
    expect(header.textContent).toContain('min.version.viewing')

    const btn = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    act(() => btn.click())
    // 펼친 뒤에는 헤더 칩이 사라지고, 선택된 v1 항목에만 '열람 중'이 붙는다
    expect(container.querySelector('section > div')!.textContent).not.toContain('min.version.viewing')
    const items = [...container.querySelectorAll('li')]
    const viewing = items.filter(li => li.textContent?.includes('min.version.viewing'))
    expect(viewing.length).toBe(1)
    expect(viewing[0].textContent).toContain('v1')
    // 현재 버전(v2)에는 '현재 버전'만 — 두 신호가 한 항목에 겹치지 않는다
    const currentItem = items.find(li => li.textContent?.includes('min.version.current'))!
    expect(currentItem.textContent).toContain('v2')
    expect(currentItem.textContent).not.toContain('min.version.viewing')
  })

  it('버전 1건이면 이전 버전 구획 없이 현재 버전만 — 접기는 그대로 동작', () => {
    act(() => root.render(
      <MinuteVersionPanel versions={[VERSIONS[0]]} currentVersionNo={2} selectedVersionNo={null} />,
    ))
    expect(container.textContent).toContain('min.version.total')
    // selectedVersionNo 가 없으면 접힘 헤더 칩도 없다
    expect(container.textContent).not.toContain('min.version.viewing')
    const btn = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    act(() => btn.click())
    expect(container.querySelectorAll('li').length).toBe(1)
    expect(container.textContent).not.toContain('min.version.previous')
  })

  it('embedded(핵심 요약 카드 내부)는 접기 버튼 없이 항상 전체 렌더 — 이중 접기 금지', () => {
    render(true)
    expect(container.querySelector('button[aria-expanded]')).toBeNull()
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.textContent).toContain('min.version.desc')
  })

  // 헤더 우측 고정점은 마지막 요소 하나뿐이어야 한다 — 둘 다 ml-auto 면 맨텍스트
  // '총 n개'와 '펼치기'가 8px 간격으로 붙어 한 덩어리로 읽힌다.
  it('ml-auto 는 렌더된 마지막 요소만 갖는다 — 접기 가능하면 토글, embedded 면 개수', () => {
    render(false)
    const count = [...container.querySelectorAll('span')]
      .find(el => el.textContent === 'min.version.total')!
    expect(count.className).not.toContain('ml-auto')
    expect(container.querySelector('button[aria-expanded]')!.className).toContain('ml-auto')

    act(() => root.render(
      <MinuteVersionPanel versions={VERSIONS} currentVersionNo={2} embedded />,
    ))
    const embeddedCount = [...container.querySelectorAll('span')]
      .find(el => el.textContent === 'min.version.total')!
    expect(embeddedCount.className).toContain('ml-auto')
  })

  it('접기 chevron 은 aria-hidden — 이 파일의 다른 lucide 아이콘 관례', () => {
    render(false)
    const btn = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    expect(btn.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    act(() => btn.click())
    expect(btn.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })
})
