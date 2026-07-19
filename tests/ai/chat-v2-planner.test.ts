import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateAnswer } from '@/lib/ai/llm'
import {
  PLANNER_TOOL_CATALOG,
  parseToolPlanJson,
  planWithConfiguredLlm,
  resolveBindings,
  shouldAttemptPlan,
  validateToolPlan,
  type ToolPlanCall,
} from '@/lib/ai/chat/planner'
import type { SuccessfulToolEvidence } from '@/lib/ai/chat/evidence'
import type { ChatRequestV2 } from '@/lib/ai/chat/protocol'

vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn() }))

const ALL_TOOLS = Object.keys(PLANNER_TOOL_CATALOG)
const OPTIONS = { allowedTools: ALL_TOOLS, allowedProjectIds: ['p1', 'p2'] }

/** 검증 대상은 unknown이므로 픽스처는 자유롭게 변형 가능한 느슨한 형태로 둔다. */
interface LoosePlan {
  reason: string
  needsClarification: boolean
  clarification?: string
  stages: Array<{
    calls: Array<{
      id: string
      tool: string
      args: Record<string, unknown>
      bindings?: Record<string, { fromCall: string; resultPath: string }>
    }>
  }>
}

function twoStagePlan(): LoosePlan {
  return {
    reason: '지연 작업을 찾은 뒤 첫 작업의 상세를 본다',
    needsClarification: false,
    stages: [
      {
        calls: [
          { id: 'c1', tool: 'find_wbs_items', args: { projectId: 'p1', status: 'delayed', limit: 50 } },
        ],
      },
      {
        calls: [
          {
            id: 'c2',
            tool: 'get_wbs_item_detail',
            args: { projectId: 'p1' },
            bindings: { itemId: { fromCall: 'c1', resultPath: 'records[0].id' } },
          },
        ],
      },
    ],
  }
}

function evidenceOf(callId: string, records: unknown[]): SuccessfulToolEvidence {
  return {
    callId,
    tool: 'find_wbs_items',
    result: {
      status: 'ok',
      facts: {},
      records,
      sources: [],
      asOf: '2026-07-19T00:00:00.000Z',
      truncated: false,
      warnings: [],
    },
  }
}

function boundCall(overrides: Partial<ToolPlanCall> = {}): ToolPlanCall {
  return {
    id: 'c2',
    tool: 'get_wbs_item_detail',
    args: { projectId: 'p1' },
    bindings: { itemId: { fromCall: 'c1', resultPath: 'records[0].id' } },
    ...overrides,
  }
}

describe('parseToolPlanJson', () => {
  it('parses a fenced json block with surrounding prose', () => {
    const text = '계획은 다음과 같습니다.\n```json\n{"reason":"r","needsClarification":false,"stages":[]}\n```\n이상입니다.'
    expect(parseToolPlanJson(text)).toEqual({ reason: 'r', needsClarification: false, stages: [] })
  })

  it('returns only the first top-level object and tolerates braces inside strings', () => {
    const text = '{"reason":"중괄호 { 포함 \\" 문자열","needsClarification":true} {"second":1}'
    expect(parseToolPlanJson(text)).toEqual({ reason: '중괄호 { 포함 " 문자열', needsClarification: true })
  })

  it('returns null when there is no object or the object is malformed', () => {
    expect(parseToolPlanJson('JSON 없음')).toBeNull()
    expect(parseToolPlanJson('{"broken": }')).toBeNull()
    expect(parseToolPlanJson('{"never": "closed"')).toBeNull()
  })
})

