// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WikiReindexButton } from '@/components/wiki/WikiReindexButton'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type MockResponse = Record<string, unknown> | 'FAIL'

/** action 별 응답 큐를 순서대로 소비하는 fetch 목. 호출된 action 순서를 calls 에 남긴다. */
function makeFetchMock(responses: Partial<Record<string, MockResponse[]>>) {
  const queues = new Map(Object.entries(responses).map(([k, v]) => [k, [...(v ?? [])]]))
  const calls: string[] = []
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { action: string }
    calls.push(body.action)
    const queue = queues.get(body.action)
    const next = queue?.shift()
    if (next === undefined) return new Response('', { status: 503 })
    if (next === 'FAIL') return new Response('', { status: 503 })
    return Response.json(next)
  })
  return { fn, calls }
}

describe('WikiReindexButton', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function mount() {
    await act(async () => {
      root.render(<WikiReindexButton locale="ko" />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  async function clickButton() {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')!.click()
      // enqueue→step(들)→repair(들) 체인이 실제 setTimeout(300ms) 간격을 두므로
      // 넉넉히 흘려보낸다.
      await new Promise(resolve => setTimeout(resolve, 50))
    })
  }

  it('마운트 시 status 를 조회해 상태 줄을 보여준다', async () => {
    const { fn } = makeFetchMock({
      status: [{ pending: 3, deadLetter: 0, docs: 10, chunks: 40, embedded: 37 }],
    })
    vi.stubGlobal('fetch', fn)

    await mount()

    expect(container.textContent).toContain('문서 10')
    expect(container.textContent).toContain('대기 3')
    expect(container.textContent).toContain('임베딩 37/40')
  })

  it('클릭하면 enqueue 다음에 step 을 호출한다', async () => {
    const { fn, calls } = makeFetchMock({
      status: [
        { pending: 1, deadLetter: 0, docs: 1, chunks: 1, embedded: 0 },
        { pending: 0, deadLetter: 0, docs: 1, chunks: 1, embedded: 1 },
      ],
      enqueue: [{ enqueued: 1 }],
      step: [{ claimed: 0, upserted: 0, deleted: 0, failed: 0, requeued: 0 }],
      repair: [{ scanned: 0, repaired: 0, stillNull: 0 }],
    })
    vi.stubGlobal('fetch', fn)

    await mount()
    await clickButton()

    const enqueueIdx = calls.indexOf('enqueue')
    const stepIdx = calls.indexOf('step')
    expect(enqueueIdx).toBeGreaterThanOrEqual(0)
    expect(stepIdx).toBeGreaterThan(enqueueIdx)
  })

  it('step 이 claimed:0 을 반환하면 루프를 멈추고 repair 로 넘어간다', async () => {
    const { fn, calls } = makeFetchMock({
      status: [
        { pending: 1, deadLetter: 0, docs: 1, chunks: 1, embedded: 0 },
        { pending: 0, deadLetter: 0, docs: 1, chunks: 1, embedded: 1 },
      ],
      enqueue: [{ enqueued: 1 }],
      step: [{ claimed: 0, upserted: 0, deleted: 0, failed: 0, requeued: 0 }],
      repair: [{ scanned: 0, repaired: 0, stillNull: 0 }],
    })
    vi.stubGlobal('fetch', fn)

    await mount()
    await clickButton()

    expect(calls.filter(a => a === 'step')).toHaveLength(1)
    expect(calls).toContain('repair')
    expect(container.textContent).toContain('갱신 완료')
  })

  it('repair 가 repaired:0 & stillNull>0 로 끝나면 무료 한도 소진 문구를 정직하게 보여준다', async () => {
    const { fn } = makeFetchMock({
      status: [
        { pending: 1, deadLetter: 0, docs: 1, chunks: 20, embedded: 8 },
        { pending: 0, deadLetter: 0, docs: 1, chunks: 20, embedded: 8 },
      ],
      enqueue: [{ enqueued: 1 }],
      step: [{ claimed: 0, upserted: 0, deleted: 0, failed: 0, requeued: 0 }],
      repair: [{ scanned: 12, repaired: 0, stillNull: 12 }],
    })
    vi.stubGlobal('fetch', fn)

    await mount()
    await clickButton()

    expect(container.textContent).toContain('임베딩 무료 한도 소진')
    expect(container.textContent).toContain('12건 남음')
    // "갱신 완료" 로 위장하지 않는다.
    expect(container.textContent).not.toContain('갱신 완료')
  })

  it('step 이 비 2xx 면 정직하게 실패를 알리고 repair 로 넘어가지 않는다', async () => {
    const { fn, calls } = makeFetchMock({
      status: [{ pending: 1, deadLetter: 0, docs: 1, chunks: 1, embedded: 0 }],
      enqueue: [{ enqueued: 1 }],
      step: ['FAIL'],
    })
    vi.stubGlobal('fetch', fn)

    await mount()
    await clickButton()

    expect(container.textContent).toContain('갱신 중 오류가 발생했습니다')
    expect(calls).not.toContain('repair')
  })
})
