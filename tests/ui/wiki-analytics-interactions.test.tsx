// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WikiExplorerItem } from '@/components/wiki/WikiExplorer'
import type { WikiTopicSummary } from '@/lib/data/wiki'

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

vi.mock('@/components/wiki/WikiItemActions', () => ({ WikiItemActions: () => null }))

import { WikiExplorer } from '@/components/wiki/WikiExplorer'
import { WikiSourceLinks } from '@/components/wiki/WikiShared'
import { WikiTopicGrid } from '@/components/wiki/WikiTopicGrid'

const explorerItem: WikiExplorerItem = {
  id: 'item-1',
  projectId: 'project-1',
  topicId: 'topic-1',
  topicTitle: 'ERP 연계',
  kind: 'fact',
  statement: '재처리 큐를 확인한다.',
  lifecycleState: 'active',
  certainty: 'explicit',
  decisionState: null,
  ownerTeam: 'ERP',
  ownerMemberId: null,
  dueDate: null,
  observedAt: null,
  validFrom: null,
  validTo: null,
  origin: 'ai',
  autoUpdateLocked: false,
  reviewState: 'accepted',
  structuredData: {},
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  sources: [],
}

const topic: WikiTopicSummary = {
  id: 'topic-1',
  projectId: 'project-1',
  title: 'ERP 연계',
  normalizedTitle: 'erp-연계',
  type: 'interface',
  ownerTeam: 'ERP',
  bodyMd: '재처리 큐를 확인한다.',
  bodyUpdatedAt: '2026-08-01T00:00:00.000Z',
  bodyUpdatedBy: null,
  parentId: null,
  sort: 0,
  pinnedOrder: null,
  origin: 'manual',
  documentKind: 'runbook',
  verifiedAt: null,
  verifiedBy: null,
  reviewDueAt: null,
  lastChangedAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  itemCount: 1,
  activeDecisionCount: 0,
  openItemCount: 0,
  conflictCount: 0,
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

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

  it('지식 검색은 매 키 입력이 아니라 blur 한 번만 기록하고 결과 주제 열기를 기록한다', async () => {
    await act(async () => root.render(
      <WikiExplorer projectId="project-1" items={[explorerItem]} locale="ko" />,
    ))
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!

    await act(async () => setInput(input, '재처리'))
    expect(mocks.trackWikiEvent).not.toHaveBeenCalled()
    await act(async () => {
      input.focus()
      input.blur()
    })

    expect(mocks.trackWikiEvent).toHaveBeenCalledWith('wiki_search', '/p/project-1/wiki', {
      source: 'explorer', result_count: 1, query_length: 3,
    })
    const topicLink = container.querySelector<HTMLAnchorElement>('a[href="/p/project-1/wiki/topics/topic-1"]')!
    topicLink.addEventListener('click', event => event.preventDefault())
    await act(async () => topicLink.click())
    expect(mocks.trackWikiEvent).toHaveBeenCalledWith('wiki_topic_opened', '/p/project-1/wiki', {
      source: 'explorer', status: 'search_result',
    })
  })

  it('주제 지도 검색과 검색 결과 열기를 각각 한 번 기록한다', async () => {
    await act(async () => root.render(
      <WikiTopicGrid projectId="project-1" topics={[topic]} locale="ko" />,
    ))
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => setInput(input, 'runbook'))
    await act(async () => {
      input.focus()
      input.blur()
    })
    const topicLink = container.querySelector<HTMLAnchorElement>('a[href="/p/project-1/wiki/topics/topic-1"]')!
    topicLink.addEventListener('click', event => event.preventDefault())
    await act(async () => topicLink.click())

    expect(mocks.trackWikiEvent).toHaveBeenCalledWith('wiki_search', '/p/project-1/wiki', {
      source: 'topic_grid', result_count: 1, query_length: 7,
    })
    expect(mocks.trackWikiEvent).toHaveBeenCalledWith('wiki_topic_opened', '/p/project-1/wiki', {
      source: 'topic_grid', status: 'search_result',
    })
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