describe('validateToolPlan', () => {
  it('accepts a two-stage plan with a stage-two binding', () => {
    const result = validateToolPlan(twoStagePlan(), OPTIONS)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.plan.stages).toHaveLength(2)
    expect(result.plan.stages[1].calls[0].bindings).toEqual({
      itemId: { fromCall: 'c1', resultPath: 'records[0].id' },
    })
  })

  it('maps null raw input to PLAN_PARSE_FAILED', () => {
    expect(validateToolPlan(null, OPTIONS)).toEqual({ ok: false, code: 'PLAN_PARSE_FAILED' })
    expect(validateToolPlan(undefined, OPTIONS)).toEqual({ ok: false, code: 'PLAN_PARSE_FAILED' })
  })

  it('rejects more than two stages or more than four total calls', () => {
    const threeStages = twoStagePlan()
    threeStages.stages.push({ calls: [{ id: 'c9', tool: 'get_project_dashboard', args: { projectId: 'p1' } }] })
    expect(validateToolPlan(threeStages, OPTIONS)).toEqual({ ok: false, code: 'PLAN_LIMITS_EXCEEDED' })

    const fiveCalls = twoStagePlan()
    fiveCalls.stages[0].calls = ['a', 'b', 'c', 'd'].map(id => ({
      id, tool: 'find_wbs_items', args: { projectId: 'p1' },
    }))
    expect(validateToolPlan(fiveCalls, OPTIONS)).toEqual({ ok: false, code: 'PLAN_LIMITS_EXCEEDED' })
  })

  it('rejects an empty stage and duplicate or malformed call ids', () => {
    const emptyStage = twoStagePlan()
    emptyStage.stages[1].calls = []
    expect(validateToolPlan(emptyStage, OPTIONS)).toEqual({ ok: false, code: 'PLAN_SCHEMA_INVALID' })

    const duplicateId = twoStagePlan()
    duplicateId.stages[1].calls[0].id = 'c1'
    expect(validateToolPlan(duplicateId, OPTIONS)).toEqual({ ok: false, code: 'PLAN_SCHEMA_INVALID' })

    const badId = twoStagePlan()
    badId.stages[0].calls[0].id = '호출#1'
    expect(validateToolPlan(badId, OPTIONS)).toEqual({ ok: false, code: 'PLAN_SCHEMA_INVALID' })
  })

  it('rejects tools outside the allow list even when they exist in the catalog', () => {
    const plan = twoStagePlan()
    const withoutFind = { ...OPTIONS, allowedTools: ALL_TOOLS.filter(tool => tool !== 'find_wbs_items') }
    expect(validateToolPlan(plan, withoutFind)).toEqual({ ok: false, code: 'PLAN_TOOL_NOT_ALLOWED' })

    const unknownTool = twoStagePlan()
    unknownTool.stages[0].calls[0].tool = 'run_sql'
    const withUnknown = { ...OPTIONS, allowedTools: [...ALL_TOOLS, 'run_sql'] }
    expect(validateToolPlan(unknownTool, withUnknown)).toEqual({ ok: false, code: 'PLAN_TOOL_NOT_ALLOWED' })
  })

  it('rejects argument keys outside the per-tool whitelist', () => {
    const plan = twoStagePlan()
    plan.stages[0].calls[0].args = { projectId: 'p1', sql: 'select 1' }
    expect(validateToolPlan(plan, OPTIONS)).toEqual({ ok: false, code: 'PLAN_SCHEMA_INVALID' })
  })

  it('rejects cross-project and non-string projectId as PLAN_SCOPE_INVALID', () => {
    const crossProject = twoStagePlan()
    crossProject.stages[0].calls[0].args.projectId = 'p9'
    expect(validateToolPlan(crossProject, OPTIONS)).toEqual({ ok: false, code: 'PLAN_SCOPE_INVALID' })

    const numericProject = twoStagePlan()
    numericProject.stages[0].calls[0].args.projectId = 42
    expect(validateToolPlan(numericProject, OPTIONS)).toEqual({ ok: false, code: 'PLAN_SCOPE_INVALID' })
  })

  it('requires projectId (value or binding) for project-scoped tools only', () => {
    const missing = twoStagePlan()
    missing.stages[0].calls[0].args = { status: 'delayed' }
    expect(validateToolPlan(missing, OPTIONS)).toEqual({ ok: false, code: 'PLAN_SCHEMA_INVALID' })

    const globalSearch = {
      reason: '전역 회의록 검색',
      needsClarification: false,
      stages: [{ calls: [{ id: 'c1', tool: 'search_minutes', args: { query: '보안', limit: 50 } }] }],
    }
    expect(validateToolPlan(globalSearch, OPTIONS)).toMatchObject({ ok: true })

    const boundProject = twoStagePlan()
    boundProject.stages[1].calls[0] = {
      id: 'c2',
      tool: 'get_project_dashboard',
      args: {},
      bindings: { projectId: { fromCall: 'c1', resultPath: 'records[0].projectId' } },
    }
    expect(validateToolPlan(boundProject, OPTIONS)).toMatchObject({ ok: true })
  })

  it('allows bindings only in stage two and only against stage-one call ids', () => {
    const stageOneBinding = twoStagePlan()
    stageOneBinding.stages[0].calls[0] = {
      id: 'c1',
      tool: 'get_wbs_item_detail',
      args: { projectId: 'p1' },
      bindings: { itemId: { fromCall: 'c0', resultPath: 'records[0].id' } },
    }
    expect(validateToolPlan(stageOneBinding, OPTIONS)).toEqual({ ok: false, code: 'PLAN_BINDING_INVALID' })

    const siblingReference = twoStagePlan()
    siblingReference.stages[1].calls[0].bindings = {
      itemId: { fromCall: 'c2', resultPath: 'records[0].id' },
    }
    expect(validateToolPlan(siblingReference, OPTIONS)).toEqual({ ok: false, code: 'PLAN_BINDING_INVALID' })
  })

  it('rejects resultPath syntax outside records[0|*].field', () => {
    for (const resultPath of ['records[1].id', 'records[*].id.name', 'facts.total', 'records[0]._proto', 'records[0].' ]) {
      const plan = twoStagePlan()
      plan.stages[1].calls[0].bindings = { itemId: { fromCall: 'c1', resultPath } }
      expect(validateToolPlan(plan, OPTIONS)).toEqual({ ok: false, code: 'PLAN_BINDING_INVALID' })
    }
  })

  it('rejects bindings whose target key is outside the single-value contract', () => {
    const plan = twoStagePlan()
    plan.stages[1].calls[0] = {
      id: 'c2',
      tool: 'get_weekly_sheet',
      args: { projectId: 'p1', weekStart: '2026-07-13' },
      bindings: { team: { fromCall: 'c1', resultPath: 'records[0].team' } },
    }
    expect(validateToolPlan(plan, OPTIONS)).toEqual({ ok: false, code: 'PLAN_BINDING_INVALID' })

    const unknownKey = twoStagePlan()
    unknownKey.stages[1].calls[0].bindings = { minuteId: { fromCall: 'c1', resultPath: 'records[0].id' } }
    expect(validateToolPlan(unknownKey, OPTIONS)).toEqual({ ok: false, code: 'PLAN_SCHEMA_INVALID' })
  })

  it('accepts a clarification plan and skips stage validation', () => {
    const result = validateToolPlan({
      reason: '대상 모호',
      needsClarification: true,
      clarification: '어느 프로젝트의 지연 작업을 볼까요?',
      stages: '검증 생략 대상 잡음',
    }, OPTIONS)
    expect(result).toEqual({
      ok: true,
      plan: {
        reason: '대상 모호',
        stages: [],
        needsClarification: true,
        clarification: '어느 프로젝트의 지연 작업을 볼까요?',
      },
    })
  })

  it('rejects a clarification plan without text or with over-limit text', () => {
    expect(validateToolPlan({ reason: 'r', needsClarification: true }, OPTIONS))
      .toEqual({ ok: false, code: 'PLAN_SCHEMA_INVALID' })
    expect(validateToolPlan({ reason: 'r', needsClarification: true, clarification: '가'.repeat(301) }, OPTIONS))
      .toEqual({ ok: false, code: 'PLAN_SCHEMA_INVALID' })
  })
})

