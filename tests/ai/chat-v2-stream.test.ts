import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateAnswer } from '@/lib/ai/llm'
import {
  createChatNdjsonStream,
  deterministicEvidenceAnswer,
  orchestrateChatV2,
  synthesisPayloadForPrompt,
} from '@/lib/ai/chat/orchestrator'
import { buildEvidencePack } from '@/lib/ai/chat/evidence'
import { createChatToolRegistry } from '@/lib/ai/chat/registry'
import type { ChatStreamEvent } from '@/lib/ai/chat/protocol'
import type { ReadOnlyBotTool } from '@/lib/ai/tools/types'

vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(generateAnswer).mockReset()
})

async function readEvents(stream: ReadableStream<Uint8Array>): Promise<ChatStreamEvent[]> {
  const text = await new Response(stream).text()
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as ChatStreamEvent)
}

async function* sequence(items: ChatStreamEvent[], fail = false): AsyncGenerator<ChatStreamEvent> {
  for (const item of items) yield item
  if (fail) throw new Error('boom')
}

const base = { v: 1 as const, requestId: 'req_test' }

describe('chat v2 NDJSON stream', () => {
  it('keeps exactly one successful terminal event', async () => {
    const stream = createChatNdjsonStream(sequence([
      { ...base, type: 'status', message: 'loading' },
      { ...base, type: 'done', asOf: '2026-07-19T00:00:00.000Z', tools: [], truncated: false },
      { ...base, type: 'error', code: 'LATE', message: 'must not leak', retryable: false },
    ]), { requestId: base.requestId })
    const events = await readEvents(stream)
    expect(events.map(e => e.type)).toEqual(['status', 'done'])
    expect(events.filter(e => e.type === 'done' || e.type === 'error')).toHaveLength(1)
  })

  it('turns an exception after a partial delta into one error terminal', async () => {
    const stream = createChatNdjsonStream(sequence([
      { ...base, type: 'delta', text: 'partial' },
    ], true), { requestId: base.requestId })
    const events = await readEvents(stream)
    expect(events.map(e => e.type)).toEqual(['delta', 'error'])
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'STREAM_ERROR', retryable: true })
  })

  it('adds an error terminal if the producer ends without one', async () => {
    const events = await readEvents(createChatNdjsonStream(sequence([
      { ...base, type: 'status', message: 'loading' },
    ]), { requestId: base.requestId }))
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'STREAM_INCOMPLETE' })
  })
})

