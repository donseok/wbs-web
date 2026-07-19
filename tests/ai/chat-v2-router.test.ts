import { describe, expect, it } from 'vitest'
import { routeChatRequest } from '@/lib/ai/chat/router'
import type { ChatRequestV2, PageContextV1 } from '@/lib/ai/chat/protocol'

const NOW = new Date('2026-07-19T00:00:00.000Z')

function context(domain: PageContextV1['domain'], extra: Partial<PageContextV1> = {}): PageContextV1 {
  return {
    contextVersion: 1,
    pathname: `/p/p1/${domain}`,
    domain,
    projectId: 'p1',
    timezone: 'Asia/Seoul',
    ...extra,
  }
}

function request(message: string, pageContext?: PageContextV1): ChatRequestV2 {
  return { projectId: pageContext?.projectId ?? 'p1', message, history: [], ...(pageContext ? { pageContext } : {}) }
}

describe('chat v2 deterministic router', () => {
  it('lets explicit attendance nouns win over generic status words', () => {
    const route = routeChatRequest(request('근태 현황 알려줘', context('dashboard')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.domains).toEqual(['attendance'])
    expect(route.calls[0].tool).toBe('get_attendance')
  })

  it('routes ERP weekly issues without using the whole question as a search needle', () => {
    const route = routeChatRequest(request('ERP 금주 이슈 정리해줘', context('weekly')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({
      tool: 'get_weekly_sheet',
      args: { projectId: 'p1', weekStart: '2026-07-13', team: 'ERP' },
    })
    expect(route.calls[0].args).not.toHaveProperty('query')
  })

  it('resolves relative meeting dates deterministically', () => {
    const route = routeChatRequest(request('내일 회의 알려줘', context('meetings')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({
      tool: 'list_meetings', args: { from: '2026-07-20', to: '2026-07-20' },
    })
  })

  it('lets explicit relative dates override a page month range', () => {
    const monthly = context('meetings', { range: { from: '2026-07-01', to: '2026-07-31' } })
    const today = routeChatRequest(request('오늘 회의 알려줘', monthly), NOW)
    const thisWeek = routeChatRequest(request('이번 주 회의 알려줘', monthly), NOW)
    expect(today.kind).toBe('tools')
    expect(thisWeek.kind).toBe('tools')
    if (today.kind !== 'tools' || thisWeek.kind !== 'tools') return
    expect(today.calls[0].args).toMatchObject({ from: '2026-07-19', to: '2026-07-19' })
    expect(thisWeek.calls[0].args).toMatchObject({ from: '2026-07-13', to: '2026-07-19' })
  })

  it('parses explicit ISO, Korean dates, and this month before page defaults', () => {
    const monthly = context('meetings', { range: { from: '2026-06-01', to: '2026-06-30' } })
    const iso = routeChatRequest(request('2026-08-03 회의', monthly), NOW)
    const korean = routeChatRequest(request('8월 4일 회의', monthly), NOW)
    const month = routeChatRequest(request('이번 달 회의', monthly), NOW)
    expect(iso.kind).toBe('tools')
    expect(korean.kind).toBe('tools')
    expect(month.kind).toBe('tools')
    if (iso.kind !== 'tools' || korean.kind !== 'tools' || month.kind !== 'tools') return
    expect(iso.calls[0].args).toMatchObject({ from: '2026-08-03', to: '2026-08-03' })
    expect(korean.calls[0].args).toMatchObject({ from: '2026-08-04', to: '2026-08-04' })
    expect(month.calls[0].args).toMatchObject({ from: '2026-07-01', to: '2026-07-31' })
  })

  it('parses explicit ranges, named months, and adjacent relative periods', () => {
    const page = context('meetings', { range: { from: '2026-05-01', to: '2026-05-31' } })
    const range = routeChatRequest(request('8월 3일부터 8월 5일까지 회의', page), NOW)
    const namedMonth = routeChatRequest(request('2026년 8월 회의', page), NOW)
    const priorWeek = routeChatRequest(request('지난주 회의', page), NOW)
    const nextWeek = routeChatRequest(request('차주 회의', page), NOW)
    const priorMonth = routeChatRequest(request('전월 회의', page), NOW)
    const nextMonth = routeChatRequest(request('익월 회의', page), NOW)
    const routes = [range, namedMonth, priorWeek, nextWeek, priorMonth, nextMonth]
    expect(routes.every(route => route.kind === 'tools')).toBe(true)
    if (routes.some(route => route.kind !== 'tools')) return
    expect(range.calls[0].args).toMatchObject({ from: '2026-08-03', to: '2026-08-05' })
    expect(namedMonth.calls[0].args).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
    expect(priorWeek.calls[0].args).toMatchObject({ from: '2026-07-06', to: '2026-07-12' })
    expect(nextWeek.calls[0].args).toMatchObject({ from: '2026-07-20', to: '2026-07-26' })
    expect(priorMonth.calls[0].args).toMatchObject({ from: '2026-06-01', to: '2026-06-30' })
    expect(nextMonth.calls[0].args).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('does not pass all filters and only forwards allowed natural WBS statuses', () => {
    const all = routeChatRequest(request('작업 알려줘', context('kanban', {
      filters: { status: 'all', team: 'all' },
    })), NOW)
    const progress = routeChatRequest(request('진행 중 작업', context('wbs')), NOW)
    const notStarted = routeChatRequest(request('미착수 작업', context('wbs')), NOW)
    expect(all.kind).toBe('tools')
    expect(progress.kind).toBe('tools')
    expect(notStarted.kind).toBe('tools')
    if (all.kind !== 'tools' || progress.kind !== 'tools' || notStarted.kind !== 'tools') return
    expect(all.calls[0].args).not.toHaveProperty('status')
    expect(all.calls[0].args).not.toHaveProperty('team')
    expect(progress.calls[0].args).toMatchObject({ status: 'in_progress' })
    expect(notStarted.calls[0].args).toMatchObject({ status: 'not_started' })
  })

  it('does not interpret 미완료 as the done filter', () => {
    const route = routeChatRequest(request('미완료 작업 알려줘', context('wbs')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0].args).not.toHaveProperty('status')
  })

  it('passes explicit WBS schedule ranges with overlap or boundary semantics', () => {
    const overlap = routeChatRequest(request('이번 주 작업 알려줘', context('wbs')), NOW)
    const starts = routeChatRequest(request('이번 주 시작 작업 알려줘', context('wbs')), NOW)
    const ends = routeChatRequest(request('이번 주 완료 예정 작업 알려줘', context('wbs')), NOW)
    const explicit = routeChatRequest(request('2026-06-01 작업 알려줘', context('wbs')), NOW)
    expect(overlap.kind).toBe('tools')
    expect(starts.kind).toBe('tools')
    expect(ends.kind).toBe('tools')
    expect(explicit.kind).toBe('tools')
    if (
      overlap.kind !== 'tools' || starts.kind !== 'tools'
      || ends.kind !== 'tools' || explicit.kind !== 'tools'
    ) return
    expect(overlap.calls[0]).toMatchObject({
      tool: 'find_wbs_items',
      args: { from: '2026-07-13', to: '2026-07-19', dateMode: 'overlap' },
    })
    expect(starts.calls[0].args).toMatchObject({
      from: '2026-07-13', to: '2026-07-19', dateMode: 'starts',
    })
    expect(ends.calls[0].args).toMatchObject({
      from: '2026-07-13', to: '2026-07-19', dateMode: 'ends',
    })
    expect(ends.calls[0].args).not.toHaveProperty('status')
    expect(explicit.calls[0].args).toMatchObject({
      from: '2026-06-01', to: '2026-06-01', dateMode: 'overlap',
    })
  })

  it('uses the selected WBS entity for dependency questions', () => {
    const route = routeChatRequest(request('이 작업의 선행 작업 알려줘', context('wbs', {
      selectedEntity: { type: 'wbs_item', id: 'item-1' },
    })), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'get_wbs_dependencies', args: { itemId: 'item-1' } })
  })

  it('routes selected WBS audit and attachment questions to metadata-only read tools', () => {
    const page = context('wbs', { selectedEntity: { type: 'wbs_item', id: 'item-1' } })
    const audit = routeChatRequest(request('이 작업 최근 변경 이력', page), NOW)
    const files = routeChatRequest(request('이 작업 첨부파일', page), NOW)
    expect(audit.kind).toBe('tools')
    expect(files.kind).toBe('tools')
    if (audit.kind !== 'tools' || files.kind !== 'tools') return
    expect(audit.calls[0]).toMatchObject({ tool: 'get_wbs_change_log', args: { itemId: 'item-1' } })
    expect(files.calls[0]).toMatchObject({ tool: 'list_wbs_attachments', args: { itemId: 'item-1' } })
  })

  it('uses current KST week for explicit weekly words instead of a stale page week', () => {
    const page = context('weekly', { weekStart: '2026-06-01' })
    const current = routeChatRequest(request('금주 업무 알려줘', page), NOW)
    const prior = routeChatRequest(request('지난주 업무 알려줘', page), NOW)
    const compare = routeChatRequest(request('지난주와 이번 주 주간업무 비교', page), NOW)
    expect(current.kind).toBe('tools')
    expect(prior.kind).toBe('tools')
    expect(compare.kind).toBe('tools')
    if (current.kind !== 'tools' || prior.kind !== 'tools' || compare.kind !== 'tools') return
    expect(current.calls[0].args).toMatchObject({ weekStart: '2026-07-13' })
    expect(prior.calls[0].args).toMatchObject({ weekStart: '2026-07-06' })
    expect(compare.calls[0]).toMatchObject({
      tool: 'compare_weekly_sheets',
      args: { fromWeekStart: '2026-07-06', toWeekStart: '2026-07-13' },
    })
  })

  it('maps explicit weekly dates to their ordered Monday anchors', () => {
    const page = context('weekly', { weekStart: '2026-07-13' })
    const sheet = routeChatRequest(request('2026-06-01 주간업무 알려줘', page), NOW)
    const compare = routeChatRequest(request(
      '2026년 6월 15일과 2026년 6월 1일 주간업무 비교', page,
    ), NOW)
    expect(sheet.kind).toBe('tools')
    expect(compare.kind).toBe('tools')
    if (sheet.kind !== 'tools' || compare.kind !== 'tools') return
    expect(sheet.calls[0]).toMatchObject({
      tool: 'get_weekly_sheet', args: { weekStart: '2026-06-01' },
    })
    expect(compare.calls[0]).toMatchObject({
      tool: 'compare_weekly_sheets',
      args: { fromWeekStart: '2026-06-01', toWeekStart: '2026-06-15' },
    })
  })

  it('lets explicit weekly menu nouns win over the legacy weekly-summary intent', () => {
    const route = routeChatRequest(request('주간업무 정리해줘', context('weekly')), NOW)
    const performance = routeChatRequest(request('금주 실적 알려줘', context('weekly')), NOW)
    expect(route.kind).toBe('tools')
    expect(performance.kind).toBe('tools')
    if (route.kind !== 'tools' || performance.kind !== 'tools') return
    expect(route.calls[0].tool).toBe('get_weekly_sheet')
    expect(performance.domains).toEqual(['weekly'])
  })

  it('never routes a write command to a read tool', () => {
    const route = routeChatRequest(request('이 작업 실적 80으로 올려줘', context('wbs')), NOW)
    expect(route).toMatchObject({ kind: 'command', calls: [] })
  })

  it('asks for a project when a project-scoped tool has no project hint', () => {
    const route = routeChatRequest({
      projectId: null, message: '오늘 연차인 사람', history: [],
      pageContext: { ...context('attendance'), projectId: null, pathname: '/attendance' },
    }, NOW)
    expect(route).toMatchObject({ kind: 'clarify', reason: 'project_required', calls: [] })
  })

  it('restores a related conversation domain and entity on an unknown page', () => {
    const route = routeChatRequest({
      projectId: null,
      message: '그 항목 자세히 알려줘',
      history: [],
      pageContext: { ...context('unknown'), projectId: null, pathname: '/somewhere' },
      conversationState: {
        version: 1,
        lastDomains: ['wbs'],
        lastEntities: [{ type: 'wbs_item', id: 'item-1', ref: 'S1', projectId: 'p1', title: '설계' }],
      },
    }, NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route).toMatchObject({ reason: 'conversation_state' })
    expect(route.calls[0]).toMatchObject({ tool: 'get_wbs_item_detail', args: { projectId: 'p1', itemId: 'item-1' } })
  })

  it('uses all-project my-meetings scope on the global page but scoped detail hints', () => {
    const globalPage = {
      ...context('meetings'), projectId: null, pathname: '/meetings',
      selectedEntity: { type: 'meeting' as const, id: 'm1' },
      selectedProjectId: 'p1',
    }
    const list = routeChatRequest({
      projectId: null, message: '내일 내 회의', history: [], pageContext: globalPage,
      conversationState: {
        version: 1, lastDomains: ['meetings'],
        lastEntities: [{ type: 'meeting', id: 'm1', ref: 'S1', projectId: 'p1', title: '주간회의' }],
      },
    }, NOW)
    const detail = routeChatRequest({ projectId: null, message: '그 회의 상세', history: [], pageContext: globalPage }, NOW)
    expect(list.kind).toBe('tools')
    expect(detail.kind).toBe('tools')
    if (list.kind !== 'tools' || detail.kind !== 'tools') return
    expect(list.calls[0].tool).toBe('list_my_meetings')
    expect(list.calls[0].args).not.toHaveProperty('projectId')
    expect(detail.calls[0]).toMatchObject({ tool: 'get_meeting_detail', args: { projectId: 'p1', meetingId: 'm1' } })
  })

  it('requires a selected meeting before reading attendee or detail-only fields', () => {
    const missing = routeChatRequest(request('ERP 주간회의 참석자 알려줘', context('meetings')), NOW)
    const selected = routeChatRequest(request('ERP 주간회의 참석자 알려줘', context('meetings', {
      selectedEntity: { type: 'meeting', id: 'meeting-1' },
    })), NOW)
    expect(missing).toMatchObject({
      kind: 'clarify', reason: 'meeting_selection_required', calls: [],
    })
    expect(selected.kind).toBe('tools')
    if (selected.kind !== 'tools') return
    expect(selected.calls[0]).toMatchObject({
      tool: 'get_meeting_detail', args: { meetingId: 'meeting-1' },
    })
  })

  it('omits all member filters and maps attendance leave terms precisely', () => {
    const all = routeChatRequest(request('오늘 휴가인 사람', context('attendance', {
      filters: { memberId: 'all' }, range: { from: '2026-07-01', to: '2026-07-31' },
    })), NOW)
    const member = routeChatRequest(request('오늘 반반차', context('attendance', {
      filters: { memberId: 'member-1' },
    })), NOW)
    expect(all.kind).toBe('tools')
    expect(member.kind).toBe('tools')
    if (all.kind !== 'tools' || member.kind !== 'tools') return
    expect(all.calls[0].args).not.toHaveProperty('memberId')
    expect(all.calls[0].args).toMatchObject({
      from: '2026-07-19', to: '2026-07-19', types: ['annual', 'half', 'quarter', 'sick'],
    })
    expect(member.calls[0].args).toMatchObject({ memberId: 'member-1', types: ['quarter'] })
  })

  it.each([
    ['전체 프로젝트 현황 알려줘', context('wbs')],
    ['주간 요약', context('dashboard')],
    ['도와줘', context('projects', { projectId: null, pathname: '/projects' })],
  ])('preserves the legacy bot for unsupported intent/page: %s', (message, page) => {
    const route = routeChatRequest(request(message, page), NOW)
    expect(route.kind).toBe('legacy')
  })

  it('routes 멤버별 업무 to the honest team-level workload tool instead of legacy', () => {
    const route = routeChatRequest(request('멤버별 업무 정리해줘', context('wbs')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'get_member_workload', args: { projectId: 'p1' } })
  })

  it('falls back before streaming for unsupported meeting-attendance intersections', () => {
    const route = routeChatRequest(request('내일 회의 참석자 중 휴가인 사람이 있나?', context('meetings')), NOW)
    expect(route).toMatchObject({
      kind: 'legacy',
      domains: ['attendance', 'meetings'],
      calls: [],
      reason: 'unsupported_meeting_attendance_intersection',
    })
  })
})

describe('chat v2 router — Phase 2 신규 도메인', () => {
  it('routes 고정 공지 to list_announcements with pinnedOnly', () => {
    const route = routeChatRequest(request('고정 공지 알려줘', context('announcements')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.domains).toEqual(['announcements'])
    expect(route.calls[0]).toMatchObject({
      tool: 'list_announcements', args: { projectId: 'p1', pinnedOnly: true },
    })
  })

  it('routes a quoted announcement search to search_announcements', () => {
    const route = routeChatRequest(request("'배포 일정' 공지 찾아줘", context('announcements')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({
      tool: 'search_announcements', args: { projectId: 'p1', query: '배포 일정' },
    })
  })

  it('routes 완료된 공지 to announcements, not to a WBS status query', () => {
    const route = routeChatRequest(request('완료된 공지 알려줘', context('wbs')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.domains).toEqual(['announcements'])
  })

  it('routes quoted minutes searches globally without a project id on /minutes', () => {
    const page = context('minutes', { projectId: null, pathname: '/minutes' })
    const route = routeChatRequest(
      { projectId: null, message: "'ERP 인터페이스' 회의록 찾아줘", history: [], pageContext: page },
      NOW,
    )
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'search_minutes', args: { query: 'ERP 인터페이스' } })
    expect(route.calls[0].args).not.toHaveProperty('projectId')
  })

  it('routes a selected minute detail question to get_minute_detail', () => {
    const page = context('minutes', {
      projectId: null, pathname: '/minutes',
      selectedEntity: { type: 'minute', id: 'min-1' },
    })
    const route = routeChatRequest(
      { projectId: null, message: '이 회의록 결정사항 정리해줘', history: [], pageContext: page },
      NOW,
    )
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'get_minute_detail', args: { minuteId: 'min-1' } })
  })

  it('asks for a minute selection when detail words come without a target', () => {
    const page = context('minutes', { projectId: null, pathname: '/minutes' })
    const route = routeChatRequest(
      { projectId: null, message: '그 회의록 상세 내용 알려줘', history: [], pageContext: page },
      NOW,
    )
    expect(route.kind).toBe('clarify')
    if (route.kind !== 'clarify') return
    expect(route.reason).toBe('minute_selection_required')
  })

  it('routes the kanban page view mode into get_kanban_view', () => {
    const route = routeChatRequest(request('카드 현황 알려줘', context('kanban', { view: 'owner' })), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({
      tool: 'get_kanban_view', args: { projectId: 'p1', view: 'owner' },
    })
  })

  it('pairs a delayed-card question with both kanban and wbs evidence', () => {
    const route = routeChatRequest(request('지연된 카드 알려줘', context('kanban')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    const tools = route.calls.map(call => call.tool)
    expect(tools).toContain('get_kanban_view')
    expect(route.calls.find(call => call.tool === 'get_kanban_view')?.args).toMatchObject({ status: 'delayed' })
  })

  it('routes 대시보드 요약 to get_project_dashboard even with an overview-like phrasing', () => {
    const route = routeChatRequest(request('대시보드 현황 요약해줘', context('wbs')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'get_project_dashboard', args: { projectId: 'p1' } })
  })

  it('routes ERP 팀 멤버 to list_members with the team filter', () => {
    const route = routeChatRequest(request('ERP 팀 구성원 알려줘', context('members')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'list_members', args: { projectId: 'p1', team: 'ERP' } })
  })

  it('routes 프로젝트 설정 to get_safe_project_settings', () => {
    const route = routeChatRequest(request('프로젝트 설정이랑 공휴일 알려줘', context('settings')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'get_safe_project_settings', args: { projectId: 'p1' } })
  })

  it('keeps generic questions on a supported page routed by page context', () => {
    const route = routeChatRequest(request('여기 뭐가 있어?', context('announcements')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.domains).toEqual(['announcements'])
  })
})
