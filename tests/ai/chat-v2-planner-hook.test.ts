import { describe, expect, it } from 'vitest'
import { orchestrateChatV2 } from '@/lib/ai/chat/orchestrator'
import type { ToolPlan } from '@/lib/ai/chat/planner'
import type { ChatStreamEvent } from '@/lib/ai/chat/protocol'
import { createChatToolRegistry, type ChatToolExecutionContext } from '@/lib/ai/chat/registry'
import type { ReadOnlyBotTool, ToolResult } from '@/lib/ai/tools/types'

const CONTEXT: ChatToolExecutionContext = {
  userId: 'u1',
  role: null,
  teamId: null,
  capabilities: ['wbs:read', 'meetings:read', 'attendance:read'],
  allowedProjectIds: ['p1'],
  pageContext: null,
  now: '2026-07-19T09:00:00.000Z',
  timezone: 'Asia/Seoul',
}

function toolResult(partial: Partial<ToolResult<unknown>>): ToolResult<unknown> {
  return {
    status: 'ok', facts: {}, records: [], sources: [], asOf: CONTEXT.now,
    truncated: false, warnings: [], ...partial,
  }
}

function fakeTool(
  name: ReadOnlyBotTool['name'],
  capability: ReadOnlyBotTool['requiredCapability'],
  handler: (args: unknown) => ToolResult<unknown>,
  calls: unknown[],
): ReadOnlyBotTool {
  return {
    name,
    requiredCapability: capability,
    async execute(args) {
      calls.push(args)
      return { ok: true, result: handler(args) }
    },
  }
}

async function collect(events: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = []
  for await (const item of events) out.push(item)
  return out
}

const REQUEST = { projectId: 'p1', message: '내일 회의 참석자 작업 상황', history: [] }

