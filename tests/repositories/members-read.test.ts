import { describe, expect, it, vi } from 'vitest'
import { createSupabaseMemberRepository } from '@/lib/repositories/supabase/members'

type QueryResponse = { data: unknown; error: unknown }

function queryBuilder(response: QueryResponse) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'or', 'order', 'maybeSingle']) {
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

describe('strict Supabase member repository', () => {
  it('maps members without ever selecting email and never leaks the raw auth user id', async () => {
    const query = queryBuilder({
      data: [
        {
          id: 'member-1', project_id: 'p1', name: '김ERP', role: 'admin', title: 'ERP 리드',
          user_id: 'auth-user-secret-uuid', created_at: '2026-07-01T00:00:00Z', teams: { code: 'ERP' },
        },
        {
          id: 'member-2', project_id: 'p1', name: '박PMO', role: 'contributor', title: null,
          user_id: null, created_at: '2026-07-02T00:00:00Z', teams: [{ code: 'PMO' }],
        },
        {
          id: 'member-3', project_id: 'p1', name: '신입', role: 'contributor', title: null,
          user_id: null, created_at: '2026-07-03T00:00:00Z', teams: null,
        },
      ],
      error: null,
    })
    const from = vi.fn((table: string) => {
      if (table !== 'project_members') throw new Error(`unexpected table: ${table}`)
      return query
    })
    const repository = createSupabaseMemberRepository({ from } as never)

    const result = await repository.listMembers('p1')
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: 'member-1', projectId: 'p1', name: '김ERP', teamCode: 'ERP', role: 'admin',
          title: 'ERP 리드', hasAccount: true, createdAt: '2026-07-01T00:00:00Z',
        },
        {
          id: 'member-2', projectId: 'p1', name: '박PMO', teamCode: 'PMO', role: 'contributor',
          title: null, hasAccount: false, createdAt: '2026-07-02T00:00:00Z',
        },
        {
          id: 'member-3', projectId: 'p1', name: '신입', teamCode: null, role: 'contributor',
          title: null, hasAccount: false, createdAt: '2026-07-03T00:00:00Z',
        },
      ],
    })
    const select = query.select as ReturnType<typeof vi.fn>
    expect(select).toHaveBeenCalledOnce()
    expect(String(select.mock.calls[0][0])).not.toContain('email')
    expect(query.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: true })
    // user_id는 hasAccount 판정에만 쓰이고 원시값은 계약 밖으로 나가지 않는다.
    expect(JSON.stringify(result)).not.toContain('auth-user-secret-uuid')
    expect(JSON.stringify(result)).not.toMatch(/email/i)
  })

  it('keeps a valid zero-member project distinct from a query failure and performs SELECT only', async () => {
    const query = queryBuilder({ data: [], error: null })
    const from = vi.fn(() => query)
    const repository = createSupabaseMemberRepository({ from } as never)

    await expect(repository.listMembers('p1')).resolves.toEqual({ ok: true, data: [] })
    expect(from).toHaveBeenCalledTimes(1)
    for (const method of ['insert', 'upsert', 'update', 'delete']) {
      expect(query[method]).not.toHaveBeenCalled()
    }
  })

  it('surfaces a transient query failure as retryable MEMBERS_READ_FAILED', async () => {
    const repository = createSupabaseMemberRepository({
      from: vi.fn(() => queryBuilder({ data: null, error: { code: '08006' } })),
    } as never)

    await expect(repository.listMembers('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'MEMBERS_READ_FAILED',
      retryable: true,
    })
  })

  it('marks a schema failure as non-retryable instead of an empty member list', async () => {
    const repository = createSupabaseMemberRepository({
      from: vi.fn(() => queryBuilder({ data: null, error: { code: '42P01' } })),
    } as never)

    await expect(repository.listMembers('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'MEMBERS_READ_FAILED',
      retryable: false,
    })
  })
})
