import { describe, expect, it, vi } from 'vitest'
import { createGetProjectDashboardTool } from '@/lib/ai/tools/dashboard'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import {
  repositoryError,
  repositoryOk,
  type MeetingBotRepository,
  type ProjectMeetingSnapshot,
  type RepositoryResult,
  type WbsBotRepository,
  type WbsProjectSnapshot,
} from '@/lib/repositories/types'

const context: ToolExecutionContext = {
  userId: 'user-1',
  role: 'team_editor',
  teamId: 'team-erp',
  capabilities: ['dashboard:read'],
  allowedProjectIds: ['p1'],
  pageContext: null,
  now: '2026-07-20T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}

// 2026-07-20(월) 기준. 주말이 계획율 계산에 끼어들지 않도록 평일 경계 날짜만 사용.
const wbsSnapshot: WbsProjectSnapshot = {
  projectId: 'p1',
  baseDate: '2026-07-20',
  holidays: [],
  dependencies: [],
  items: [
    {
      id: 'phase-1', projectId: 'p1', parentId: null, level: 'phase', code: '1', sortOrder: 1,
      name: '구축', biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-08-31',
      weight: null, actualPct: null, owners: [], updatedAt: '2026-07-18T00:00:00Z',
    },
    {
      id: 'task-1', projectId: 'p1', parentId: 'phase-1', level: 'task', code: '1.1', sortOrder: 1,
      name: 'ERP 설계', biz: null, deliverable: '설계서', plannedStart: '2026-07-01', plannedEnd: '2026-07-10',
      weight: null, actualPct: 100, owners: [{ team: 'ERP', kind: 'primary' }], updatedAt: '2026-07-10T00:00:00Z',
    },
    {
      id: 'task-2', projectId: 'p1', parentId: 'phase-1', level: 'task', code: '1.2', sortOrder: 2,
      name: 'ERP 개발', biz: null, deliverable: '프로그램', plannedStart: '2026-07-06', plannedEnd: '2026-07-17',
      weight: null, actualPct: 50, owners: [{ team: 'ERP', kind: 'primary' }], updatedAt: '2026-07-17T00:00:00Z',
    },
    {
      id: 'task-3', projectId: 'p1', parentId: 'phase-1', level: 'task', code: '1.3', sortOrder: 3,
      name: 'MES 테스트', biz: null, deliverable: null, plannedStart: '2026-07-27', plannedEnd: '2026-07-31',
      weight: null, actualPct: 0, owners: [{ team: 'MES', kind: 'primary' }], updatedAt: null,
    },
    {
      id: 'ms-1', projectId: 'p1', parentId: 'phase-1', level: 'task', code: '1.4', sortOrder: 4,
      name: '중간보고회', biz: null, deliverable: '중간보고서', plannedStart: '2026-07-24', plannedEnd: '2026-07-24',
      weight: null, actualPct: 0, owners: [{ team: 'PMO', kind: 'primary' }], updatedAt: '2026-07-15T00:00:00Z',
    },
  ],
}

const meetingSnapshot: ProjectMeetingSnapshot = {
  meetings: [{
    id: 'm1', projectId: 'p1', title: 'ERP 주간회의', meetingDate: '2026-07-20',
    startTime: '10:00', endTime: '11:00', location: '회의실 A', category: 'routine', body: '',
    recurrence: 'weekly', recurrenceUntil: null, createdBy: 'auth-user-1', createdByName: '홍길동',
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-19T00:00:00Z', attendeeIds: ['member-1'],
  }],
  exceptions: [],
}

function wbsRepository(result: RepositoryResult<WbsProjectSnapshot | null>): WbsBotRepository {
  return {
    getProjectSnapshot: vi.fn(async () => result),
    getChangeLog: vi.fn(async () => { throw new Error('대시보드 도구는 변경 이력을 조회하지 않는다') }),
    listAttachmentMetadata: vi.fn(async () => { throw new Error('대시보드 도구는 첨부를 조회하지 않는다') }),
  }
}

function meetingRepository(result: RepositoryResult<ProjectMeetingSnapshot>): MeetingBotRepository {
  return {
    listProjectMeetings: vi.fn(async () => result),
    getMeetingDetail: vi.fn(async () => { throw new Error('대시보드 도구는 회의 상세를 조회하지 않는다') }),
    listMyMeetings: vi.fn(async () => { throw new Error('대시보드 도구는 내 회의를 조회하지 않는다') }),
  }
}

describe('get_project_dashboard', () => {
  it('returns progress, schedule, milestone, and meeting signals with dashboard/milestone sources', async () => {
    const meetings = meetingRepository(repositoryOk(meetingSnapshot))
    const tool = createGetProjectDashboardTool(wbsRepository(repositoryOk(wbsSnapshot)), meetings)

    const result = await tool.execute({ projectId: 'p1' }, context)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.status).toBe('ok')
    expect(result.result.truncated).toBe(false)
    expect(result.result.warnings).toEqual([])
    expect(result.result.records).toEqual([])
    expect(result.result.asOf).toBe(context.now)
    expect(result.result.facts).toMatchObject({
      projectFound: true,
      calculationDate: '2026-07-20',
      plannedPct: 50,
      actualPct: 37.5,
      variance: -12.5,
      progressSignal: 'red',
      wbsItemCount: 4,
      delayedCount: 1,
      doneCount: 1,
      inProgressCount: 0,
      projectedEnd: '2026-09-21',
      slipDays: 21,
      elapsedPct: 32,
      scheduleSignal: 'red',
      scheduleLabel: 'onTrack',
      milestoneName: '중간보고회',
      milestoneDate: '2026-07-24',
      milestoneDday: 4,
      milestoneOverdue: false,
      todayMeetings: 1,
      upcoming7dMeetings: 1,
    })
    expect(result.result.sources.map(source => source.href)).toEqual([
      '/p/p1/dashboard',
      '/p/p1/wbs?focus=ms-1',
    ])
    expect(result.result.sources[0]).toMatchObject({
      domain: 'dashboard', entityType: 'project', entityId: 'p1', projectId: 'p1',
    })
    expect(result.result.sources[1]).toMatchObject({
      domain: 'wbs', entityType: 'wbs_item', entityId: 'ms-1', title: '1.4 중간보고회',
      updatedAt: '2026-07-15T00:00:00Z',
    })
    // 회의 신호는 base_date가 아니라 실제 오늘 기준 7일 창으로 조회한다.
    expect(meetings.listProjectMeetings).toHaveBeenCalledWith('p1', '2026-07-20', '2026-07-27')
  })

  it('keeps WBS signals on base_date while meeting signals use the real today', async () => {
    const meetings = meetingRepository(repositoryOk({ meetings: [], exceptions: [] }))
    const tool = createGetProjectDashboardTool(
      wbsRepository(repositoryOk({ ...wbsSnapshot, baseDate: '2026-07-13' })), meetings,
    )

    const result = await tool.execute({ projectId: 'p1' }, context)
    expect(result.ok && result.result.facts.calculationDate).toBe('2026-07-13')
    expect(meetings.listProjectMeetings).toHaveBeenCalledWith('p1', '2026-07-20', '2026-07-27')
    expect(result.ok && result.result.facts).toMatchObject({ todayMeetings: 0, upcoming7dMeetings: 0 })
  })

  it('flags an overdue milestone with a negative D-day and links its WBS item', async () => {
    const snapshot: WbsProjectSnapshot = {
      projectId: 'p1', baseDate: null, holidays: [], dependencies: [],
      items: [{
        id: 'ms-late', projectId: 'p1', parentId: null, level: 'task', code: '1', sortOrder: 1,
        name: '착수보고', biz: null, deliverable: '착수보고서', plannedStart: '2026-07-10', plannedEnd: '2026-07-10',
        weight: null, actualPct: 0, owners: [], updatedAt: null,
      }],
    }
    const tool = createGetProjectDashboardTool(
      wbsRepository(repositoryOk(snapshot)),
      meetingRepository(repositoryOk({ meetings: [], exceptions: [] })),
    )

    const result = await tool.execute({ projectId: 'p1' }, context)
    expect(result.ok && result.result.facts).toMatchObject({
      milestoneName: '착수보고', milestoneDate: '2026-07-10', milestoneDday: -10, milestoneOverdue: true,
      delayedCount: 1,
    })
    expect(result.ok && result.result.sources.map(source => source.href)).toEqual([
      '/p/p1/dashboard',
      '/p/p1/wbs?focus=ms-late',
    ])
  })

  it('degrades honestly when the WBS has no planned dates', async () => {
    const snapshot: WbsProjectSnapshot = {
      projectId: 'p1', baseDate: null, holidays: [], dependencies: [],
      items: [{
        id: 'task-a', projectId: 'p1', parentId: null, level: 'task', code: '1', sortOrder: 1,
        name: '과업 정의', biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
        weight: null, actualPct: 0, owners: [], updatedAt: null,
      }],
    }
    const tool = createGetProjectDashboardTool(
      wbsRepository(repositoryOk(snapshot)),
      meetingRepository(repositoryOk({ meetings: [], exceptions: [] })),
    )

    const result = await tool.execute({ projectId: 'p1' }, context)
    expect(result.ok && result.result.facts).toMatchObject({
      variance: 0,
      projectedEnd: null,
      slipDays: null,
      elapsedPct: 0,
      scheduleSignal: 'neutral',
      scheduleLabel: null,
      milestoneName: null,
      milestoneDate: null,
      milestoneDday: null,
      milestoneOverdue: false,
    })
    expect(result.ok && result.result.sources).toHaveLength(1)
  })

  it('keeps a missing project distinct from a WBS query failure', async () => {
    const meetings = meetingRepository(repositoryOk(meetingSnapshot))
    const empty = await createGetProjectDashboardTool(
      wbsRepository(repositoryOk(null)), meetings,
    ).execute({ projectId: 'p1' }, context)
    expect(empty).toMatchObject({
      ok: true,
      result: { status: 'ok', facts: { projectFound: false }, records: [], sources: [] },
    })
    expect(meetings.listProjectMeetings).not.toHaveBeenCalled()

    const failed = await createGetProjectDashboardTool(
      wbsRepository(repositoryError('WBS_ITEMS_READ_FAILED', true)), meetings,
    ).execute({ projectId: 'p1' }, context)
    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'DATA_SOURCE_ERROR', retryable: true, repositoryErrorCode: 'WBS_ITEMS_READ_FAILED' },
    })
  })

  it('returns a partial result with WBS facts only when the meeting read fails', async () => {
    const tool = createGetProjectDashboardTool(
      wbsRepository(repositoryOk(wbsSnapshot)),
      meetingRepository(repositoryError('MEETINGS_READ_FAILED', true)),
    )

    const result = await tool.execute({ projectId: 'p1' }, context)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.status).toBe('partial')
    expect(result.result.warnings).toEqual(['회의 데이터를 확인하지 못해 회의 신호를 제외했습니다.'])
    expect(result.result.facts).toMatchObject({ actualPct: 37.5, plannedPct: 50 })
    expect(result.result.facts).not.toHaveProperty('todayMeetings')
    expect(result.result.facts).not.toHaveProperty('upcoming7dMeetings')
  })

  it('rejects invalid arguments before touching any repository', async () => {
    const wbs = wbsRepository(repositoryOk(wbsSnapshot))
    const tool = createGetProjectDashboardTool(wbs, meetingRepository(repositoryOk(meetingSnapshot)))

    const results = await Promise.all([
      tool.execute('p1', context),
      tool.execute({}, context),
      tool.execute({ projectId: '' }, context),
    ])
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    }
    expect(wbs.getProjectSnapshot).not.toHaveBeenCalled()
  })

  it('fails closed on project scope or missing capability', async () => {
    const wbs = wbsRepository(repositoryOk(wbsSnapshot))
    const tool = createGetProjectDashboardTool(wbs, meetingRepository(repositoryOk(meetingSnapshot)))

    const outOfScope = await tool.execute(
      { projectId: 'p1' }, { ...context, allowedProjectIds: [] },
    )
    const noCapability = await tool.execute(
      { projectId: 'p1' }, { ...context, capabilities: [] },
    )
    expect(outOfScope).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(noCapability).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(wbs.getProjectSnapshot).not.toHaveBeenCalled()
  })

  it('treats scope-widening WBS or meeting rows as a data-source failure', async () => {
    const rogueWbs = await createGetProjectDashboardTool(
      wbsRepository(repositoryOk({ ...wbsSnapshot, projectId: 'p2' })),
      meetingRepository(repositoryOk(meetingSnapshot)),
    ).execute({ projectId: 'p1' }, context)
    expect(rogueWbs).toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })

    const rogueMeetings = await createGetProjectDashboardTool(
      wbsRepository(repositoryOk(wbsSnapshot)),
      meetingRepository(repositoryOk({
        meetings: [{ ...meetingSnapshot.meetings[0], projectId: 'p2' }],
        exceptions: [],
      })),
    ).execute({ projectId: 'p1' }, context)
    expect(rogueMeetings).toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
  })

  it('never serializes emails, storage paths, or raw auth identifiers', async () => {
    const tool = createGetProjectDashboardTool(
      wbsRepository(repositoryOk(wbsSnapshot)),
      meetingRepository(repositoryOk(meetingSnapshot)),
    )

    const result = await tool.execute({ projectId: 'p1' }, context)
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/email|file_path|filePath|signed|attendeeIds|createdBy/i)
  })
})