describe('chat v2 planner hook — 검증된 플랜 실행', () => {
  it('runs a two-stage plan and feeds stage-1 record ids into stage-2 bindings', async () => {
    const meetingCalls: unknown[] = []
    const wbsCalls: unknown[] = []
    const registry = createChatToolRegistry([
      fakeTool('list_meetings', 'meetings:read', () => toolResult({
        records: [{ id: 'item-9', title: '주간회의' }],
        sources: [{
          id: 'meeting:m1', domain: 'meetings', entityType: 'meeting', entityId: 'm1',
          projectId: 'p1', title: '주간회의', href: '/p/p1/meetings?focus=m1', updatedAt: null,
        }],
        facts: { total: 1 },
      }), meetingCalls),
      fakeTool('get_wbs_item_detail', 'wbs:read', () => toolResult({
        records: [{ id: 'item-9', name: '통합 테스트' }],
        sources: [{
          id: 'wbs:item-9', domain: 'wbs', entityType: 'wbs_item', entityId: 'item-9',
          projectId: 'p1', title: '통합 테스트', href: '/p/p1/wbs?focus=item-9', updatedAt: null,
        }],
      }), wbsCalls),
    ])
    const plan: ToolPlan = {
      reason: '회의와 작업 상세 결합',
      needsClarification: false,
      stages: [
        { calls: [{ id: 'c1', tool: 'list_meetings', args: { projectId: 'p1', from: '2026-07-20', to: '2026-07-20', limit: 50 } }] },
        {
          calls: [{
            id: 'c2', tool: 'get_wbs_item_detail', args: { projectId: 'p1' },
            bindings: { itemId: { fromCall: 'c1', resultPath: 'records[0].id' } },
          }],
        },
      ],
    }
    const events = await collect(orchestrateChatV2(REQUEST, {
      requestId: 'req_test', registry, context: CONTEXT, plan, now: new Date(CONTEXT.now),
    }))
    const done = events.find(e => e.type === 'done')
    expect(done).toMatchObject({ tools: ['list_meetings', 'get_wbs_item_detail'] })
    expect(wbsCalls[0]).toMatchObject({ projectId: 'p1', itemId: 'item-9' })
    const terminal = events.filter(e => e.type === 'done' || e.type === 'error')
    expect(terminal).toHaveLength(1)
  })

  it('skips a stage-2 call when its binding source produced no rows', async () => {
    const wbsCalls: unknown[] = []
    const registry = createChatToolRegistry([
      fakeTool('list_meetings', 'meetings:read', () => toolResult({ records: [] }), []),
      fakeTool('get_wbs_item_detail', 'wbs:read', () => toolResult({}), wbsCalls),
    ])
    const plan: ToolPlan = {
      reason: 'empty binding',
      needsClarification: false,
      stages: [
        { calls: [{ id: 'c1', tool: 'list_meetings', args: { projectId: 'p1', from: '2026-07-20', to: '2026-07-20' } }] },
        {
          calls: [{
            id: 'c2', tool: 'get_wbs_item_detail', args: { projectId: 'p1' },
            bindings: { itemId: { fromCall: 'c1', resultPath: 'records[*].id' } },
          }],
        },
      ],
    }
    const events = await collect(orchestrateChatV2(REQUEST, {
      requestId: 'req_test', registry, context: CONTEXT, plan, now: new Date(CONTEXT.now),
    }))
    expect(wbsCalls).toHaveLength(0)
    expect(events.find(e => e.type === 'done')).toMatchObject({ tools: ['list_meetings'] })
  })

  it('rejects a bound projectId outside the server-resolved allowlist', async () => {
    const wbsCalls: unknown[] = []
    const registry = createChatToolRegistry([
      fakeTool('list_meetings', 'meetings:read', () => toolResult({
        // 악의적/오염된 상류 레코드가 다른 프로젝트 ID를 흘려도 stage 2로 전파되면 안 된다.
        records: [{ id: 'p2' }],
        sources: [{
          id: 'meeting:m1', domain: 'meetings', entityType: 'meeting', entityId: 'm1',
          projectId: 'p1', title: '주간회의', href: '/p/p1/meetings?focus=m1', updatedAt: null,
        }],
      }), []),
      fakeTool('get_wbs_item_detail', 'wbs:read', () => toolResult({}), wbsCalls),
    ])
    const plan: ToolPlan = {
      reason: 'scope escape attempt',
      needsClarification: false,
      stages: [
        { calls: [{ id: 'c1', tool: 'list_meetings', args: { projectId: 'p1', from: '2026-07-20', to: '2026-07-20' } }] },
        {
          calls: [{
            id: 'c2', tool: 'get_wbs_item_detail', args: { itemId: 'item-1' },
            bindings: { projectId: { fromCall: 'c1', resultPath: 'records[0].id' } },
          }],
        },
      ],
    }
    const events = await collect(orchestrateChatV2(REQUEST, {
      requestId: 'req_test', registry, context: CONTEXT, plan, now: new Date(CONTEXT.now),
    }))
    expect(wbsCalls).toHaveLength(0)
    const deltas = events.filter(e => e.type === 'delta').map(e => (e as { text: string }).text).join('')
    expect(deltas).toContain('일부 데이터는 확인하지 못해')
  })

  it('streams the clarification and stops when the plan asks for one', async () => {
    const registry = createChatToolRegistry([])
    const plan: ToolPlan = {
      reason: 'ambiguous', needsClarification: true, clarification: '어느 프로젝트의 회의인가요?', stages: [],
    }
    const events = await collect(orchestrateChatV2(REQUEST, {
      requestId: 'req_test', registry, context: CONTEXT, plan, now: new Date(CONTEXT.now),
    }))
    const deltas = events.filter(e => e.type === 'delta').map(e => (e as { text: string }).text).join('')
    expect(deltas).toBe('어느 프로젝트의 회의인가요?')
    expect(events.find(e => e.type === 'done')).toMatchObject({ tools: [] })
  })
})
