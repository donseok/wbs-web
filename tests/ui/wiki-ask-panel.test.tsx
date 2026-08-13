// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  createWikiQuestion: vi.fn(),
  trackWikiEvent: vi.fn(),
}))

vi.mock('@/app/actions/wiki', () => ({
  createWikiQuestion: mocks.createWikiQuestion,
}))

vi.mock('@/components/wiki/wikiAnalytics', () => ({
  trackWikiEvent: mocks.trackWikiEvent,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

import { WikiAskPanel } from '@/components/wiki/WikiAskPanel'

const PROJECT_ID = '12345678-1234-1234-1234-123456789abc'

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`${lines.join('\n')}\n`))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } })
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Wiki Ask 근거 계약', () => {
  let container: HTMLDivElement
  let root: Root
  const fetchMock = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    fetchMock.mockReset()
    mocks.createWikiQuestion.mockReset().mockResolvedValue({ ok: true })
    mocks.trackWikiEvent.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function mountAndAsk(question: string, canLeaveQuestion = true) {
    await act(async () => root.render(
      <WikiAskPanel projectId={PROJECT_ID} locale="ko" canLeaveQuestion={canLeaveQuestion} />,
    ))
    await act(async () => setInput(container.querySelector('input')!, question))
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  it('전용 Ask 답변에 검증 가능한 출처가 없으면 생성 본문을 숨기고 지식 공백으로 처리한다', async () => {
    fetchMock.mockResolvedValue(Response.json({
      answer: '근거 없는 생성 답변', sources: [],
      asOf: '2026-08-13T10:00:00+09:00', truncated: false,
    }))

    await mountAndAsk('결정이 뭐야?')

    expect(container.textContent).not.toContain('근거 없는 생성 답변')
    expect(container.textContent).toContain('이 질문에 답할 만한 지식을 아직 찾지 못했습니다.')
    expect(container.textContent).toContain('질문으로 남기기')
    expect(mocks.trackWikiEvent).toHaveBeenCalledWith(
      'wiki_ask_no_answer',
      `/p/${PROJECT_ID}/wiki`,
      { source_count: 0, truncated: false, fallback: false },
    )
    expect(mocks.trackWikiEvent).not.toHaveBeenCalledWith(
      'wiki_ask_failed',
      expect.anything(),
      expect.anything(),
    )
  })

  it('전용 경로 미지원 시 v2 fallback도 출처 없이는 본문을 숨기고 질문 원문을 분석 이벤트에 싣지 않는다', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/wiki/ask') return new Response('', { status: 404 })
      if (String(input) === '/api/chat/v2/stream') return ndjsonResponse([
        JSON.stringify({ v: 1, requestId: 'r1', type: 'delta', text: '출처 없이 만들어진 fallback 답변' }),
        JSON.stringify({
          v: 1, requestId: 'r1', type: 'done', asOf: '2026-08-13T10:00:00+09:00',
          tools: [], truncated: false,
        }),
      ])
      throw new Error(`unexpected fetch: ${String(input)}`)
    })

    const question = '민감한 원문 질문'
    await mountAndAsk(question)

    expect(container.textContent).not.toContain('출처 없이 만들어진 fallback 답변')
    expect(container.textContent).toContain('질문으로 남기기')
    expect(mocks.trackWikiEvent).toHaveBeenCalledWith(
      'wiki_ask_no_answer',
      `/p/${PROJECT_ID}/wiki`,
      { source_count: 0, truncated: false, fallback: true },
    )
    expect(JSON.stringify(mocks.trackWikiEvent.mock.calls)).not.toContain(question)
  })

  it('비멤버 viewer에게는 실패할 질문 남기기 동작을 노출하지 않는다', async () => {
    fetchMock.mockResolvedValue(Response.json({
      answer: '', sources: [], asOf: '2026-08-13T10:00:00+09:00', truncated: false,
    }))

    await mountAndAsk('구성원만 남길 수 있는 질문', false)

    expect(container.textContent).toContain('프로젝트 구성원이 지식 공백으로 남겨')
    expect(container.textContent).not.toContain('질문으로 남기기')
    expect(mocks.createWikiQuestion).not.toHaveBeenCalled()
  })
})