describe('chat v2 orchestrator', () => {
  it('executes only the registered read tool and emits sources/state/done', async () => {
    const execute = vi.fn(async () => ({
      ok: true as const,
      result: {
        status: 'ok' as const,
        facts: { total: 1 },
        records: [{ id: 'a', name: '설계', actualPct: 30 }],
        sources: [{
          id: 'wbs:a', domain: 'wbs' as const, entityType: 'wbs_item' as const, entityId: 'a',
          projectId: 'p1', title: '설계', href: '/p/p1/wbs?focus=a', updatedAt: null,
        }],
        asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
      },
    }))
    const tool: ReadOnlyBotTool = { name: 'find_wbs_items', requiredCapability: 'wbs:read', execute }
    const synthesize = vi.fn(async () => null)
    vi.stubEnv('CHAT_V2_LLM_SYNTHESIS_ENABLED', 'false')
    const events = [...await (async () => {
      const out: ChatStreamEvent[] = []
      for await (const e of orchestrateChatV2(
        { projectId: 'p1', message: '지연 작업 알려줘', history: [] },
        {
          requestId: base.requestId,
          registry: createChatToolRegistry([tool]),
          now: new Date('2026-07-19T00:00:00.000Z'),
          context: {
            userId: 'u1', role: null, teamId: null, capabilities: ['wbs:read'], allowedProjectIds: ['p1'],
            pageContext: null, now: '2026-07-19T00:00:00.000Z', timezone: 'Asia/Seoul',
          },
          synthesize,
        },
      )) out.push(e)
      return out
    })()]
    expect(execute).toHaveBeenCalledOnce()
    expect(synthesize).toHaveBeenCalledOnce()
    expect(generateAnswer).not.toHaveBeenCalled()
    const answer = events.filter(e => e.type === 'delta').map(e => e.type === 'delta' ? e.text : '').join('')
    expect(answer).toContain('조회 요약')
    expect(answer).toContain('작업명: 설계')
    expect(answer).toContain('실적률: 30%')
    expect(answer).not.toContain('actualPct')
    expect(events.some(e => e.type === 'sources')).toBe(true)
    expect(events.some(e => e.type === 'state')).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'done', tools: ['find_wbs_items'] })
  })

  it('returns an error terminal when every planned tool fails', async () => {
    const tool: ReadOnlyBotTool = {
      name: 'get_attendance', requiredCapability: 'attendance:read',
      execute: async () => ({ ok: false, error: { code: 'DATA_SOURCE_ERROR', message: 'down', retryable: true } }),
    }
    const events: ChatStreamEvent[] = []
    for await (const e of orchestrateChatV2(
      { projectId: 'p1', message: '오늘 연차인 사람', history: [] },
      {
        requestId: base.requestId,
        registry: createChatToolRegistry([tool]),
        now: new Date('2026-07-19T00:00:00.000Z'),
        context: {
          userId: 'u1', role: null, teamId: null, capabilities: ['attendance:read'], allowedProjectIds: ['p1'],
          pageContext: null, now: '2026-07-19T00:00:00.000Z', timezone: 'Asia/Seoul',
        },
      },
    )) events.push(e)
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'ALL_TOOLS_FAILED', retryable: true })
    expect(events.filter(e => e.type === 'done' || e.type === 'error')).toHaveLength(1)
  })

  it('finishes with successful evidence when one independent tool is unavailable', async () => {
    const attendance: ReadOnlyBotTool = {
      name: 'get_attendance', requiredCapability: 'attendance:read',
      execute: async () => ({
        ok: true,
        result: {
          status: 'ok', facts: { totalMatched: 1 },
          records: [{ id: 'ar1', memberName: '홍길동', date: '2026-07-20', type: 'annual' }],
          sources: [{
            id: 'attendance:ar1', domain: 'attendance', entityType: 'attendance_record', entityId: 'ar1',
            projectId: 'p1', title: '홍길동 연차', href: '/p/p1/attendance', updatedAt: null,
          }],
          asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
        },
      }),
    }
    const events: ChatStreamEvent[] = []
    let failedToolsInPrompt: unknown
    for await (const e of orchestrateChatV2(
      { projectId: 'p1', message: '내일 회의 참석자 중 휴가인 사람이 있나?', history: [] },
      {
        requestId: base.requestId,
        registry: createChatToolRegistry([attendance]),
        now: new Date('2026-07-19T00:00:00.000Z'),
        context: {
          userId: 'u1', role: null, teamId: null,
          capabilities: ['attendance:read', 'meetings:read'], allowedProjectIds: ['p1'],
          pageContext: null, now: '2026-07-19T00:00:00.000Z', timezone: 'Asia/Seoul',
        },
        route: {
          kind: 'tools', domains: ['attendance', 'meetings'], reason: 'partial tool regression',
          statusMessage: '조회 중',
          calls: [
            {
              id: 'attendance', tool: 'get_attendance', domain: 'attendance',
              args: { projectId: 'p1', from: '2026-07-20', to: '2026-07-20' },
            },
            {
              id: 'meetings', tool: 'list_meetings', domain: 'meetings',
              args: { projectId: 'p1', from: '2026-07-20', to: '2026-07-20' },
            },
          ],
        },
        synthesize: async input => {
          failedToolsInPrompt = synthesisPayloadForPrompt(input).failedTools
          return null
        },
      },
    )) events.push(e)
    expect(events.at(-1)).toMatchObject({ type: 'done', tools: ['get_attendance'] })
    const text = events.filter(e => e.type === 'delta').map(e => e.type === 'delta' ? e.text : '').join('')
    expect(text).toContain('홍길동')
    expect(text).toContain('일부 데이터')
    expect(failedToolsInPrompt).toEqual(['list_meetings'])
  })

  it('falls back to a deterministic answer when synthesis times out', async () => {
    const tool: ReadOnlyBotTool = {
      name: 'find_wbs_items', requiredCapability: 'wbs:read',
      execute: async () => ({
        ok: true,
        result: {
          status: 'ok', facts: { returned: 1 }, records: [{ id: 'a', name: '설계' }],
          sources: [{
            id: 'wbs:a', domain: 'wbs', entityType: 'wbs_item', entityId: 'a',
            projectId: 'p1', title: '설계', href: '/p/p1/wbs?focus=a', updatedAt: null,
          }],
          asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
        },
      }),
    }
    const events: ChatStreamEvent[] = []
    for await (const e of orchestrateChatV2(
      { projectId: 'p1', message: '지연 작업 알려줘', history: [] },
      {
        requestId: base.requestId,
        registry: createChatToolRegistry([tool]),
        now: new Date('2026-07-19T00:00:00.000Z'),
        context: {
          userId: 'u1', role: null, teamId: null, capabilities: ['wbs:read'], allowedProjectIds: ['p1'],
          pageContext: null, now: '2026-07-19T00:00:00.000Z', timezone: 'Asia/Seoul',
        },
        synthesize: () => new Promise(() => undefined),
        synthesisTimeoutMs: 5,
      },
    )) events.push(e)
    const text = events.filter(e => e.type === 'delta').map(e => e.type === 'delta' ? e.text : '').join('')
    expect(text).toContain('설계')
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('bounds long evidence prompts and reports prompt-only truncation', async () => {
    const records = Array.from({ length: 55 }, (_, i) => ({
      id: `row-${i}`,
      thisContent: `업무-${i}-` + '가'.repeat(20_000),
      thisIssue: '나'.repeat(20_000),
    }))
    const tool: ReadOnlyBotTool = {
      name: 'find_wbs_items', requiredCapability: 'wbs:read',
      execute: async () => ({
        ok: true,
        result: {
          status: 'ok', facts: { returned: records.length }, records,
          sources: [{
            id: 'wbs:a', domain: 'wbs', entityType: 'wbs_item', entityId: 'a',
            projectId: 'p1', title: '대용량 근거', href: '/p/p1/wbs?focus=a', updatedAt: null,
          }],
          asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
        },
      }),
    }
    let promptLength = 0
    const events: ChatStreamEvent[] = []
    for await (const e of orchestrateChatV2(
      { projectId: 'p1', message: '지연 작업 알려줘', history: [] },
      {
        requestId: base.requestId,
        registry: createChatToolRegistry([tool]),
        now: new Date('2026-07-19T00:00:00.000Z'),
        context: {
          userId: 'u1', role: null, teamId: null, capabilities: ['wbs:read'], allowedProjectIds: ['p1'],
          pageContext: null, now: '2026-07-19T00:00:00.000Z', timezone: 'Asia/Seoul',
        },
        synthesize: async input => {
          promptLength = JSON.stringify(synthesisPayloadForPrompt(input)).length
          return null
        },
      },
    )) events.push(e)
    expect(promptLength).toBeLessThanOrEqual(100_000)
    expect(events.at(-1)).toMatchObject({ type: 'done', truncated: true })
  })

  it('rejects an entire tool result when records are cross-project, sources are invalid, or records have no source', async () => {
    const result = (
      facts: Record<string, string | number | boolean | null>,
      records: Array<Record<string, unknown>>,
      sources: Array<Record<string, unknown>>,
    ) => ({
      ok: true as const,
      result: {
        status: 'ok' as const,
        facts,
        records,
        sources: sources as never[],
        asOf: '2026-07-19T00:00:00.000Z',
        truncated: false,
        warnings: [],
      },
    })
    const safeSource = (id: string, entityId: string) => ({
      id,
      domain: 'wbs',
      entityType: 'wbs_item',
      entityId,
      projectId: 'p1',
      title: entityId,
      href: `/p/p1/wbs?focus=${entityId}`,
      updatedAt: null,
    })
    const tools: ReadOnlyBotTool[] = [
      {
        name: 'find_wbs_items', requiredCapability: 'wbs:read',
        execute: async () => result(
          { returned: 1 },
          [{ id: 'safe', projectId: 'p1', name: 'SAFE_RECORD' }],
          [safeSource('safe-source', 'safe')],
        ),
      },
      {
        name: 'get_wbs_item_detail', requiredCapability: 'wbs:read',
        execute: async () => result(
          { CROSS_PROJECT_SECRET_FACT: 901 },
          [{ id: 'cross', projectId: 'p2', name: 'CROSS_PROJECT_SECRET_RECORD' }],
          [safeSource('cross-masked-as-safe', 'cross')],
        ),
      },
      {
        name: 'get_wbs_change_log', requiredCapability: 'wbs:read',
        execute: async () => result(
          { INVALID_SOURCE_SECRET_FACT: 902 },
          [{ id: 'invalid-source', projectId: 'p1', name: 'INVALID_SOURCE_SECRET_RECORD' }],
          [{ ...safeSource('invalid-source', 'invalid-source'), href: 'https://evil.example/secret' }],
        ),
      },
      {
        name: 'list_wbs_attachments', requiredCapability: 'wbs:read',
        execute: async () => result(
          { UNBOUND_SECRET_FACT: 903 },
          [{ id: 'unbound', projectId: 'p1', name: 'UNBOUND_SECRET_RECORD' }],
          [],
        ),
      },
    ]
    let synthesizedEvidence = ''
    let failedTools: string[] = []
    const events: ChatStreamEvent[] = []
    for await (const item of orchestrateChatV2(
      { projectId: 'p1', message: 'WBS 확인', history: [] },
      {
        requestId: base.requestId,
        registry: createChatToolRegistry(tools),
        now: new Date('2026-07-19T00:00:00.000Z'),
        context: {
          userId: 'u1', role: null, teamId: null, capabilities: ['wbs:read'], allowedProjectIds: ['p1'],
          pageContext: null, now: '2026-07-19T00:00:00.000Z', timezone: 'Asia/Seoul',
        },
        route: {
          kind: 'tools', domains: ['wbs'], reason: 'safety regression', statusMessage: '조회 중',
          calls: [
            { id: 'safe', tool: 'find_wbs_items', domain: 'wbs', args: { projectId: 'p1' } },
            { id: 'cross', tool: 'get_wbs_item_detail', domain: 'wbs', args: { projectId: 'p1' } },
            { id: 'invalid', tool: 'get_wbs_change_log', domain: 'wbs', args: { projectId: 'p1' } },
            { id: 'unbound', tool: 'list_wbs_attachments', domain: 'wbs', args: { projectId: 'p1' } },
          ],
        },
        synthesize: async input => {
          synthesizedEvidence = JSON.stringify(input.evidence)
          failedTools = input.failedTools
          return null
        },
      },
    )) events.push(item)

    const serializedEvents = JSON.stringify(events)
    expect(synthesizedEvidence).toContain('SAFE_RECORD')
    expect(failedTools).toEqual(['get_wbs_item_detail', 'get_wbs_change_log', 'list_wbs_attachments'])
    for (const secret of ['CROSS_PROJECT_SECRET', 'INVALID_SOURCE_SECRET', 'UNBOUND_SECRET']) {
      expect(synthesizedEvidence).not.toContain(secret)
      expect(serializedEvents).not.toContain(secret)
    }
    expect(events.find(item => item.type === 'sources')).toMatchObject({
      type: 'sources', items: [expect.objectContaining({ entityId: 'safe', projectId: 'p1' })],
    })
    expect(events.at(-1)).toMatchObject({ type: 'done', tools: ['find_wbs_items'] })
  })

  it('replaces a fabricated synthesis with the deterministic answer end to end', async () => {
    // 리뷰 L-9: 존재하지 않는 출처 + 근거 없는 수치를 합성기가 지어내면
    // 검증기가 전체를 기각하고 결정형 답변으로 종단(done)하는 경로를 고정한다.
    const result = {
      status: 'ok' as const, facts: { returned: 1 }, records: [{ id: 'a', name: '설계' }],
      sources: [{
        id: 'wbs:a', domain: 'wbs' as const, entityType: 'wbs_item' as const, entityId: 'a',
        projectId: 'p1', title: '설계', href: '/p/p1/wbs?focus=a', updatedAt: null,
      }],
      asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
    }
    const tool: ReadOnlyBotTool = {
      name: 'find_wbs_items', requiredCapability: 'wbs:read',
      execute: async () => ({ ok: true, result }),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const events: ChatStreamEvent[] = []
      for await (const item of orchestrateChatV2(
        { projectId: 'p1', message: '설계 작업 알려줘', history: [] },
        {
          requestId: base.requestId,
          registry: createChatToolRegistry([tool]),
          now: new Date('2026-07-19T00:00:00.000Z'),
          context: {
            userId: 'u1', role: null, teamId: null, capabilities: ['wbs:read'], allowedProjectIds: ['p1'],
            pageContext: null, now: '2026-07-19T00:00:00.000Z', timezone: 'Asia/Seoul',
          },
          route: {
            kind: 'tools', domains: ['wbs'], reason: 'fabrication regression', statusMessage: '조회 중',
            calls: [{ id: 'c1', tool: 'find_wbs_items', domain: 'wbs', args: { projectId: 'p1' } }],
          },
          synthesize: async () => '가짜 응답 999건 [S9]',
        },
      )) events.push(item)

      const text = events.filter(item => item.type === 'delta')
        .map(item => item.type === 'delta' ? item.text : '').join('')
      const expected = deterministicEvidenceAnswer(
        buildEvidencePack([{ callId: 'c1', tool: 'find_wbs_items', result }]),
      )
      expect(text).toBe(expected)
      expect(text).not.toContain('999')
      expect(text).not.toContain('[S9]')
      expect(events.at(-1)).toMatchObject({ type: 'done', tools: ['find_wbs_items'] })
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('합성 검증 실패'),
        expect.stringContaining('존재하지 않는 출처 인용'),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('uses deterministic evidence by default and only calls the configured LLM with explicit opt-in', async () => {
    const tool: ReadOnlyBotTool = {
      name: 'find_wbs_items', requiredCapability: 'wbs:read',
      execute: async () => ({
        ok: true,
        result: {
          status: 'ok', facts: {}, records: [{ id: 'a', projectId: 'p1', name: '설계' }],
          sources: [{
            id: 'wbs:a', domain: 'wbs', entityType: 'wbs_item', entityId: 'a',
            projectId: 'p1', title: '설계', href: '/p/p1/wbs?focus=a', updatedAt: null,
          }],
          asOf: '2026-07-19T00:00:00.000Z', truncated: false, warnings: [],
        },
      }),
    }
    const run = async (request: Parameters<typeof orchestrateChatV2>[0]) => {
      const events: ChatStreamEvent[] = []
      for await (const item of orchestrateChatV2(request, {
        requestId: base.requestId,
        registry: createChatToolRegistry([tool]),
        now: new Date('2026-07-19T00:00:00.000Z'),
        context: {
          userId: 'u1', role: null, teamId: null, capabilities: ['wbs:read'], allowedProjectIds: ['p1'],
          pageContext: null, now: '2026-07-19T00:00:00.000Z', timezone: 'Asia/Seoul',
        },
        route: {
          kind: 'tools', domains: ['wbs'], reason: 'synthesis regression', statusMessage: '조회 중',
          calls: [{ id: 'c1', tool: 'find_wbs_items', domain: 'wbs', args: { projectId: 'p1' } }],
        },
      })) events.push(item)
      return events
    }

    vi.stubEnv('CHAT_V2_LLM_SYNTHESIS_ENABLED', 'false')
    const deterministic = await run({ projectId: 'p1', message: '설계 설명', history: [] })
    expect(generateAnswer).not.toHaveBeenCalled()
    expect(deterministic.filter(item => item.type === 'delta')
      .map(item => item.type === 'delta' ? item.text : '').join('')).toContain('작업명: 설계')

    vi.stubEnv('CHAT_V2_LLM_SYNTHESIS_ENABLED', 'true')
    vi.mocked(generateAnswer).mockResolvedValueOnce('LLM이 정리한 설계입니다. [S1]')
    const synthesized = await run({
      projectId: 'p1',
      message: '설계 설명',
      history: [
        { role: 'assistant', content: '이전 결과 [S1] 작업 A [S999]' },
        { role: 'user', content: '그 작업을 다시 설명해줘 [S2]' },
      ],
    })
    expect(generateAnswer).toHaveBeenCalledOnce()
    const messages = vi.mocked(generateAnswer).mock.calls[0][1]
    expect(messages).toEqual([
      { role: 'assistant', content: '이전 결과 작업 A' },
      { role: 'user', content: '그 작업을 다시 설명해줘' },
      { role: 'user', content: '설계 설명' },
    ])
    expect(messages.slice(0, -1).every(message => !/\[S\d+]/.test(message.content))).toBe(true)
    expect(synthesized.filter(item => item.type === 'delta')
      .map(item => item.type === 'delta' ? item.text : '').join('')).toBe('LLM이 정리한 설계입니다. [S1]')
  })
})
