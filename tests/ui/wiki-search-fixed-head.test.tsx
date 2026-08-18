// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WikiSearch } from '@/components/wiki/WikiSearch'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const HITS = [
  { domain: 'minutes', entityId: 'm-1', href: '/minutes/1', title: '보세공장 회의', content: '보세공장 반입 절차', matchedBy: [], occurredOn: '2026-08-01' },
  { domain: 'issues', entityId: 'i-1', href: '/issues/1', title: '보세공장 이슈', content: '보세공장 재고 불일치', matchedBy: [], occurredOn: null },
]

// 질문을 던진 뒤에도 검색 카드(PROJECT MEMORY 히어로)가 그대로 남아야 한다 —
// ProjectPageShell 의 고정 히어로 슬롯에 얹어 스크롤 영역에서 아예 빼는 방식이다.
// 또 결과 툴바(요약·건수)는 왼쪽 열 밖으로 올려, 왼쪽 첫 카드와 오른쪽 읽기 패널의
// 윗변이 같은 높이에서 시작하게 한다(어긋나면 화면이 흔들려 보인다는 사용자 지적).
describe('WikiSearch — 고정 헤드와 두 열 정렬', () => {
  let container: HTMLDivElement
  let root: Root
  const fetchMock = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    fetchMock.mockReset()
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Promise.resolve(Response.json({ results: HITS, degraded: false }))
        : Promise.resolve(Response.json({ domains: [], total: 0 })),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render(initialQuery: string) {
    await act(async () => {
      root.render(
        <WikiSearch
          projectId="proj-1"
          locale="ko"
          initialQuery={initialQuery}
          pageHero={<h1 data-testid="page-hero">D-CUBE 프로젝트 Wiki</h1>}
        />,
      )
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  const scrollRegion = () => container.querySelector('[data-project-scroll-region]')
  const grid = () => container.querySelector('[class*="xl:grid-cols-"]')
  const summarizeButton = () =>
    Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('요약')) ?? null

  it('검색 전에도 후에도 검색 카드는 스크롤 영역 밖(고정 히어로)에 있다', async () => {
    await render('')
    const card = container.querySelector('#wiki-search-title')
    expect(card).not.toBeNull()
    expect(scrollRegion()?.contains(card!)).toBe(false)

    await render('보세공장')
    const after = container.querySelector('#wiki-search-title')
    // 질문을 던져도 카드가 사라지지 않는다 — 이 화면의 머리 부분은 항상 같은 자리다.
    expect(after).not.toBeNull()
    expect(scrollRegion()?.contains(after!)).toBe(false)
  })

  it('페이지 히어로도 같은 고정 영역에 함께 얹힌다', async () => {
    await render('보세공장')
    const hero = container.querySelector('[data-testid="page-hero"]')
    expect(hero).not.toBeNull()
    expect(scrollRegion()?.contains(hero!)).toBe(false)
  })

  it('추천 칩은 검색 뒤에도 남는다', async () => {
    await render('보세공장')
    const chips = Array.from(container.querySelectorAll('button')).filter(b => b.textContent === '핵심 결정')
    expect(chips).toHaveLength(1)
  })

  it('결과 툴바(요약·건수)는 2열 그리드 밖에 있다 — 왼쪽 열만 밀어 내리지 않게', async () => {
    await render('보세공장')
    expect(summarizeButton()).not.toBeNull()
    expect(grid()?.contains(summarizeButton()!)).toBe(false)
  })

  it('그리드의 왼쪽 열은 결과 목록으로 바로 시작한다 — 오른쪽 읽기 패널과 윗변이 맞게', async () => {
    await render('보세공장')
    const columns = grid()!.children
    expect(columns).toHaveLength(2)
    expect(columns[0].firstElementChild?.tagName).toBe('OL')
    expect(columns[1].tagName).toBe('ASIDE')
  })

  it('결과는 스크롤 영역 안에 있다 — 머리는 고정이고 결과만 흐른다', async () => {
    await render('보세공장')
    expect(scrollRegion()?.contains(grid()!)).toBe(true)
  })
})
