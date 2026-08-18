// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WikiSearch } from '@/components/wiki/WikiSearch'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 운영 실측 회귀: ?q= 딥링크로 들어오면 입력창은 채워지는데 자동 검색이 돌지 않았다.
// 원인은 WikiSearch 의 마운트-1회 가드가 boolean ref(ranInitial)였다는 것 — Next.js
// 라우터가 같은 페이지 인스턴스를 재사용하며 searchParams(?q=)만 바뀌는 내비게이션에서는
// 리마운트가 없으므로, 최초 자동 실행이 한 번 소비되고 나면 그 뒤에 도착한 새 ?q= 딥링크가
// 조용히 무시됐다. "마지막으로 자동 실행한 값"을 기억하는 방식(lastAutoQuery)으로 바꿔
// 리마운트 없이 initialQuery 가 바뀌어도 새 값에 대해 다시 자동 실행되게 고쳤다.
describe('WikiSearch — ?q= 딥링크 자동 검색', () => {
  let container: HTMLDivElement
  let root: Root
  const fetchMock = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(Response.json({ results: [], degraded: false }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render(initialQuery: string) {
    await act(async () => {
      root.render(<WikiSearch projectId="proj-1" locale="ko" initialQuery={initialQuery} />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  // 마운트 시 읽기 패널의 코퍼스 집계 GET(옵션 없는 fetch)도 나간다 — 검색 POST 만 골라 센다.
  const searchCalls = () =>
    fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')

  it('initialQuery 가 있으면 마운트 시 검색 fetch 가 1회 호출된다', async () => {
    await render('권한')
    expect(searchCalls()).toHaveLength(1)
    expect(searchCalls()[0][0]).toBe('/api/wiki/search')
    const body = JSON.parse(searchCalls()[0][1].body)
    expect(body).toMatchObject({ projectId: 'proj-1', q: '권한' })
  })

  it('initialQuery 가 없으면 마운트 시 자동 검색하지 않는다', async () => {
    await render('')
    expect(searchCalls()).toHaveLength(0)
  })

  it('리마운트 없이 initialQuery 가 새 값으로 바뀌면(라우터가 인스턴스를 재사용) 다시 자동 실행된다', async () => {
    await render('첫검색')
    expect(searchCalls()).toHaveLength(1)
    fetchMock.mockClear()

    // 같은 컴포넌트 트리에 다른 initialQuery 로 재렌더 — Next.js 가 searchParams 만 바뀐
    // 내비게이션에서 페이지 인스턴스를 재사용하는 상황을 흉내낸다(unmount 없음).
    await act(async () => {
      root.render(<WikiSearch projectId="proj-1" locale="ko" initialQuery="두번째검색" />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(searchCalls()).toHaveLength(1)
    const body = JSON.parse(searchCalls()[0][1].body)
    expect(body).toMatchObject({ q: '두번째검색' })
  })

  it('같은 initialQuery 로 재렌더돼도 중복 실행하지 않는다', async () => {
    await render('권한')
    expect(searchCalls()).toHaveLength(1)
    fetchMock.mockClear()

    await act(async () => {
      root.render(<WikiSearch projectId="proj-1" locale="ko" initialQuery="권한" />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(searchCalls()).toHaveLength(0)
  })
})
