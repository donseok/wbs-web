// 골든 질문셋 데이터 주도 실행기(설계 §17.1). 케이스마다:
//  1) createFakeRepositories(+실패 주입) → 실제 도구 팩토리로 registry 구성(default-registry 배선 미러,
//     단 settings indexStatus 미주입)
//  2) routeChatRequest 로 routeKind 단언
//  3) orchestrateChatV2 이벤트 수집(LLM 합성 없음) → done.tools 정확 일치·argsSubset 부분 일치·
//     delta 결합 문자열 includes/excludes·sources href prefix·terminal 이벤트 정확히 1개
// 실제 DB·네트워크·LLM 접근 없음. 전체 실행 5초 이내(단일 파일).
import { describe, expect, it } from 'vitest'
import {
  orchestrateChatV2,
  type ChatOrchestratorDependencies,
} from '@/lib/ai/chat/orchestrator'
import { routeChatRequest } from '@/lib/ai/chat/router'
import { createChatToolRegistry, type ChatTool, type ChatToolExecutionContext } from '@/lib/ai/chat/registry'
import type { ChatStreamEvent } from '@/lib/ai/chat/protocol'
import { BOT_READ_CAPABILITIES } from '@/lib/ai/tools/types'
import {
  createCompareWeeklySheetsTool,
  createFindWbsItemsTool,
  createGetAttendanceTool,
  createGetKanbanViewTool,
  createGetMeetingDetailTool,
  createGetMemberWorkloadTool,
  createGetMinuteDetailTool,
  createGetProjectDashboardTool,
  createGetSafeProjectSettingsTool,
  createGetWbsChangeLogTool,
  createGetWbsDependenciesTool,
  createGetWbsItemDetailTool,
  createGetWeeklySheetTool,
  createListAnnouncementsTool,
  createListMeetingsTool,
  createListMembersTool,
  createListMyMeetingsTool,
  createListWbsAttachmentsTool,
  createSearchAnnouncementsTool,
  createSearchMinutesTool,
} from '@/lib/ai/tools'
import { createFakeRepositories, type FakeRepositoryOptions } from './fake-repositories'
import { ALLOWED_PROJECT_IDS, NOW } from './fixtures'
import { GOLDEN_CASES } from './cases'

// default-registry.ts 의 도구 배선을 미러한다 — 단, settings 는 dkbotIndexStatus 프로브를 주입하지 않아
// 색인 facts 를 생략(색인 상태 케이스가 이를 검증한다).
function buildRegistry(options: FakeRepositoryOptions) {
  const repos = createFakeRepositories(options)
  const tools: ChatTool[] = [
    createFindWbsItemsTool(repos.wbs),
    createGetWbsItemDetailTool(repos.wbs),
    createGetWbsDependenciesTool(repos.wbs),
    createGetWbsChangeLogTool(repos.wbs),
    createListWbsAttachmentsTool(repos.wbs),
    createGetWeeklySheetTool(repos.weekly),
    createCompareWeeklySheetsTool(repos.weekly),
    createListMeetingsTool(repos.meetings),
    createGetMeetingDetailTool(repos.meetings),
    createListMyMeetingsTool(repos.meetings),
    createGetAttendanceTool(repos.attendance),
    createListAnnouncementsTool(repos.announcements),
    createSearchAnnouncementsTool(repos.announcements),
    createSearchMinutesTool(repos.minutes),
    createGetMinuteDetailTool(repos.minutes),
    createGetKanbanViewTool(repos.wbs),
    createGetProjectDashboardTool(repos.wbs, repos.meetings),
    createListMembersTool(repos.members),
    createGetMemberWorkloadTool(repos.members, repos.wbs),
    createGetSafeProjectSettingsTool(repos.settings),
  ]
  return createChatToolRegistry(tools)
}

async function collect(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = []
  for await (const event of events) out.push(event)
  return out
}

const NOW_DATE = new Date(NOW)

