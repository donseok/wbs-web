import { describe, expect, it, vi } from 'vitest'
import { createGetMinuteDetailTool, createSearchMinutesTool } from '@/lib/ai/tools/minutes'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import {
  repositoryError,
  repositoryOk,
  type MinuteDetailSnapshot,
  type MinuteRepositoryRecord,
  type MinuteSearchSnapshot,
  type MinutesRepository,
} from '@/lib/repositories/types'

const context: ToolExecutionContext = {
  userId: 'user-1',
  role: 'team_editor',
  teamId: 'team-erp',
  capabilities: ['minutes:read'],
  allowedProjectIds: ['p1', 'p2'],
  pageContext: null,
  now: '2026-07-20T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}

function minuteRecord(overrides: Partial<MinuteRepositoryRecord> = {}): MinuteRepositoryRecord {
  return {
    id: 'min-1',
    minuteDate: '2026-07-17',
    teamCode: 'ERP',
    title: 'ERP 설계 회의록',
    meetingId: 'meeting-1',
    meetingProjectId: 'p1',
    createdByName: '홍길동',
    createdAt: '2026-07-17T01:00:00Z',
    updatedAt: '2026-07-18T01:00:00Z',
    ...overrides,
  }
}

function detailSnapshot(overrides: Partial<MinuteDetailSnapshot> = {}): MinuteDetailSnapshot {
  return {
    minute: { ...minuteRecord(), bodyMd: '# 결정사항\n- ERP 인터페이스 확정' },
    insights: [{ kind: 'decision', label: '인터페이스 확정', blockIndex: 2 }],
    files: [{ fileName: '회의록.md', size: 512, mime: 'text/markdown', createdAt: '2026-07-17T02:00:00Z' }],
    ...overrides,
  }
}

function repositoryWith(overrides: Partial<MinutesRepository> = {}): MinutesRepository {
  return {
    searchMinutes: vi.fn(async () => repositoryOk<MinuteSearchSnapshot>({ records: [], truncated: false })),
    getMinuteDetail: vi.fn(async () => repositoryOk<MinuteDetailSnapshot | null>(null)),
    ...overrides,
  }
}

describe('search_minutes tool', () => {
  it('searches project-scoped minutes and flags the meeting-linked-only caveat', async () => {
    const repository = repositoryWith({
      searchMinutes: vi.fn(async () => repositoryOk<MinuteSearchSnapshot>({
        records: [minuteRecord()], truncated: false,
      })),
    })
    const result = await createSearchMinutesTool(repository).execute({
      query: '설계', team: 'ERP', projectId: 'p1', from: '2026-07-01', to: '2026-07-20',
    }, context)

    expect(repository.searchMinutes).toHaveBeenCalledWith({
      query: '설계', team: 'ERP', projectId: 'p1', from: '2026-07-01', to: '2026-07-20', limit: 20,
    })
    expect(result).toMatchObject({
      ok: true,
      result: {
        status: 'ok',
        facts: { totalMatched: 1, returned: 1, rangeFrom: '2026-07-01', rangeTo: '2026-07-20' },
        records: [{ id: 'min-1', title: 'ERP 설계 회의록', meetingProjectId: 'p1' }],
        sources: [{
          id: 'minute:min-1', domain: 'minutes', entityType: 'minute', entityId: 'min-1',
          projectId: 'p1', href: '/minutes/min-1', updatedAt: '2026-07-18T01:00:00Z',
        }],
        truncated: false,
      },
    })
    if (result.ok) {
      expect(result.result.warnings.some(warning => warning.includes('회의 미연결'))).toBe(true)
    }
    expect(JSON.stringify(result)).not.toMatch(/email|file_path|filePath|signed|bodyMd/i)
  })

  it('applies the recent-90-days default window only when query and range are both absent', async () => {
    const repository = repositoryWith()
    const noArgs = await createSearchMinutesTool(repository).execute({}, context)

    expect(repository.searchMinutes).toHaveBeenCalledWith({
      query: null, team: null, projectId: null, from: '2026-04-21', to: '2026-07-20', limit: 20,
    })
    expect(noArgs).toMatchObject({
      ok: true,
      result: {
        facts: { rangeFrom: '2026-04-21', rangeTo: '2026-07-20', defaultRangeApplied: true },
        records: [],
      },
    })

    await createSearchMinutesTool(repository).execute({ query: '설계' }, context)
    expect(repository.searchMinutes).toHaveBeenLastCalledWith({
      query: '설계', team: null, projectId: null, from: null, to: null, limit: 20,
    })
  })

  it('rejects malformed arguments before any repository access', async () => {
    const repository = repositoryWith({ searchMinutes: vi.fn() })
    const tool = createSearchMinutesTool(repository)

    for (const args of [
      'not-a-record',
      { query: '가'.repeat(201) },
      { team: 'QA' },
      { from: '2026-07-01' },
      { from: '2026-07-20', to: '2026-07-01' },
      { from: '2026-13-01', to: '2026-07-20' },
      { limit: 0 },
    ]) {
      await expect(tool.execute(args, context)).resolves.toMatchObject({
        ok: false, error: { code: 'INVALID_ARGUMENT' },
      })
    }
    expect(repository.searchMinutes).not.toHaveBeenCalled()
  })

  it('fails closed for an out-of-scope project and for a missing capability', async () => {
    const repository = repositoryWith({ searchMinutes: vi.fn() })
    const tool = createSearchMinutesTool(repository)

    await expect(tool.execute({ projectId: 'p3', query: '설계' }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'ACCESS_DENIED' },
    })
    await expect(tool.execute({ query: '설계' }, { ...context, capabilities: [] })).resolves.toMatchObject({
      ok: false, error: { code: 'ACCESS_DENIED' },
    })
    expect(repository.searchMinutes).not.toHaveBeenCalled()
  })

  it('treats a repository row outside the requested project as a data-source failure', async () => {
    const repository = repositoryWith({
      searchMinutes: vi.fn(async () => repositoryOk<MinuteSearchSnapshot>({
        records: [minuteRecord({ id: 'min-x', meetingProjectId: 'p2' })], truncated: false,
      })),
    })
    const result = await createSearchMinutesTool(repository).execute(
      { projectId: 'p1', query: '설계' }, context,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR', retryable: false } })
    expect(JSON.stringify(result)).not.toContain('min-x')
  })

  it('propagates a read failure without disguising it as zero results', async () => {
    const repository = repositoryWith({
      searchMinutes: vi.fn(async () => repositoryError<MinuteSearchSnapshot>('MINUTES_READ_FAILED', true)),
    })
    await expect(createSearchMinutesTool(repository).execute({ query: '설계' }, context)).resolves.toMatchObject({
      ok: false,
      error: { code: 'DATA_SOURCE_ERROR', retryable: true, repositoryErrorCode: 'MINUTES_READ_FAILED' },
    })
  })

  it('marks a truncated archive search as partial with a warning', async () => {
    const repository = repositoryWith({
      searchMinutes: vi.fn(async () => repositoryOk<MinuteSearchSnapshot>({
        records: [minuteRecord(), minuteRecord({ id: 'min-2' })], truncated: true,
      })),
    })
    const result = await createSearchMinutesTool(repository).execute({ query: '설계', limit: 2 }, context)
    expect(result).toMatchObject({
      ok: true,
      result: { status: 'partial', truncated: true, facts: { returned: 2 } },
    })
    if (result.ok) {
      expect(result.result.warnings.some(warning => warning.includes('2건'))).toBe(true)
    }
  })
})

describe('get_minute_detail tool', () => {
  it('returns capped body/insights with metadata-only files and a /minutes deep link', async () => {
    const repository = repositoryWith({
      getMinuteDetail: vi.fn(async () => repositoryOk<MinuteDetailSnapshot | null>(detailSnapshot({
        minute: { ...minuteRecord(), bodyMd: '가'.repeat(4_050) },
        insights: Array.from({ length: 13 }, (_, index) => ({
          kind: 'action', label: `액션 ${index + 1}`, blockIndex: index,
        })),
      }))),
    })
    const result = await createGetMinuteDetailTool(repository).execute({ minuteId: 'min-1' }, context)

    expect(repository.getMinuteDetail).toHaveBeenCalledWith('min-1')
    expect(result).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        facts: { minuteFound: true, returned: 1, insightCount: 13, fileCount: 1, bodyTruncated: true },
        sources: [{
          id: 'minute:min-1', domain: 'minutes', entityType: 'minute',
          entityId: 'min-1', projectId: 'p1', href: '/minutes/min-1',
        }],
        truncated: true,
      },
    })
    if (result.ok) {
      const record = result.result.records[0]
      expect(record.bodyMd).toHaveLength(4_000)
      expect(record.insights).toHaveLength(12)
      expect(record.files).toEqual([
        { fileName: '회의록.md', size: 512, mime: 'text/markdown', createdAt: '2026-07-17T02:00:00Z' },
      ])
      expect(result.result.warnings.length).toBeGreaterThanOrEqual(2)
    }
    expect(JSON.stringify(result)).not.toMatch(/email|file_path|filePath|signed/i)
  })

  it('keeps a missing minute as a successful not-found result', async () => {
    const repository = repositoryWith()
    await expect(createGetMinuteDetailTool(repository).execute({ minuteId: 'missing' }, context))
      .resolves.toMatchObject({
        ok: true,
        result: { facts: { minuteFound: false, returned: 0 }, records: [], sources: [], truncated: false },
      })
  })

  it('fails closed for a minute linked to a project outside the allowlist but allows global minutes', async () => {
    const outOfScope = repositoryWith({
      getMinuteDetail: vi.fn(async () => repositoryOk<MinuteDetailSnapshot | null>(detailSnapshot({
        minute: { ...minuteRecord({ meetingProjectId: 'p9' }), bodyMd: '기밀 본문' },
      }))),
    })
    const denied = await createGetMinuteDetailTool(outOfScope).execute({ minuteId: 'min-1' }, context)
    expect(denied).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(JSON.stringify(denied)).not.toContain('기밀 본문')

    const global = repositoryWith({
      getMinuteDetail: vi.fn(async () => repositoryOk<MinuteDetailSnapshot | null>(detailSnapshot({
        minute: { ...minuteRecord({ meetingId: null, meetingProjectId: null }), bodyMd: '전역 회의록' },
      }))),
    })
    await expect(createGetMinuteDetailTool(global).execute({ minuteId: 'min-1' }, context))
      .resolves.toMatchObject({
        ok: true,
        result: { records: [{ meetingProjectId: null, bodyMd: '전역 회의록' }], sources: [{ projectId: null }] },
      })
  })

  it('rejects bad arguments and a missing capability before any repository access', async () => {
    const repository = repositoryWith({ getMinuteDetail: vi.fn() })
    const tool = createGetMinuteDetailTool(repository)

    await expect(tool.execute({}, context)).resolves.toMatchObject({
      ok: false, error: { code: 'INVALID_ARGUMENT' },
    })
    await expect(tool.execute({ minuteId: 'min-1' }, { ...context, capabilities: [] }))
      .resolves.toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(repository.getMinuteDetail).not.toHaveBeenCalled()
  })

  it('treats a repository answer for a different minute as a data-source failure', async () => {
    const repository = repositoryWith({
      getMinuteDetail: vi.fn(async () => repositoryOk<MinuteDetailSnapshot | null>(detailSnapshot({
        minute: { ...minuteRecord({ id: 'min-other' }), bodyMd: '다른 회의록' },
      }))),
    })
    await expect(createGetMinuteDetailTool(repository).execute({ minuteId: 'min-1' }, context))
      .resolves.toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR', retryable: false } })
  })

  it('propagates the insight read failure code instead of hiding insights', async () => {
    const repository = repositoryWith({
      getMinuteDetail: vi.fn(async () =>
        repositoryError<MinuteDetailSnapshot | null>('MINUTE_INSIGHTS_READ_FAILED', true)),
    })
    await expect(createGetMinuteDetailTool(repository).execute({ minuteId: 'min-1' }, context))
      .resolves.toMatchObject({
        ok: false,
        error: { code: 'DATA_SOURCE_ERROR', repositoryErrorCode: 'MINUTE_INSIGHTS_READ_FAILED' },
      })
  })
})
