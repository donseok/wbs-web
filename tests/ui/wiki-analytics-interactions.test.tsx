// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  trackWikiEvent: vi.fn(),
}))

vi.mock('@/components/wiki/wikiAnalytics', () => ({
  trackWikiEvent: mocks.trackWikiEvent,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/p/project-1/wiki/topics/topic-1',
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { WikiSourceLinks } from '@/components/wiki/WikiShared'

describe('Wiki 탐색 계측', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.trackWikiEvent.mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('회의 근거 링크는 목적지가 아니라 현재 Wiki 상세 경로에서 열린 것으로 기록한다', async () => {
    await act(async () => root.render(
      <WikiSourceLinks
        locale="ko"
        sources={[{
          id: 'source-1',
          wikiItemId: 'item-1',
          minuteId: 'minute-1',
          minuteVersionId: null,
          bodyHash: null,
          blockIndex: null,
          blockHash: null,
          evidenceExcerpt: null,
          relation: 'supports',
          createdAt: null,
          minuteTitle: '운영 회의',
          minuteDate: '2026-08-01',
        }]}
      />,
    ))
    const sourceLink = container.querySelector<HTMLAnchorElement>('a[href="/minutes/minute-1"]')!
    sourceLink.addEventListener('click', event => event.preventDefault())
    await act(async () => sourceLink.click())

    expect(mocks.trackWikiEvent).toHaveBeenCalledWith(
      'wiki_source_opened',
      '/p/project-1/wiki/topics/topic-1',
      { domain: 'minutes' },
    )
  })
})
