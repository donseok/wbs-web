import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActor: vi.fn() }))

import { getRecentUsageEvents } from '@/lib/data/usage'

type Result = {
  data: Array<Record<string, unknown>> | null
  error: { code?: string; message: string } | null
}

function builder(result: Result, eqCalls: Array<[string, unknown]>) {
  const query: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => Promise<unknown>
  } = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn((column: string, value: unknown) => { eqCalls.push([column, value]); return query })
  for (const method of ['gte', 'lt', 'order', 'limit']) query[method] = vi.fn(() => query)
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return query
}

describe('사용 로그 0079 이전 호환', () => {
  beforeEach(() => vi.clearAllMocks())

  it('event_name 컬럼이 없으면 모든 기존 행이 page view였던 레거시 조회로 한 번 재시도한다', async () => {
    const eqCalls: Array<Array<[string, unknown]>> = [[], []]
    const results: Result[] = [
      { data: null, error: { code: 'PGRST204', message: "Could not find the 'event_name' column" } },
      { data: [{
        id: 7, user_id: 'user-1', menu_key: 'wiki', path: '/p/:id/wiki',
        occurred_at: '2026-08-13T00:00:00.000Z',
      }], error: null },
    ]
    let call = 0
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn(() => builder(results[call], eqCalls[call++])),
    })

    const rows = await getRecentUsageEvents({ from: '2026-08-13', to: '2026-08-13', limit: 20 })

    expect(rows).toEqual([{
      id: 7, userId: 'user-1', menuKey: 'wiki', path: '/p/:id/wiki',
      occurredAt: '2026-08-13T00:00:00.000Z',
    }])
    expect(eqCalls[0]).toContainEqual(['event_name', 'page_view'])
    expect(eqCalls[1]).not.toContainEqual(['event_name', 'page_view'])
  })
})
