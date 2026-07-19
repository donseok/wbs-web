import { describe, expect, it, vi } from 'vitest'
import { createGetAttendanceTool } from '@/lib/ai/tools/attendance'
import { createListMeetingsTool } from '@/lib/ai/tools/meetings'
import { createGetWeeklySheetTool } from '@/lib/ai/tools/weekly'
import {
  createFindWbsItemsTool,
  createGetWbsDependenciesTool,
  createGetWbsItemDetailTool,
} from '@/lib/ai/tools/wbs'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import type {
  AttendanceRepository,
  AttendanceRepositoryRecord,
  MeetingRepository,
  ProjectMeetingSnapshot,
  WbsProjectSnapshot,
  WbsRepository,
  WeeklyRepository,
  WeeklySheetSnapshot,
} from '@/lib/repositories/types'
import { repositoryError, repositoryOk } from '@/lib/repositories/types'

const context: ToolExecutionContext = {
  userId: 'user-1',
  role: 'team_editor',
  teamId: 'team-1',
  capabilities: ['wbs:read', 'weekly:read', 'meetings:read', 'attendance:read'],
  allowedProjectIds: ['p1'],
  pageContext: null,
  now: '2026-07-20T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}

const wbsSnapshot: WbsProjectSnapshot = {
  projectId: 'p1',
  baseDate: '2026-07-20',
  holidays: [],
  items: [
    {
      id: 'phase-1', projectId: 'p1', parentId: null, level: 'phase', code: '1', sortOrder: 1,
      name: '구축', biz: null, deliverable: null, plannedStart: '2026-07-20', plannedEnd: '2026-07-31',
      weight: null, actualPct: null, owners: [], updatedAt: '2026-07-20T00:00:00Z',
    },
    {
      id: 'task-1', projectId: 'p1', parentId: 'phase-1', level: 'task', code: '1.1', sortOrder: 1,
      name: 'ERP 설계', biz: 'ERP 프로세스 설계', deliverable: '설계서',
      plannedStart: '2026-07-20', plannedEnd: '2026-07-22', weight: null, actualPct: 50,
      owners: [{ team: 'ERP', kind: 'primary' }], updatedAt: '2026-07-20T01:00:00Z',
    },
    {
      id: 'task-2', projectId: 'p1', parentId: 'phase-1', level: 'task', code: '1.2', sortOrder: 2,
      name: 'ERP 개발', biz: '개발', deliverable: '프로그램',
      plannedStart: '2026-07-23', plannedEnd: '2026-07-27', weight: null, actualPct: 0,
      owners: [{ team: 'ERP', kind: 'primary' }], updatedAt: '2026-07-20T02:00:00Z',
    },
  ],
  dependencies: [{
    id: 'dep-1', projectId: 'p1', predecessorId: 'task-1', successorId: 'task-2', type: 'FS', lagDays: 0,
  }],
}

function wbsRepository(result: ReturnType<WbsRepository['getProjectSnapshot']> extends Promise<infer T> ? T : never) {
  return { getProjectSnapshot: vi.fn(async () => result) } satisfies WbsRepository
}

describe('core read tools', () => {
  it('fails closed before repository access when project scope is not allowed', async () => {
    const repository = wbsRepository({ ok: true, data: wbsSnapshot })
    const tool = createFindWbsItemsTool(repository)
    const deniedContext = { ...context, allowedProjectIds: [] }

    await expect(tool.execute({ projectId: 'p1', query: 'ERP' }, deniedContext)).resolves.toMatchObject({
      ok: false,
      error: { code: 'ACCESS_DENIED' },
    })
    expect(repository.getProjectSnapshot).not.toHaveBeenCalled()
  })

  it('also requires the domain capability, even for an allowed project', async () => {
    const repository = wbsRepository({ ok: true, data: wbsSnapshot })
    const tool = createGetWbsItemDetailTool(repository)

    const result = await tool.execute(
      { projectId: 'p1', itemId: 'task-1' },
      { ...context, capabilities: [] },
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(repository.getProjectSnapshot).not.toHaveBeenCalled()
  })

  it('rejects repository rows that widen the requested project scope', async () => {
    const rogueWbs = wbsRepository(repositoryOk({ ...wbsSnapshot, projectId: 'p2' }))
    const rogueWeekly: WeeklyRepository = {
      getSheet: vi.fn(async () => repositoryOk<WeeklySheetSnapshot | null>({
        report: {
          id: 'r1', projectId: 'p2', weekStart: '2026-07-20', title: '', updatedAt: null,
        },
        rows: [],
      })),
    }
    const rogueMeetings: MeetingRepository = {
      listProjectMeetings: vi.fn(async () => repositoryOk<ProjectMeetingSnapshot>({
        meetings: [{
          id: 'm2', projectId: 'p2', title: '다른 프로젝트 회의', meetingDate: '2026-07-20',
          startTime: null, endTime: null, location: null, category: 'general', body: '',
          recurrence: 'none', recurrenceUntil: null, createdBy: null, createdByName: null,
          createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-20T00:00:00Z', attendeeIds: [],
        }],
        exceptions: [],
      })),
      getMeetingDetail: vi.fn(),
    }
    const rogueAttendance: AttendanceRepository = {
      listRecords: vi.fn(async () => repositoryOk<AttendanceRepositoryRecord[]>([{
        id: 'a2', projectId: 'p2', memberId: 'member-2', memberName: '다른 사용자',
        teamCode: 'ERP', date: '2026-07-20', type: 'work',
      }])),
    }

    const results = await Promise.all([
      createFindWbsItemsTool(rogueWbs).execute({ projectId: 'p1' }, context),
      createGetWeeklySheetTool(rogueWeekly).execute(
        { projectId: 'p1', weekStart: '2026-07-20' }, context,
      ),
      createListMeetingsTool(rogueMeetings).execute(
        { projectId: 'p1', from: '2026-07-20', to: '2026-07-20' }, context,
      ),
      createGetAttendanceTool(rogueAttendance).execute(
        { projectId: 'p1', from: '2026-07-20', to: '2026-07-20' }, context,
      ),
    ])
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
    }
  })

  it('returns WBS hierarchy/detail and dependency forecasts with source links', async () => {
    const repository = wbsRepository({ ok: true, data: wbsSnapshot })
    const find = await createFindWbsItemsTool(repository).execute(
      { projectId: 'p1', query: 'ERP', team: 'ERP' }, context,
    )
    expect(find.ok && find.result.records).toHaveLength(2)
    if (find.ok) {
      expect(find.result.records[0].path).toContain('1 구축 > 1.1 ERP 설계')
      expect(find.result.sources[0].href).toBe('/p/p1/wbs?focus=task-1')
    }

    const dependencies = await createGetWbsDependenciesTool(repository).execute(
      { projectId: 'p1', itemId: 'task-2' }, context,
    )
    expect(dependencies.ok && dependencies.result.records).toHaveLength(1)
    if (dependencies.ok) {
      expect(dependencies.result.records[0]).toMatchObject({
        id: 'dep-1', predecessorId: 'task-1', successorId: 'task-2',
      })
      expect(dependencies.result.facts.dependencyCount).toBe(1)
    }
  })

  it('filters WBS items by overlap, start, and end schedule semantics', async () => {
    const repository = wbsRepository(repositoryOk(wbsSnapshot))
    const tool = createFindWbsItemsTool(repository)

    const [overlap, starts, ends] = await Promise.all([
      tool.execute({
        projectId: 'p1', from: '2026-07-22', to: '2026-07-23', dateMode: 'overlap',
      }, context),
      tool.execute({
        projectId: 'p1', from: '2026-07-22', to: '2026-07-23', dateMode: 'starts',
      }, context),
      tool.execute({
        projectId: 'p1', from: '2026-07-22', to: '2026-07-23', dateMode: 'ends',
      }, context),
    ])

    expect(overlap.ok && overlap.result.records.map(record => record.id)).toEqual([
      'phase-1', 'task-1', 'task-2',
    ])
    expect(starts.ok && starts.result.records.map(record => record.id)).toEqual(['task-2'])
    expect(ends.ok && ends.result.records.map(record => record.id)).toEqual(['task-1'])
    if (overlap.ok) {
      expect(overlap.result.facts).toMatchObject({
        rangeFrom: '2026-07-22', rangeTo: '2026-07-23', dateMode: 'overlap',
      })
    }
  })

  it('rejects partial, invalid, or unscoped WBS schedule arguments', async () => {
    const repository = wbsRepository(repositoryOk(wbsSnapshot))
    const tool = createFindWbsItemsTool(repository)

    const results = await Promise.all([
      tool.execute({ projectId: 'p1', from: '2026-07-22' }, context),
      tool.execute({
        projectId: 'p1', from: '2026-07-23', to: '2026-07-22', dateMode: 'overlap',
      }, context),
      tool.execute({
        projectId: 'p1', from: '2026-07-22', to: '2026-07-23', dateMode: 'contains',
      }, context),
      tool.execute({ projectId: 'p1', dateMode: 'starts' }, context),
    ])

    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    }
    expect(repository.getProjectSnapshot).not.toHaveBeenCalled()
  })

  it('keeps a missing weekly report distinct from a repository query failure', async () => {
    const emptyRepository: WeeklyRepository = {
      getSheet: vi.fn(async () => repositoryOk<WeeklySheetSnapshot | null>(null)),
    }
    const failedRepository: WeeklyRepository = {
      getSheet: vi.fn(async () => repositoryError<WeeklySheetSnapshot | null>(
        'WEEKLY_REPORT_READ_FAILED', true,
      )),
    }
    const args = { projectId: 'p1', weekStart: '2026-07-20' }

    const empty = await createGetWeeklySheetTool(emptyRepository).execute(args, context)
    expect(empty).toMatchObject({ ok: true, result: { facts: { reportFound: false }, records: [] } })

    const failed = await createGetWeeklySheetTool(failedRepository).execute(args, context)
    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'DATA_SOURCE_ERROR', repositoryErrorCode: 'WEEKLY_REPORT_READ_FAILED' },
    })
  })

  it('expands recurring meetings and removes cancelled occurrences', async () => {
    const repository: MeetingRepository = {
      listProjectMeetings: vi.fn(async () => repositoryOk<ProjectMeetingSnapshot>({
          meetings: [{
            id: 'm1', projectId: 'p1', title: 'ERP 주간회의', meetingDate: '2026-07-20',
            startTime: '10:00', endTime: '11:00', location: '회의실 A', category: 'routine', body: '',
            recurrence: 'weekly', recurrenceUntil: null, createdBy: 'u1', createdByName: '홍길동',
            createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-20T00:00:00Z', attendeeIds: ['member-1'],
          }],
          exceptions: [{ meetingId: 'm1', occurrenceDate: '2026-07-27', kind: 'cancelled' }],
      })),
      getMeetingDetail: vi.fn(),
    }
    const result = await createListMeetingsTool(repository).execute(
      { projectId: 'p1', from: '2026-07-20', to: '2026-08-03' }, context,
    )

    expect(result.ok && result.result.records.map(record => record.occurrenceDate)).toEqual([
      '2026-07-20', '2026-08-03',
    ])
  })

  it('returns attendance aggregates without ever exposing note fields', async () => {
    const repository: AttendanceRepository = {
      listRecords: vi.fn(async () => repositoryOk<AttendanceRepositoryRecord[]>([
          { id: 'a1', projectId: 'p1', memberId: 'member-1', memberName: '김ERP', teamCode: 'ERP', date: '2026-07-20', type: 'annual' },
          { id: 'a2', projectId: 'p1', memberId: 'member-2', memberName: '박PMO', teamCode: 'PMO', date: '2026-07-20', type: 'trip' },
      ])),
    }
    const result = await createGetAttendanceTool(repository).execute(
      { projectId: 'p1', from: '2026-07-20', to: '2026-07-26', team: 'ERP' }, context,
    )

    expect(result.ok && result.result.records).toHaveLength(1)
    if (result.ok) {
      expect(result.result.facts).toMatchObject({ totalMatched: 1, memberCount: 1, leave: 1, trip: 0 })
      expect(result.result.records[0]).not.toHaveProperty('note')
      expect(result.result.sources[0].updatedAt).toBeNull()
    }
  })
})
