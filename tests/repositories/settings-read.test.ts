import { describe, expect, it, vi } from 'vitest'
import { createSupabaseProjectSettingsRepository } from '@/lib/repositories/supabase/settings'

type QueryResponse = { data: unknown; error: unknown; count?: number | null }

function queryBuilder(response: QueryResponse) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'or', 'order', 'maybeSingle']) {
    builder[method] = vi.fn(() => builder)
  }
  for (const method of ['insert', 'upsert', 'update', 'delete', 'rpc']) {
    builder[method] = vi.fn(() => { throw new Error(`write attempted: ${method}`) })
  }
  builder.then = (
    resolve: (value: QueryResponse) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject)
  return builder
}

function healthyBuilders(overrides: Partial<Record<string, QueryResponse>> = {}) {
  const responses: Record<string, QueryResponse> = {
    projects: {
      data: {
        id: 'p1', name: 'D-CUBE 구축', start_date: '2026-01-05', end_date: '2026-12-31',
        base_date: '2026-07-18', updated_at: '2026-07-19T00:00:00Z',
      },
      error: null,
    },
    holidays: { data: [{ date: '2026-08-15' }, { date: '2026-10-03' }], error: null },
    wbs_items: { data: null, error: null, count: 120 },
    project_members: { data: null, error: null, count: 14 },
    ...overrides,
  }
  const builders: Record<string, ReturnType<typeof queryBuilder>> = {}
  const from = vi.fn((table: string) => {
    const response = responses[table]
    if (!response) throw new Error(`unexpected table: ${table}`)
    builders[table] ??= queryBuilder(response)
    return builders[table]
  })
  return { from, builders }
}

describe('strict Supabase project settings repository', () => {
  it('maps project, holidays, and head counts without selecting any secret-shaped column', async () => {
    const { from, builders } = healthyBuilders()
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    const result = await repository.getSafeSettings('p1')
    expect(result).toEqual({
      ok: true,
      data: {
        projectId: 'p1',
        name: 'D-CUBE 구축',
        startDate: '2026-01-05',
        endDate: '2026-12-31',
        baseDate: '2026-07-18',
        holidays: ['2026-08-15', '2026-10-03'],
        wbsItemCount: 120,
        memberCount: 14,
        updatedAt: '2026-07-19T00:00:00Z',
      },
    })
    const projectSelect = builders.projects.select as ReturnType<typeof vi.fn>
    expect(String(projectSelect.mock.calls[0][0])).not.toMatch(/email|key|secret|token|env|account/i)
    expect(builders.projects.eq).toHaveBeenCalledWith('id', 'p1')
    expect(builders.wbs_items.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(builders.project_members.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(builders.wbs_items.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(builders.project_members.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(builders.holidays.eq).toHaveBeenCalledWith('project_id', 'p1')
    // 반환 계약에도 키·계정·환경변수 형태의 값이 존재하지 않는다.
    expect(JSON.stringify(result)).not.toMatch(/email|file_path|signed|secret|token|env/i)
    for (const builder of Object.values(builders)) {
      for (const method of ['insert', 'upsert', 'update', 'delete']) {
        expect(builder[method]).not.toHaveBeenCalled()
      }
    }
  })

  it('keeps an invisible project as a successful null, not an error', async () => {
    const { from } = healthyBuilders({ projects: { data: null, error: null } })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toEqual({ ok: true, data: null })
  })

  it('keeps a project with zero holidays, items, and members as a valid snapshot', async () => {
    const { from } = healthyBuilders({
      holidays: { data: [], error: null },
      wbs_items: { data: null, error: null, count: 0 },
      project_members: { data: null, error: null, count: 0 },
    })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toMatchObject({
      ok: true,
      data: { holidays: [], wbsItemCount: 0, memberCount: 0 },
    })
  })

  it('surfaces a project body failure as retryable PROJECT_SETTINGS_READ_FAILED', async () => {
    const { from } = healthyBuilders({ projects: { data: null, error: { code: '08006' } } })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'PROJECT_SETTINGS_READ_FAILED',
      retryable: true,
    })
  })

  it('keeps a holiday query failure distinct from an empty holiday list', async () => {
    const { from } = healthyBuilders({ holidays: { data: null, error: { code: '42P01' } } })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'PROJECT_HOLIDAYS_READ_FAILED',
      retryable: false,
    })
  })

  it('surfaces a head-count query failure as PROJECT_SETTINGS_COUNTS_READ_FAILED', async () => {
    const { from } = healthyBuilders({ project_members: { data: null, error: { code: '08006' } } })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'PROJECT_SETTINGS_COUNTS_READ_FAILED',
      retryable: true,
    })
  })

  it('never disguises a missing count as zero rows', async () => {
    const { from } = healthyBuilders({ wbs_items: { data: null, error: null, count: null } })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'PROJECT_SETTINGS_COUNTS_READ_FAILED',
      retryable: false,
    })
  })

  it('rejects a project row whose id widens the requested scope', async () => {
    const { from } = healthyBuilders({
      projects: {
        data: {
          id: 'p2', name: '다른 프로젝트', start_date: null, end_date: null,
          base_date: null, updated_at: null,
        },
        error: null,
      },
    })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    const result = await repository.getSafeSettings('p1')
    expect(result).toEqual({
      ok: false,
      errorCode: 'PROJECT_SETTINGS_READ_FAILED',
      retryable: false,
    })
    expect(JSON.stringify(result)).not.toContain('다른 프로젝트')
  })
})
