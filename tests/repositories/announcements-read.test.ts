import { describe, expect, it, vi } from 'vitest'
import { createSupabaseAnnouncementRepository } from '@/lib/repositories/supabase/announcements'

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

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'a1', project_id: 'p1', title: '정기 점검 안내', body: '점검 안내 본문',
    category: 'important', is_pinned: true, publish_from: '2026-07-01', publish_to: '2026-07-31',
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-02T00:00:00Z', ...over,
  }
}

describe('strict Supabase announcement repository', () => {
  it('maps rows pinned-first and never touches the announcement_seen watermark', async () => {
    const query = queryBuilder({ data: [row()], error: null })
    const from = vi.fn((table: string) => {
      if (table !== 'announcements') throw new Error(`unexpected table: ${table}`)
      return query
    })
    const repository = createSupabaseAnnouncementRepository({ from } as never)

    await expect(repository.listAnnouncements('p1', 20)).resolves.toEqual({
      ok: true,
      data: {
        records: [{
          id: 'a1', projectId: 'p1', title: '정기 점검 안내', body: '점검 안내 본문',
          category: 'important', isPinned: true, publishFrom: '2026-07-01', publishTo: '2026-07-31',
          createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z',
        }],
        truncated: false,
      },
    })
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).not.toHaveBeenCalledWith('announcement_seen')
    expect(query.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(query.order).toHaveBeenNthCalledWith(1, 'is_pinned', { ascending: false })
    expect(query.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false })
    expect(query.limit).toHaveBeenCalledWith(21)
    for (const method of ['insert', 'upsert', 'update', 'delete']) {
      expect(query[method]).not.toHaveBeenCalled()
    }
  })

  it('valid zero announcements is a successful empty snapshot', async () => {
    const repository = createSupabaseAnnouncementRepository({
      from: vi.fn(() => queryBuilder({ data: [], error: null })),
    } as never)

    await expect(repository.listAnnouncements('p1', 20)).resolves.toEqual({
      ok: true,
      data: { records: [], truncated: false },
    })
  })

  it('read failure stays distinct from empty and keeps retryability', async () => {
    const transient = createSupabaseAnnouncementRepository({
      from: vi.fn(() => queryBuilder({ data: null, error: { code: '08006' } })),
    } as never)
    await expect(transient.listAnnouncements('p1', 20)).resolves.toEqual({
      ok: false,
      errorCode: 'ANNOUNCEMENTS_READ_FAILED',
      retryable: true,
    })

    const schema = createSupabaseAnnouncementRepository({
      from: vi.fn(() => queryBuilder({ data: null, error: { code: '42703' } })),
    } as never)
    await expect(schema.listAnnouncements('p1', 20)).resolves.toEqual({
      ok: false,
      errorCode: 'ANNOUNCEMENTS_READ_FAILED',
      retryable: false,
    })
  })

  it('rejects rows outside the requested project before exposing their content', async () => {
    const repository = createSupabaseAnnouncementRepository({
      from: vi.fn(() => queryBuilder({
        data: [row(), row({ id: 'a9', project_id: 'p2', title: '다른 프로젝트 공지' })],
        error: null,
      })),
    } as never)

    const result = await repository.listAnnouncements('p1', 20)
    expect(result).toEqual({
      ok: false,
      errorCode: 'ANNOUNCEMENTS_READ_FAILED',
      retryable: false,
    })
    expect(JSON.stringify(result)).not.toContain('다른 프로젝트 공지')
  })

  it('marks truncated when more rows exist than the requested limit', async () => {
    const query = queryBuilder({
      data: [row(), row({ id: 'a2', is_pinned: false }), row({ id: 'a3', is_pinned: false })],
      error: null,
    })
    const repository = createSupabaseAnnouncementRepository({ from: vi.fn(() => query) } as never)

    const result = await repository.listAnnouncements('p1', 2)
    expect(query.limit).toHaveBeenCalledWith(3)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.records.map(record => record.id)).toEqual(['a1', 'a2'])
      expect(result.data.truncated).toBe(true)
    }
  })
})
