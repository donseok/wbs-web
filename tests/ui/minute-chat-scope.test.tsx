// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))

import { MinuteChatPanel } from '@/components/minutes/MinuteChatPanel'

function streamResponse(text: string): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(enc.encode(text)); c.close() },
  })
  return { ok: true, body } as unknown as Response
}

/** React 제어 input 에 값 주입 — native setter 로 써야 onChange 가 발화한다. */
function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('MinuteChatPanel 범위 전환', () => {
  let container: HTMLDivElement, root: Root
  const fetchMock = vi.fn()

  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => streamResponse('답변'))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

  function tab(label: string): HTMLButtonElement {
    const el = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find(b => b.textContent === label)
    if (!el) throw new Error(`탭 없음: ${label}`)
    return el
  }
  async function send(text: string) {
    await act(async () => { setInput(container.querySelector('input')!, text) })
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="min.chat.send"]')!.click() })
    await act(async () => { await Promise.resolve() }) // 스트림 flush
  }
  function lastBody(): Record<string, unknown> {
    const call = fetchMock.mock.calls.at(-1) as [string, { body: string }]
    return JSON.parse(call[1].body) as Record<string, unknown>
  }
  async function mountPanel() {
    await act(async () => root.render(<MinuteChatPanel minuteId="m-1" />))
  }

  it('질문 패널은 기본으로 열린다', async () => {
    await mountPanel()
    expect(tab('min.chat.scope.doc')).toBeTruthy()
    expect(container.querySelector('input[placeholder="min.chat.placeholder"]')).toBeTruthy()
  })

  it('기본(이 문서) 전송은 mode=doc + minuteId', async () => {
    await mountPanel()
    await send('요약해줘')
    expect(lastBody()).toMatchObject({ mode: 'doc', minuteId: 'm-1', message: '요약해줘' })
  })

  it('전체 회의록 탭 전송은 mode=archive + null 필터', async () => {
    await mountPanel()
    await act(async () => { tab('min.chat.scope.all').click() })
    await send('PI 관련 회의 찾아줘')
    expect(lastBody()).toMatchObject({
      mode: 'archive',
      message: 'PI 관련 회의 찾아줘',
      filters: { team: null, from: null, to: null },
    })
    expect(lastBody()).not.toHaveProperty('minuteId')
  })

  it('범위 전환 후에도 각 스레드 대화가 보존된다', async () => {
    await mountPanel()
    await send('문서 질문')
    expect(container.textContent).toContain('문서 질문')

    await act(async () => { tab('min.chat.scope.all').click() })
    expect(container.textContent).not.toContain('문서 질문') // archive 스레드는 비어 있음

    await send('보관함 질문')
    expect(container.textContent).toContain('보관함 질문')

    await act(async () => { tab('min.chat.scope.doc').click() })
    expect(container.textContent).toContain('문서 질문')      // doc 스레드 보존
    expect(container.textContent).not.toContain('보관함 질문')
  })
})
