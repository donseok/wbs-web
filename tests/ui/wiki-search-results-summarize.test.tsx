// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WikiSearchResults } from '@/components/wiki/WikiSearchResults'
import type { SearchHit, SearchViewState } from '@/lib/domain/searchView'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const hit: SearchHit = {
  domain: 'minutes', entityType: 'minute', entityId: 'm1',
  title: '정례 회의', content: '권한 신청 절차는 IT팀 승인 후 처리된다',
  href: '/p/x/minutes/m1', occurredOn: '2026-07-14', score: 0.9, matchedBy: ['vector'],
}
const doneState: SearchViewState = { kind: 'done', hits: [hit], degraded: false }

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(onResolve => { resolve = onResolve })
  return { promise, resolve }
}

describe('WikiSearchResults 요약 버튼 — POST /api/wiki/summarize', () => {
  let container: HTMLDivElement
  let root: Root
  const fetchMock = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function mount() {
    await act(async () => root.render(
      <WikiSearchResults state={doneState} locale="ko" query="권한" projectId="proj-1" />,
    ))
  }

  async function clickSummarize() {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')!.click()
      // fetch 체인(mock 응답 → res.ok 판정 → res.json())이 전부 미시태스크이므로
      // 매크로태스크(setTimeout 0) 지점까지 오면 이미 다 흘렀다 — wiki-ask-panel 테스트와 동일 관용구.
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  it('진행 중에는 로딩 문구를 먼저 보여준다', async () => {
    const pending = deferred<Response>()
    fetchMock.mockReturnValueOnce(pending.promise)
    await mount()

    await clickSummarize()
    expect(container.textContent).toContain('요약을 만드는 중')

    // 테스트 정리 — 매달린 promise 를 풀어둔다.
    await act(async () => { pending.resolve(Response.json({ answer: 'x' })); await pending.promise })
  })

  it('성공하면 불릿 위에 답변 문단을 렌더하고, sources 페이로드를 올바르게 보낸다', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ answer: '권한 신청은 IT팀 승인 후 처리됩니다 [1].' }))
    await mount()
    await clickSummarize()

    expect(container.textContent).toContain('권한 신청은 IT팀 승인 후 처리됩니다 [1].')
    expect(fetchMock).toHaveBeenCalledWith('/api/wiki/summarize', expect.objectContaining({
      method: 'POST',
    }))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ projectId: 'proj-1', q: '권한' })
    expect(body.sources).toEqual([
      expect.objectContaining({ n: 1, title: '정례 회의', domain: '회의록' }),
    ])
    expect(body.sources[0].snippet).toContain('권한 신청 절차는 IT팀 승인')
  })

  it('실패(비 2xx)면 정직하게 실패 문구를 보여준다 — 빈 답으로 위장하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    await mount()
    await clickSummarize()

    expect(container.textContent).toContain('요약을 만들지 못했습니다')
  })

  it('새 검색(state 교체)이 오면 이전 요약을 지운다', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ answer: '이전 요약 문단' }))
    await mount()
    await clickSummarize()
    expect(container.textContent).toContain('이전 요약 문단')

    const nextState: SearchViewState = { kind: 'done', hits: [hit], degraded: false }
    await act(async () => root.render(
      <WikiSearchResults state={nextState} locale="ko" query="권한" projectId="proj-1" />,
    ))
    expect(container.textContent).not.toContain('이전 요약 문단')
  })
})