describe('resolveBindings', () => {
  it('binds records[0].field to the first record and keeps literal args', () => {
    const result = resolveBindings(boundCall(), [evidenceOf('c1', [{ id: 'item-1' }, { id: 'item-2' }])])
    expect(result).toEqual({ ok: true, args: { projectId: 'p1', itemId: 'item-1' } })
  })

  it('deduplicates records[*] values and passes only the first for a single-value key', () => {
    const call = boundCall({
      bindings: { itemId: { fromCall: 'c1', resultPath: 'records[*].id' } },
    })
    const result = resolveBindings(call, [
      evidenceOf('c1', [{ id: 'dup' }, { id: 'dup' }, { id: 'other' }, { name: 'id 없음' }]),
    ])
    expect(result).toEqual({ ok: true, args: { projectId: 'p1', itemId: 'dup' } })
  })

  it('accepts ISO date values for date-shaped bindings', () => {
    const call = boundCall({
      tool: 'get_meeting_detail',
      args: { projectId: 'p1', meetingId: 'm1' },
      bindings: { occurrenceDate: { fromCall: 'c1', resultPath: 'records[0].occurrenceDate' } },
    })
    const result = resolveBindings(call, [evidenceOf('c1', [{ occurrenceDate: '2026-07-19' }])])
    expect(result).toEqual({ ok: true, args: { projectId: 'p1', meetingId: 'm1', occurrenceDate: '2026-07-19' } })
  })

  it('fails with BINDING_SOURCE_MISSING when the referenced call has no evidence', () => {
    expect(resolveBindings(boundCall(), [evidenceOf('c9', [{ id: 'item-1' }])]))
      .toEqual({ ok: false, code: 'BINDING_SOURCE_MISSING' })
  })

  it('fails with BINDING_VALUE_INVALID for non-string or malformed values anywhere in the mapping', () => {
    expect(resolveBindings(boundCall(), [evidenceOf('c1', [{ id: 123 }])]))
      .toEqual({ ok: false, code: 'BINDING_VALUE_INVALID' })
    expect(resolveBindings(boundCall(), [evidenceOf('c1', [{ id: '공백 포함 값' }])]))
      .toEqual({ ok: false, code: 'BINDING_VALUE_INVALID' })

    const wildcard = boundCall({ bindings: { itemId: { fromCall: 'c1', resultPath: 'records[*].id' } } })
    expect(resolveBindings(wildcard, [evidenceOf('c1', [{ id: 'ok-1' }, { id: '2026/07/19' }])]))
      .toEqual({ ok: false, code: 'BINDING_VALUE_INVALID' })
  })

  it('fails with BINDING_EMPTY when no value can be extracted', () => {
    expect(resolveBindings(boundCall(), [evidenceOf('c1', [])]))
      .toEqual({ ok: false, code: 'BINDING_EMPTY' })
    expect(resolveBindings(boundCall(), [evidenceOf('c1', [{ name: 'id 필드 없음' }])]))
      .toEqual({ ok: false, code: 'BINDING_EMPTY' })
  })

  it('defensively rejects a non-single-value target key at resolve time', () => {
    const call = boundCall({ bindings: { team: { fromCall: 'c1', resultPath: 'records[0].team' } } })
    expect(resolveBindings(call, [evidenceOf('c1', [{ team: 'PMO' }])]))
      .toEqual({ ok: false, code: 'BINDING_PATH_INVALID' })
  })

  it('passes through untouched when the call has no bindings', () => {
    const call: ToolPlanCall = { id: 'c1', tool: 'get_project_dashboard', args: { projectId: 'p1' } }
    expect(resolveBindings(call, [])).toEqual({ ok: true, args: { projectId: 'p1' } })
  })
})