function contextFor(pageContext: ChatToolExecutionContext['pageContext']): ChatToolExecutionContext {
  return {
    userId: 'user-alpha-1',
    role: 'pmo_admin',
    teamId: 'a-team',
    capabilities: [...BOT_READ_CAPABILITIES],
    allowedProjectIds: [...ALLOWED_PROJECT_IDS],
    pageContext: pageContext ?? null,
    now: NOW,
    timezone: 'Asia/Seoul',
  }
}

describe('golden question set', () => {
  it('has at least 110 cases with unique names', () => {
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(110)
    expect(new Set(GOLDEN_CASES.map(c => c.name)).size).toBe(GOLDEN_CASES.length)
  })

  it('runs deterministically without LLM synthesis enabled', () => {
    // 합성 플래그가 켜져 있으면 결정형 답변 대신 LLM 경로가 타 delta 검증이 흔들린다.
    expect(process.env.CHAT_V2_LLM_SYNTHESIS_ENABLED).not.toBe('true')
  })

  it.each(GOLDEN_CASES)('$menu · $name', async testCase => {
    const registry = buildRegistry({ fail: testCase.inject?.failRepository })
    const route = routeChatRequest(testCase.request, NOW_DATE)
    expect(route.kind, 'routeKind').toBe(testCase.expect.routeKind)

    const deps: ChatOrchestratorDependencies = {
      requestId: 'req-golden',
      registry,
      context: contextFor(testCase.request.pageContext ?? null),
      now: NOW_DATE,
      route,
    }
    const events = await collect(orchestrateChatV2(testCase.request, deps))

    // terminal 이벤트는 정확히 1개이며 스트림 마지막이다.
    const terminals = events.filter(event => event.type === 'done' || event.type === 'error')
    expect(terminals, 'terminal count').toHaveLength(1)
    expect(events.at(-1)).toBe(terminals[0])
    const terminal = terminals[0]

    if (testCase.expect.errorCode) {
      expect(terminal.type, 'terminal is error').toBe('error')
      if (terminal.type === 'error') expect(terminal.code).toBe(testCase.expect.errorCode)
    } else if (route.kind === 'tools') {
      expect(terminal.type, 'terminal is done').toBe('done')
    }

    if (testCase.expect.tools && terminal.type === 'done') {
      expect([...terminal.tools].sort()).toEqual([...testCase.expect.tools].sort())
    }

    if (testCase.expect.argsSubset) {
      expect(route.kind).toBe('tools')
      for (const [tool, sub] of Object.entries(testCase.expect.argsSubset)) {
        const call = route.kind === 'tools' ? route.calls.find(c => c.tool === tool) : undefined
        expect(call, `route call for ${tool}`).toBeTruthy()
        for (const [key, value] of Object.entries(sub)) {
          expect(call!.args[key], `${tool}.${key}`).toEqual(value)
        }
      }
    }

    const answer = events
      .filter((event): event is Extract<ChatStreamEvent, { type: 'delta' }> => event.type === 'delta')
      .map(event => event.text)
      .join('')
    for (const needle of testCase.expect.deltaIncludes ?? []) {
      expect(answer, `delta includes "${needle}"`).toContain(needle)
    }
    for (const needle of testCase.expect.deltaExcludes ?? []) {
      expect(answer, `delta excludes "${needle}"`).not.toContain(needle)
    }

    if (testCase.expect.sourceHrefPrefixes) {
      const sources = events.find(
        (event): event is Extract<ChatStreamEvent, { type: 'sources' }> => event.type === 'sources',
      )
      const items = sources?.items ?? []
      expect(items.length, 'sources present').toBeGreaterThan(0)
      for (const item of items) {
        const matched = testCase.expect.sourceHrefPrefixes.some(prefix => item.href.startsWith(prefix))
        expect(matched, `source href "${item.href}" starts with an allowed prefix`).toBe(true)
      }
    }
  })
})
