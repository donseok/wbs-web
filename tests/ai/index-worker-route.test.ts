import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST } from '@/app/api/chat/index/worker/route'

const SECRET = 'test-cron-secret'

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/chat/index/worker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

type QueryResponse = { data: unknown; error: { code?: string } | null }

function queryBuilder(response: QueryResponse) {
  const builder: Record<string, unknown> = {}
  for (const method of [
    'select', 'upsert', 'update', 'delete', 'eq', 'in', 'is', 'gte', 'lte',
    'not', 'or', 'order', 'limit', 'maybeSingle',
  ]) builder[method] = vi.fn(() => builder)
  builder.then = (
    resolve: (value: QueryResponse) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject)
  return builder
}

function fakeAdmin(options: {
  tables?: Record<string, QueryResponse>
  rpc?: (name: string, args: Record<string, unknown>) => QueryResponse
} = {}) {
  return {
    from: vi.fn((table: string) => queryBuilder(
      options.tables?.[table] ?? { data: [], error: null },
    )),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) =>
      options.rpc?.(name, args) ?? { data: null, error: null },
    ),
  }
}

describe('POST /api/chat/index/worker gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'true')
    vi.stubEnv('CHAT_V2_INDEX_CRON_SECRET', SECRET)
    mocks.createAdminClient.mockReturnValue(fakeAdmin())
  })

  it('hides the route entirely while the worker flag is off', async () => {
    vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'false')
    const response = await POST(request({ mode: 'worker' }, { 'x-cron-secret': SECRET }))
    expect(response.status).toBe(404)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('hides the route when no cron secret is configured, even with a header', async () => {
    vi.stubEnv('CHAT_V2_INDEX_CRON_SECRET', '')
    const response = await POST(request({ mode: 'worker' }, { 'x-cron-secret': SECRET }))
    expect(response.status).toBe(404)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('rejects a wrong or missing secret with 403 before any DB access', async () => {
    const wrong = await POST(request({ mode: 'worker' }, { 'x-cron-secret': 'wrong' }))
    expect(wrong.status).toBe(403)
    const missing = await POST(request({ mode: 'worker' }))
    expect(missing.status).toBe(403)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('rejects an unknown mode, oversized batch, and missing domain for backfill', async () => {
    const badMode = await POST(request({ mode: 'drop' }, { 'x-cron-secret': SECRET }))
    expect(badMode.status).toBe(400)
    const badBatch = await POST(request({ mode: 'worker', batchSize: 10_000 }, { 'x-cron-secret': SECRET }))
    expect(badBatch.status).toBe(400)
    const noDomain = await POST(request({ mode: 'backfill' }, { 'x-cron-secret': SECRET }))
    expect(noDomain.status).toBe(400)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})

describe('POST /api/chat/index/worker execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'true')
    vi.stubEnv('CHAT_V2_INDEX_CRON_SECRET', SECRET)
  })

  it('runs one worker batch and returns the run summary', async () => {
    const admin = fakeAdmin({
      tables: { projects: { data: [{ id: 'p1' }], error: null } },
      rpc: name => (name === 'claim_ai_index_jobs' ? { data: [], error: null } : { data: null, error: null }),
    })
    mocks.createAdminClient.mockReturnValue(admin)

    const response = await POST(request({ mode: 'worker', batchSize: 5 }, { 'x-cron-secret': SECRET }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      mode: 'worker', claimed: 0, upserted: 0, deleted: 0, failed: 0, requeued: 0,
    })
    expect(admin.rpc).toHaveBeenCalledWith('claim_ai_index_jobs', { p_limit: 5, p_lease_seconds: 300 })
  })

  it('fails closed when the project scope cannot be resolved', async () => {
    mocks.createAdminClient.mockReturnValue(fakeAdmin({
      tables: { projects: { data: null, error: { code: '08006' } } },
    }))
    const response = await POST(request({ mode: 'worker' }, { 'x-cron-secret': SECRET }))
    expect(response.status).toBe(503)
  })

  it('reports a dry-run consistency check without enqueueing anything', async () => {
    const admin = fakeAdmin({
      tables: {
        projects: { data: [{ id: 'p1' }], error: null },
        wbs_items: {
          data: [{ id: 'w1', project_id: 'p1', updated_at: '2026-07-19T01:00:00.000Z' }],
          error: null,
        },
        ai_documents: { data: [], error: null },
      },
    })
    mocks.createAdminClient.mockReturnValue(admin)

    const response = await POST(request(
      { mode: 'consistency', domain: 'wbs', projectId: 'p1', dryRun: true },
      { 'x-cron-secret': SECRET },
    ))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      mode: 'consistency', checked: 1, planned: 1, enqueued: 0, enqueueErrorCode: null, dryRun: true,
    })
    // dryRun에서는 enqueue RPC가 호출되면 안 된다.
    expect(admin.rpc).not.toHaveBeenCalledWith('upsert_ai_index_jobs', expect.anything())
  })

  it('enqueues a backfill through the generation-aware RPC and hides internals on errors', async () => {
    const admin = fakeAdmin({
      tables: {
        projects: { data: [{ id: 'p1' }], error: null },
        wbs_items: {
          data: [{ id: 'w1', project_id: 'p1', updated_at: '2026-07-19T01:00:00.000Z' }],
          error: null,
        },
      },
      rpc: name => (name === 'upsert_ai_index_jobs' ? { data: 1, error: null } : { data: null, error: null }),
    })
    mocks.createAdminClient.mockReturnValue(admin)

    const response = await POST(request(
      { mode: 'backfill', domain: 'wbs', projectId: 'p1' },
      { 'x-cron-secret': SECRET },
    ))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      mode: 'backfill', planned: 1, enqueued: 1, batches: 1, dryRun: false,
    })

    // 내부 예외는 세부 정보 없이 일반화된 메시지로만 응답해야 한다.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error('내부 연결 문자열 secret')
    })
    const failed = await POST(request({ mode: 'worker' }, { 'x-cron-secret': SECRET }))
    expect(failed.status).toBe(500)
    const body = await failed.json() as { error: string }
    expect(body.error).toBe('색인 워커 실행에 실패했습니다.')
    expect(JSON.stringify(body)).not.toContain('secret')
    consoleError.mockRestore()
  })
})