describe('shouldAttemptPlan', () => {
  it('plans only for multi-domain questions or unsupported pages without explicit domains', () => {
    expect(shouldAttemptPlan({ explicitDomainCount: 2, pageDomainSupported: true })).toBe(true)
    expect(shouldAttemptPlan({ explicitDomainCount: 3, pageDomainSupported: false })).toBe(true)
    expect(shouldAttemptPlan({ explicitDomainCount: 0, pageDomainSupported: false })).toBe(true)
    expect(shouldAttemptPlan({ explicitDomainCount: 0, pageDomainSupported: true })).toBe(false)
    expect(shouldAttemptPlan({ explicitDomainCount: 1, pageDomainSupported: true })).toBe(false)
    expect(shouldAttemptPlan({ explicitDomainCount: 1, pageDomainSupported: false })).toBe(false)
  })
})

describe('planWithConfiguredLlm', () => {
  const request: ChatRequestV2 = {
    projectId: 'p1',
    message: 'ERP 지연 작업의 첨부파일과 회의록을 같이 알려줘',
    history: Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `이전 대화 ${index + 1}`,
    })),
    pageContext: {
      contextVersion: 1,
      pathname: '/p/p1/wbs',
      domain: 'wbs',
      projectId: 'p1',
      selectedEntity: { type: 'wbs_item', id: 'item-1' },
      range: { from: '2026-07-13', to: '2026-07-19' },
      timezone: 'Asia/Seoul',
    },
  }

  beforeEach(() => {
    vi.mocked(generateAnswer).mockReset()
  })

  it('sends a JSON-only prompt with the allowed tool catalog and returns the parsed plan', async () => {
    vi.mocked(generateAnswer).mockResolvedValue(
      '```json\n{"reason":"r","needsClarification":true,"clarification":"어떤 작업인가요?"}\n```',
    )
    const result = await planWithConfiguredLlm(request, {
      allowedTools: ['find_wbs_items', 'search_minutes'],
      now: '2026-07-19',
    })
    expect(result).toEqual({ reason: 'r', needsClarification: true, clarification: '어떤 작업인가요?' })

    const [system, messages] = vi.mocked(generateAnswer).mock.calls[0]
    expect(system).toContain('find_wbs_items')
    expect(system).toContain('search_minutes')
    expect(system).not.toContain('get_minute_detail')
    expect(system).toContain('JSON 오브젝트 하나만 출력')
    expect(system).toContain('2026-07-19')

    // 대화 이력은 최근 4개만 + 질문 1개
    expect(messages).toHaveLength(5)
    expect(messages[0]).toEqual({ role: 'user', content: '이전 대화 3' })
    const last = messages.at(-1)
    expect(last?.role).toBe('user')
    expect(last?.content).toContain(request.message)
    expect(last?.content).toContain('- 도메인: wbs')
    expect(last?.content).toContain('- projectId: p1')
    expect(last?.content).toContain('wbs_item item-1')
    expect(last?.content).toContain('2026-07-13 ~ 2026-07-19')
  })

  it('returns null when the llm is unavailable or returns unparseable text', async () => {
    vi.mocked(generateAnswer).mockResolvedValueOnce(null)
    expect(await planWithConfiguredLlm(request, { allowedTools: ALL_TOOLS, now: '2026-07-19' })).toBeNull()

    vi.mocked(generateAnswer).mockResolvedValueOnce('JSON이 아닌 답변입니다.')
    expect(await planWithConfiguredLlm(request, { allowedTools: ALL_TOOLS, now: '2026-07-19' })).toBeNull()
  })
})

describe('plannerDateAnchors — 기간 인자 앵커', () => {
  it('computes KST week anchors around a Sunday correctly', async () => {
    const { plannerDateAnchors } = await import('@/lib/ai/chat/planner')
    // 2026-07-19은 KST 일요일 — 이번 주는 07-13(월)~07-19(일)이어야 한다.
    const anchors = plannerDateAnchors('2026-07-19T09:00:00.000Z')
    expect(anchors.today).toBe('2026-07-19')
    expect(anchors.thisWeek).toEqual({ from: '2026-07-13', to: '2026-07-19' })
    expect(anchors.nextWeek).toEqual({ from: '2026-07-20', to: '2026-07-26' })
    expect(anchors.lastWeek).toEqual({ from: '2026-07-06', to: '2026-07-12' })
  })

  it('rolls today forward across the KST midnight boundary', async () => {
    const { plannerDateAnchors } = await import('@/lib/ai/chat/planner')
    // UTC 15:30 = KST 다음날 00:30
    const anchors = plannerDateAnchors('2026-07-19T15:30:00.000Z')
    expect(anchors.today).toBe('2026-07-20')
    expect(anchors.thisWeek).toEqual({ from: '2026-07-20', to: '2026-07-26' })
  })
})
