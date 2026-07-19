import { describe, expect, it, vi } from 'vitest'
import {
  createGetWbsChangeLogTool,
  createListWbsAttachmentsTool,
} from '@/lib/ai/tools/wbs'
import {
  createCompareWeeklySheetsTool,
  createGetWeeklySheetTool,
} from '@/lib/ai/tools/weekly'
import { createListMyMeetingsTool } from '@/lib/ai/tools/meetings'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import {
  repositoryError,
  repositoryOk,
  type MyMeetingRepository,
  type MyMeetingSnapshot,
  type WbsChangeLogSnapshot,
  type WbsSupplementalRepository,
  type WeeklyRepository,
  type WeeklySheetSnapshot,
} from '@/lib/repositories/types'

const context: ToolExecutionContext = {
  userId: 'user-1',
  role: 'team_editor',
  teamId: 'team-erp',
  capabilities: ['wbs:read', 'weekly:read', 'meetings:read'],
  allowedProjectIds: ['p1', 'p2'],
  pageContext: null,
  now: '2026-07-20T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}

function weeklySnapshot(
  reportId: string,
  weekStart: string,
  rows: Array<{
    id: string
    section: string
    module?: string
    thisContent?: string
    thisIssue?: string
    nextContent?: string
    nextIssue?: string
  }>,
): WeeklySheetSnapshot {
  return {
    report: {
      id: reportId,
      projectId: 'p1',
      weekStart,
      title: `${weekStart} 주간업무`,
      updatedAt: `${weekStart}T01:00:00Z`,
    },
    rows: rows.map((row, index) => ({
      id: row.id,
      reportId,
      section: row.section,
      module: row.module ?? '',
      sortOrder: index + 1,
      thisContent: row.thisContent ?? '',
      thisIssue: row.thisIssue ?? '',
      nextContent: row.nextContent ?? '',
      nextIssue: row.nextIssue ?? '',
      updatedAt: `${weekStart}T0${index + 2}:00:00Z`,
    })),
  }
}

describe('menu-detail read tools', () => {
  it('fails closed before WBS audit/attachment repository access', async () => {
    const repository: WbsSupplementalRepository = {
      getChangeLog: vi.fn(),
      listAttachmentMetadata: vi.fn(),
    }
    const denied = { ...context, allowedProjectIds: [] }

    await expect(createGetWbsChangeLogTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, denied,
    )).resolves.toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    await expect(createListWbsAttachmentsTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, denied,
    )).resolves.toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(repository.getChangeLog).not.toHaveBeenCalled()
    expect(repository.listAttachmentMetadata).not.toHaveBeenCalled()
  })

  it('returns whitelisted WBS change history and metadata-only attachments', async () => {
    const repository: WbsSupplementalRepository = {
      getChangeLog: vi.fn(async () => repositoryOk<WbsChangeLogSnapshot | null>({
        itemId: 'w1', itemCode: '1.1', itemName: 'ERP 설계', itemUpdatedAt: 'u1', truncated: false,
        entries: [{
          id: 1, wbsItemId: 'w1', field: 'actual_pct', oldValue: '10', newValue: '30',
          changedAt: '2026-07-19T01:00:00Z', actorLabel: 'ERP 팀 편집자',
          actorTeam: 'ERP', actorRole: 'team_editor',
        }],
      })),
      listAttachmentMetadata: vi.fn(async () => repositoryOk({
        itemId: 'w1', itemCode: '1.1', itemName: 'ERP 설계', itemUpdatedAt: 'u1', truncated: false,
        attachments: [{
          id: 'a1', wbsItemId: 'w1', fileName: '설계서.pdf', size: 1200,
          mime: 'application/pdf', createdAt: '2026-07-19T02:00:00Z',
        }],
      })),
    }

    const history = await createGetWbsChangeLogTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, context,
    )
    const attachments = await createListWbsAttachmentsTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, context,
    )

    expect(history).toMatchObject({
      ok: true,
      result: { records: [{ field: 'actual_pct', actorLabel: 'ERP 팀 편집자' }] },
    })
    expect(attachments).toMatchObject({
      ok: true,
      result: {
        records: [{ fileName: '설계서.pdf', size: 1200 }],
        sources: [{ entityType: 'attachment', updatedAt: null }],
      },
    })
    expect(JSON.stringify(attachments)).not.toMatch(/filePath|file_path|signed|uploadedBy|email/i)
  })

  it('rejects supplemental WBS results bound to a different item', async () => {
    const repository: WbsSupplementalRepository = {
      getChangeLog: vi.fn(async () => repositoryOk<WbsChangeLogSnapshot | null>({
        itemId: 'w2', itemCode: '2.1', itemName: '다른 작업', itemUpdatedAt: null, truncated: false,
        entries: [],
      })),
      listAttachmentMetadata: vi.fn(async () => repositoryOk({
        itemId: 'w2', itemCode: '2.1', itemName: '다른 작업', itemUpdatedAt: null, truncated: false,
        attachments: [],
      })),
    }

    await expect(createGetWbsChangeLogTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, context,
    )).resolves.toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
    await expect(createListWbsAttachmentsTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, context,
    )).resolves.toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
  })

  it('maps team filters to new weekly sections instead of treating ERP/MES as exact sections', async () => {
    const sheet = weeklySnapshot('r1', '2026-07-20', [
      { id: 'sales', section: '영업', thisContent: '영업 업무' },
      { id: 'buy', section: '구매', thisContent: '구매 업무' },
      { id: 'quality', section: '품질', thisContent: '품질 업무' },
      { id: 'legacy-erp', section: 'ERP', thisContent: '레거시 ERP' },
      { id: 'legacy-mes', section: 'MES', thisContent: '레거시 MES' },
    ])
    const repository: WeeklyRepository = {
      getSheet: vi.fn(async () => repositoryOk(sheet)),
    }

    const erp = await createGetWeeklySheetTool(repository).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'ERP' }, context,
    )
    const mes = await createGetWeeklySheetTool(repository).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'MES' }, context,
    )

    expect(erp.ok && erp.result.records.map(row => row.section)).toEqual(['영업', '구매', 'ERP'])
    expect(mes.ok && mes.result.records.map(row => row.section)).toEqual(['품질', 'MES'])
  })

  it('rejects a weekly response for a different week or report id', async () => {
    const wrongWeek = weeklySnapshot('r1', '2026-07-13', [])
    const wrongRow = weeklySnapshot('r1', '2026-07-20', [
      { id: 'row-1', section: '영업', thisContent: '업무' },
    ])
    wrongRow.rows[0].reportId = 'r-other'

    const wrongWeekRepository: WeeklyRepository = {
      getSheet: vi.fn(async () => repositoryOk(wrongWeek)),
    }
    const wrongRowRepository: WeeklyRepository = {
      getSheet: vi.fn(async () => repositoryOk(wrongRow)),
    }
    const args = { projectId: 'p1', weekStart: '2026-07-20' }

    await expect(createGetWeeklySheetTool(wrongWeekRepository).execute(args, context))
      .resolves.toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
    await expect(createGetWeeklySheetTool(wrongRowRepository).execute(args, context))
      .resolves.toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
  })

  it('compares two weekly sheets with pure reads and applies the ERP section mapping', async () => {
    const before = weeklySnapshot('r-before', '2026-07-13', [
      { id: 'old-sales', section: '영업', thisContent: '요건 분석' },
      { id: 'old-quality', section: '품질', thisContent: '검사 기준' },
    ])
    const after = weeklySnapshot('r-after', '2026-07-20', [
      { id: 'new-sales', section: '영업', thisContent: '설계 완료' },
      { id: 'new-buy', section: '구매', thisContent: '발주 준비' },
      { id: 'new-quality', section: '품질', thisContent: '검사 완료' },
    ])
    const repository: WeeklyRepository = {
      getSheet: vi.fn(async (_projectId, weekStart) => repositoryOk(
        weekStart === '2026-07-13' ? before : after,
      )),
    }

    const result = await createCompareWeeklySheetsTool(repository).execute({
      projectId: 'p1', fromWeekStart: '2026-07-13', toWeekStart: '2026-07-20', team: 'ERP',
    }, context)

    expect(repository.getSheet).toHaveBeenCalledTimes(2)
    expect(repository.getSheet).toHaveBeenCalledWith('p1', '2026-07-13')
    expect(repository.getSheet).toHaveBeenCalledWith('p1', '2026-07-20')
    expect(result.ok && result.result.records.map(row => [row.section, row.change])).toEqual([
      ['영업', 'changed'],
      ['구매', 'added'],
    ])
    expect(result).toMatchObject({
      ok: true,
      result: { facts: { changed: 1, added: 1, removed: 0, totalCompared: 2 } },
    })
  })

  it('keeps a missing comparison sheet distinct from a failed read', async () => {
    const missing: WeeklyRepository = {
      getSheet: vi.fn(async () => repositoryOk<WeeklySheetSnapshot | null>(null)),
    }
    const missingResult = await createCompareWeeklySheetsTool(missing).execute({
      projectId: 'p1', fromWeekStart: '2026-07-13', toWeekStart: '2026-07-20',
    }, context)
    expect(missingResult).toMatchObject({
      ok: true,
      result: { facts: { fromReportFound: false, toReportFound: false }, records: [] },
    })

    const failed: WeeklyRepository = {
      getSheet: vi.fn(async (_projectId, weekStart) => weekStart === '2026-07-13'
        ? repositoryError<WeeklySheetSnapshot | null>('WEEKLY_REPORT_READ_FAILED', true)
        : repositoryOk<WeeklySheetSnapshot | null>(null)),
    }
    const failedResult = await createCompareWeeklySheetsTool(failed).execute({
      projectId: 'p1', fromWeekStart: '2026-07-13', toWeekStart: '2026-07-20',
    }, context)
    expect(failedResult).toMatchObject({
      ok: false,
      error: { code: 'DATA_SOURCE_ERROR', repositoryErrorCode: 'WEEKLY_REPORT_READ_FAILED' },
    })
  })

  it('lists only server-verified personal meetings and exposes no attendee identity fields', async () => {
    const snapshot: MyMeetingSnapshot = {
      meetings: [{
        id: 'm1', projectId: 'p1', title: '주간회의', meetingDate: '2026-07-20',
        startTime: '10:00', endTime: '11:00', location: 'A 회의실', category: 'routine', body: '',
        recurrence: 'weekly', recurrenceUntil: null, createdBy: 'other-user', createdByName: '담당자',
        createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-19T00:00:00Z',
        attendeeIds: ['private-member-id'], projectName: '프로젝트 1', isMine: true, mineBy: 'attendee',
      }],
      exceptions: [{ meetingId: 'm1', occurrenceDate: '2026-07-27', kind: 'cancelled' }],
    }
    const repository: MyMeetingRepository = {
      listMyMeetings: vi.fn(async () => repositoryOk(snapshot)),
    }
    const result = await createListMyMeetingsTool(repository).execute({
      from: '2026-07-20', to: '2026-08-03', limit: 20,
    }, context)

    expect(repository.listMyMeetings).toHaveBeenCalledWith(
      'user-1', ['p1', 'p2'], '2026-07-20', '2026-08-03',
    )
    expect(result.ok && result.result.records.map(row => row.occurrenceDate)).toEqual([
      '2026-07-20', '2026-08-03',
    ])
    if (result.ok) {
      expect(result.result.records[0]).toMatchObject({
        projectName: '프로젝트 1', mineBy: 'attendee',
      })
    }
    expect(JSON.stringify(result)).not.toMatch(/private-member-id|attendeeIds|email/i)
  })

  it('fails closed before a personal-meeting repository call when capability is absent', async () => {
    const repository: MyMeetingRepository = { listMyMeetings: vi.fn() }
    const result = await createListMyMeetingsTool(repository).execute({
      from: '2026-07-20', to: '2026-07-26',
    }, { ...context, capabilities: [] })
    expect(result).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(repository.listMyMeetings).not.toHaveBeenCalled()
  })
})
