import { describe, expect, it, vi } from 'vitest'
import { createSupabaseMinutesRepository } from '@/lib/repositories/supabase/minutes'

type QueryResponse = { data: unknown; error: unknown }

function queryBuilder(response: QueryResponse) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'or', 'order', 'limit', 'maybeSingle']) {
    builder[method] = vi.fn(() => builder)
  }
  for (const method of ['insert', 'upsert', 'update', 'delete']) {
    builder[method] = vi.fn(() => { throw new Error(`write attempted: ${method}`) })
  }
  builder.then = (
    resolve: (value: QueryResponse) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject)
  return builder
}

function minuteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'min-1', minute_date: '2026-07-17', team_code: 'ERP', title: 'ERP 설계 회의록',
    meeting_id: 'meeting-1', created_by_name: '홍길동',
    created_at: '2026-07-17T01:00:00Z', updated_at: '2026-07-18T01:00:00Z',
    meetings: { project_id: 'p1' },
    ...overrides,
  }
}

describe('strict Supabase minutes repository', () => {
  it('searches with query/team/project/date filters and judges truncation by limit+1', async () => {
    const query = queryBuilder({
      data: [
        minuteRow(),
        minuteRow({ id: 'min-2', title: 'ERP 설계 후속', meetings: { project_id: 'p1' } }),
        minuteRow({ id: 'min-3', title: 'ERP 설계 초안' }),
      ],
      error: null,
    })
    const from = vi.fn(() => query)
    const repository = createSupabaseMinutesRepository({ from } as never)

    const result = await repository.searchMinutes({
      query: '설계', team: 'ERP', projectId: 'p1', from: '2026-04-21', to: '2026-07-20', limit: 2,
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        truncated: true,
        records: [
          {
            id: 'min-1', minuteDate: '2026-07-17', teamCode: 'ERP', title: 'ERP 설계 회의록',
            meetingId: 'meeting-1', meetingProjectId: 'p1', createdByName: '홍길동',
          },
          { id: 'min-2' },
        ],
      },
    })
    if (result.ok) expect(result.data.records).toHaveLength(2)

    const selected = String((query.select as ReturnType<typeof vi.fn>).mock.calls[0][0])
    // 프로젝트 필터는 inner 조인 — 회의 미연결 회의록은 제외된다.
    expect(selected).toContain('meetings!inner(project_id)')
    // 목록 select에는 본문·Storage 경로·원시 auth ID가 없어야 한다.
    expect(selected).not.toMatch(/body_md|file_path|created_by(?!_name)/)
    expect(query.or).toHaveBeenCalledWith('title.ilike."%설계%",body_md.ilike."%설계%"')
    expect(query.eq).toHaveBeenCalledWith('team_code', 'ERP')
    expect(query.eq).toHaveBeenCalledWith('meetings.project_id', 'p1')
    expect(query.gte).toHaveBeenCalledWith('minute_date', '2026-04-21')
    expect(query.lte).toHaveBeenCalledWith('minute_date', '2026-07-20')
    expect(query.limit).toHaveBeenCalledWith(3)
    for (const method of ['insert', 'upsert', 'update', 'delete']) {
      expect(query[method]).not.toHaveBeenCalled()
    }
  })

  it('keeps valid zero rows successful and uses a left join without a project filter', async () => {
    const query = queryBuilder({ data: [], error: null })
    const repository = createSupabaseMinutesRepository({ from: vi.fn(() => query) } as never)

    await expect(repository.searchMinutes({
      query: null, team: null, projectId: null, from: '2026-04-21', to: '2026-07-20', limit: 20,
    })).resolves.toEqual({ ok: true, data: { records: [], truncated: false } })

    const selected = String((query.select as ReturnType<typeof vi.fn>).mock.calls[0][0])
    expect(selected).toContain('meetings(project_id)')
    expect(selected).not.toContain('!inner')
    expect(query.or).not.toHaveBeenCalled()
    expect(query.eq).not.toHaveBeenCalled()
  })

  it('does not disguise a search failure as an empty archive', async () => {
    const query = queryBuilder({ data: null, error: { code: '08006' } })
    const repository = createSupabaseMinutesRepository({ from: vi.fn(() => query) } as never)

    await expect(repository.searchMinutes({
      query: '설계', team: null, projectId: null, from: null, to: null, limit: 20,
    })).resolves.toEqual({ ok: false, errorCode: 'MINUTES_READ_FAILED', retryable: true })
  })

  it('returns ok:null for a missing minute without touching insights/files tables', async () => {
    const minute = queryBuilder({ data: null, error: null })
    const from = vi.fn(() => minute)
    const repository = createSupabaseMinutesRepository({ from } as never)

    await expect(repository.getMinuteDetail('missing')).resolves.toEqual({ ok: true, data: null })
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('minutes')
  })

  it('reads detail with metadata-only files and no cross-table insight embed', async () => {
    const minute = queryBuilder({
      data: minuteRow({ body_md: '# 결정사항\n- ERP 인터페이스 확정' }),
      error: null,
    })
    const insights = queryBuilder({
      data: [{ kind: 'decision', label: '인터페이스 확정', block_index: 2 }],
      error: null,
    })
    const files = queryBuilder({
      data: [{
        file_name: '회의록.md', size: 512, mime: 'text/markdown',
        created_at: '2026-07-17T02:00:00Z', file_path: 'minutes/secret/path.md',
      }],
      error: null,
    })
    const from = vi.fn((table: string) => {
      if (table === 'minutes') return minute
      if (table === 'minute_insights') return insights
      return files
    })
    const repository = createSupabaseMinutesRepository({ from } as never)

    const result = await repository.getMinuteDetail('min-1')

    expect(result).toMatchObject({
      ok: true,
      data: {
        minute: {
          id: 'min-1', title: 'ERP 설계 회의록', meetingProjectId: 'p1',
          bodyMd: '# 결정사항\n- ERP 인터페이스 확정',
        },
        insights: [{ kind: 'decision', label: '인터페이스 확정', blockIndex: 2 }],
        files: [{ fileName: '회의록.md', size: 512, mime: 'text/markdown' }],
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/file_path|filePath|signed|secret|email/i)
    expect(String((files.select as ReturnType<typeof vi.fn>).mock.calls[0][0]))
      .toBe('file_name, size, mime, created_at')
    // 인사이트 임베드 금지 — 관계가 어긋나면 인사이트가 통째로 사라진 사고(0027) 재발 방지.
    expect(String((insights.select as ReturnType<typeof vi.fn>).mock.calls[0][0]))
      .toBe('kind, label, block_index')
    expect(insights.eq).toHaveBeenCalledWith('minute_id', 'min-1')
    expect(files.eq).toHaveBeenCalledWith('minute_id', 'min-1')
  })

  it('separates detail/insight/file read failures with distinct error codes', async () => {
    const failed = queryBuilder({ data: null, error: { code: '08006' } })
    const okMinute = () => queryBuilder({ data: minuteRow({ body_md: '본문' }), error: null })
    const okList = () => queryBuilder({ data: [], error: null })

    const detailFailed = createSupabaseMinutesRepository({ from: vi.fn(() => failed) } as never)
    await expect(detailFailed.getMinuteDetail('min-1')).resolves.toEqual({
      ok: false, errorCode: 'MINUTE_DETAIL_READ_FAILED', retryable: true,
    })

    const insightsFailed = createSupabaseMinutesRepository({
      from: vi.fn((table: string) => {
        if (table === 'minutes') return okMinute()
        if (table === 'minute_insights') return failed
        return okList()
      }),
    } as never)
    await expect(insightsFailed.getMinuteDetail('min-1')).resolves.toEqual({
      ok: false, errorCode: 'MINUTE_INSIGHTS_READ_FAILED', retryable: true,
    })

    const filesFailed = createSupabaseMinutesRepository({
      from: vi.fn((table: string) => {
        if (table === 'minutes') return okMinute()
        if (table === 'minute_insights') return okList()
        return failed
      }),
    } as never)
    await expect(filesFailed.getMinuteDetail('min-1')).resolves.toEqual({
      ok: false, errorCode: 'MINUTE_FILES_READ_FAILED', retryable: true,
    })
  })
})
