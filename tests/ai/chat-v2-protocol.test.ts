import { describe, expect, it } from 'vitest'
import {
  CHAT_PROTOCOL_VERSION,
  encodeChatStreamEvent,
  sanitizeChatRequestV2,
  type ChatDoneEvent,
} from '@/lib/ai/chat/protocol'
import { validateChatProjectScope } from '@/lib/ai/chat/access-scope'

describe('chat v2 protocol', () => {
  it('sanitizes bounded history, page context, filters, and conversation state', () => {
    const result = sanitizeChatRequestV2({
      projectId: 'p1',
      message: '  근태 현황 알려줘  ',
      history: [
        { role: 'system', content: 'drop me' },
        ...Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })),
      ],
      pageContext: {
        contextVersion: 1,
        pathname: '/p/p1/attendance',
        domain: 'attendance',
        projectId: 'p1',
        selectedEntity: null,
        filters: { team: 'ERP', nested: { secret: true }, constructor: 'drop' },
        timezone: 'Asia/Seoul',
      },
      conversationState: {
        version: 1,
        lastEntities: [{ type: 'member', id: 'm1', ref: '첫 번째', projectId: 'p1', title: '홍길동' }],
        lastDomains: ['attendance', 'attendance', 'not-a-domain'],
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.message).toBe('근태 현황 알려줘')
    expect(result.value.history).toHaveLength(12)
    expect(result.value.history[0].content).toBe('m2')
    expect(result.value.pageContext?.filters).toEqual({ team: 'ERP' })
    expect(result.value.conversationState?.lastDomains).toEqual(['attendance'])
    expect(result.value.conversationState?.lastEntities[0]).toMatchObject({ id: 'm1', ref: '첫 번째' })
  })

  it('rejects unsupported context versions and malformed messages', () => {
    expect(sanitizeChatRequestV2({ message: '질문', projectId: null, pageContext: { contextVersion: 2 } }))
      .toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_CONTEXT_VERSION' } })
    expect(sanitizeChatRequestV2({ message: '   ', projectId: null }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(sanitizeChatRequestV2({
      message: '질문', projectId: null,
      pageContext: {
        contextVersion: 1, pathname: '//evil.example/path', domain: 'unknown',
        projectId: null, timezone: 'Asia/Seoul',
      },
    })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  })

  it('encodes exactly one JSON object followed by a newline', () => {
    const event: ChatDoneEvent = {
      v: CHAT_PROTOCOL_VERSION,
      requestId: 'req_1',
      type: 'done',
      asOf: '2026-07-19T00:00:00.000Z',
      tools: [],
      truncated: false,
    }
    const text = new TextDecoder().decode(encodeChatStreamEvent(event))
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text.trim())).toEqual(event)
  })
})

describe('chat v2 project scope hints', () => {
  it('rejects mismatched and out-of-scope project hints', () => {
    const request = {
      projectId: 'p1', message: '질문', history: [],
      pageContext: {
        contextVersion: 1 as const, pathname: '/p/p2/wbs', domain: 'wbs' as const,
        projectId: 'p2', timezone: 'Asia/Seoul' as const,
      },
    }
    expect(validateChatProjectScope(request, ['p1', 'p2']))
      .toMatchObject({ ok: false, code: 'PROJECT_CONTEXT_MISMATCH', status: 400 })
    expect(validateChatProjectScope({ ...request, projectId: 'p2' }, ['p1']))
      .toMatchObject({ ok: false, code: 'PROJECT_ACCESS_DENIED', status: 403 })
  })

  it('validates the selected global-meeting project hint against server scope', () => {
    const request = {
      projectId: null,
      message: '그 회의 상세',
      history: [],
      pageContext: {
        contextVersion: 1 as const,
        pathname: '/meetings',
        domain: 'meetings' as const,
        projectId: null,
        selectedProjectId: 'p2',
        timezone: 'Asia/Seoul' as const,
      },
    }
    expect(validateChatProjectScope(request, ['p1']))
      .toMatchObject({ ok: false, code: 'PROJECT_ACCESS_DENIED', status: 403 })
    expect(validateChatProjectScope(request, ['p1', 'p2']))
      .toMatchObject({ ok: true, projectId: 'p2' })
  })
})
