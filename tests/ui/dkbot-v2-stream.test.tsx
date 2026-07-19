// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })

vi.mock('next/navigation', () => ({
  usePathname: () => '/p/12345678-1234-1234-1234-123456789abc/weekly',
  useSearchParams: () => new URLSearchParams('week=2026-07-13'),
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key, locale: 'ko' }),
}))
vi.mock('@/app/actions/wbs', () => ({
  updateActual: vi.fn(),
  updateWbsFields: vi.fn(),
}))

import { BotPageContextProvider } from '@/components/chat/BotPageContextProvider'
import { DkBot } from '@/components/chat/DkBot'

const PROJECT_ID = '12345678-1234-1234-1234-123456789abc'

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      // Deliberately split inside an event to exercise the UI's real stream consumer.
      const text = `${lines.join('\n')}\n`
      const split = Math.floor(text.length / 2)
      controller.enqueue(encoder.encode(text.slice(0, split)))
      controller.enqueue(encoder.encode(text.slice(split)))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } })
}

function setTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('DkBot v2 스트림', () => {
  let container: HTMLDivElement
  let root: Root
  const fetchMock = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/chat/context')) {
        return Response.json({ currentProject: null, totalProjects: 1, weekStartCount: 0 })
      }
      if (url === '/api/chat/v2/stream') {
        const v2CallCount = fetchMock.mock.calls.filter(call => call[0] === '/api/chat/v2/stream').length
        if (v2CallCount > 1) {
          return ndjsonResponse([
            JSON.stringify({ v: 1, requestId: 'r2', type: 'delta', text: '후속 답변' }),
            JSON.stringify({
              v: 1, requestId: 'r2', type: 'done', asOf: '2026-07-19T10:30:00+09:00',
              tools: ['get_weekly_sheet'], truncated: false,
            }),
          ])
        }
        return ndjsonResponse([
          JSON.stringify({ v: 1, requestId: 'r1', type: 'status', message: '주간업무 확인 중' }),
          JSON.stringify({ v: 1, requestId: 'r1', type: 'delta', text: '확인된 부분 답변' }),
          JSON.stringify({
            v: 1,
            requestId: 'r1',
            type: 'sources',
            items: [
              {
                id: 'S1', domain: 'weekly', entityType: 'weekly_report', entityId: 'wr-1',
                projectId: PROJECT_ID, title: '이번 주 업무', href: `/p/${PROJECT_ID}/weekly?week=2026-07-13`,
                updatedAt: null,
              },
              {
                id: 'S2', domain: 'weekly', entityType: 'weekly_report', entityId: 'wr-2',
                projectId: PROJECT_ID, title: '외부 링크', href: '//evil.example/path', updatedAt: null,
              },
            ],
          }),
          JSON.stringify({
            v: 1,
            requestId: 'r1',
            type: 'state',
            conversationState: {
              version: 1,
              lastEntities: [{
                type: 'weekly_report', id: 'wr-1', ref: '첫 번째', projectId: PROJECT_ID, title: '이번 주 업무',
              }],
              lastDomains: ['weekly'],
            },
          }),
          JSON.stringify({
            v: 1, requestId: 'r1', type: 'error', code: 'TOOL_TIMEOUT',
            message: '일부 데이터를 확인하지 못했습니다.', retryable: true,
          }),
        ])
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('PageContextV1을 전송하고 부분 답변·출처·terminal error를 각각 보존한다', async () => {
    await act(async () => {
      root.render(
        <BotPageContextProvider>
          <DkBot projects={[{ id: PROJECT_ID, name: 'ERP' }]} />
        </BotPageContextProvider>,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="chat.open"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => {
      setTextarea(container.querySelector('textarea')!, '주간 이슈 알려줘')
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="chat.send"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const v2Call = fetchMock.mock.calls.find(call => call[0] === '/api/chat/v2/stream') as [string, RequestInit]
    const body = JSON.parse(String(v2Call[1].body))
    expect(body).toMatchObject({
      projectId: PROJECT_ID,
      pageContext: {
        contextVersion: 1,
        domain: 'weekly',
        projectId: PROJECT_ID,
        weekStart: '2026-07-13',
        timezone: 'Asia/Seoul',
      },
      conversationState: { version: 1, lastEntities: [], lastDomains: [] },
    })

    const assistantBubbles = [...container.querySelectorAll<HTMLElement>('[data-chat-role="assistant"]')]
    expect(assistantBubbles.some(node => node.textContent?.includes('확인된 부분 답변'))).toBe(true)
    expect(assistantBubbles.some(node => node.textContent === '일부 데이터를 확인하지 못했습니다.')).toBe(true)
    expect(assistantBubbles.find(node => node.textContent?.includes('확인된 부분 답변')))
      .not.toBe(assistantBubbles.find(node => node.textContent === '일부 데이터를 확인하지 못했습니다.'))
    expect(container.querySelector('a[href^="/p/"]')?.textContent).toContain('이번 주 업무')
    expect(container.querySelector('a[href^="//evil.example"]')).toBeNull()

    await act(async () => {
      setTextarea(container.querySelector('textarea')!, '그 항목 자세히 알려줘')
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="chat.send"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const v2Calls = fetchMock.mock.calls.filter(call => call[0] === '/api/chat/v2/stream') as [string, RequestInit][]
    const followupBody = JSON.parse(String(v2Calls[1][1].body))
    expect(followupBody.conversationState).toMatchObject({
      version: 1,
      lastDomains: ['weekly'],
      lastEntities: [{ type: 'weekly_report', id: 'wr-1', ref: '첫 번째' }],
    })
    expect(container.textContent).toContain('후속 답변')
    expect(container.textContent).toContain('기준 26. 7. 19.')
  })
})
