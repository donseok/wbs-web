import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  embedDocuments: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/ai/embeddings', () => ({ embedDocuments: mocks.embedDocuments }))

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

/**
 * repair 모드는 같은 테이블에 select(조회)와 update(개별 UPDATE)를 섞어 호출하므로
 * 위 queryBuilder(테이블당 고정 응답 1개)로는 표현이 안 된다 — 체인 종류로 분기하는 전용 픽스처.
 */
function repairAdmin(options: {
  selectResponse: QueryResponse
  updateResponse?: (id: string) => QueryResponse
}) {
  const updateIds: string[] = []
  const limitCalls: number[] = []
  const from = vi.fn((_table: string) => {
    let chain: 'select' | 'update' | null = null
    let updateId: string | undefined
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn(() => { chain = 'select'; return builder })
    builder.is = vi.fn(() => builder)
    builder.limit = vi.fn((count: number) => { limitCalls.push(count); return builder })
    builder.update = vi.fn(() => { chain = 'update'; return builder })
    builder.eq = vi.fn((_col: string, value: string) => {
      if (chain === 'update') { updateId = value; updateIds.push(value) }
      return builder
    })
    builder.then = (
      resolve: (value: QueryResponse) => unknown,
      reject: (reason: unknown) => unknown,
    ) => {
      const response = chain === 'update'
        ? (options.updateResponse?.(updateId as string) ?? { data: null, error: null })
        : options.selectResponse
      return Promise.resolve(response).then(resolve, reject)
    }
    return builder
  })
  return { from, rpc: vi.fn(), updateIds, limitCalls }
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

describe('POST /api/chat/index/worker repair mode (0085 클로버 복구)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'true')
    vi.stubEnv('CHAT_V2_INDEX_CRON_SECRET', SECRET)
  })

  it('uses the same gate as the other modes — flag off hides it, wrong secret is rejected', async () => {
    vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'false')
    const hidden = await POST(request({ mode: 'repair' }, { 'x-cron-secret': SECRET }))
    expect(hidden.status).toBe(404)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()

    vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'true')
    const rejected = await POST(request({ mode: 'repair' }, { 'x-cron-secret': 'wrong' }))
    expect(rejected.status).toBe(403)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('only UPDATEs rows whose embedding succeeded — failed items are left null, not overwritten', async () => {
    const admin = repairAdmin({
      selectResponse: {
        data: [{ id: 'a', content: '본문 A' }, { id: 'b', content: '본문 B' }],
        error: null,
      },
      updateResponse: () => ({ data: null, error: null }),
    })
    mocks.createAdminClient.mockReturnValue(admin)
    // a는 성공(벡터), b는 실패(null) — embedDocuments는 입력과 1:1 정렬로 반환한다.
    mocks.embedDocuments.mockResolvedValue([[0.1, 0.2], null])

    const response = await POST(request({ mode: 'repair' }, { 'x-cron-secret': SECRET }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      mode: 'repair', scanned: 2, repaired: 1, stillNull: 1,
    })
    // 실패한 b는 UPDATE 대상에 없어야 한다 — 이게 클로버 복구의 핵심 계약이다.
    expect(admin.updateIds).toEqual(['a'])
  })

  it('scans nothing when there is no null-embedding backlog', async () => {
    const admin = repairAdmin({ selectResponse: { data: [], error: null } })
    mocks.createAdminClient.mockReturnValue(admin)

    const response = await POST(request({ mode: 'repair' }, { 'x-cron-secret': SECRET }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      mode: 'repair', scanned: 0, repaired: 0, stillNull: 0,
    })
    expect(mocks.embedDocuments).not.toHaveBeenCalled()
  })

  it('clamps batchSize to the repair cap (100) and defaults to 20 when omitted', async () => {
    const admin = repairAdmin({ selectResponse: { data: [], error: null } })
    mocks.createAdminClient.mockReturnValue(admin)

    await POST(request({ mode: 'repair', batchSize: 200 }, { 'x-cron-secret': SECRET }))
    await POST(request({ mode: 'repair' }, { 'x-cron-secret': SECRET }))
    expect(admin.limitCalls).toEqual([100, 20])
  })

  it('fails closed (503) when the null-embedding scan itself errors', async () => {
    const admin = repairAdmin({ selectResponse: { data: null, error: { code: '08006' } } })
    mocks.createAdminClient.mockReturnValue(admin)

    const response = await POST(request({ mode: 'repair' }, { 'x-cron-secret': SECRET }))
    expect(response.status).toBe(503)
    expect(mocks.embedDocuments).not.toHaveBeenCalled()
  })

  it('reports everything as unrepaired (not silently "fixed") when no embedding key is configured', async () => {
    const admin = repairAdmin({
      selectResponse: { data: [{ id: 'a', content: '본문 A' }], error: null },
    })
    mocks.createAdminClient.mockReturnValue(admin)
    mocks.embedDocuments.mockResolvedValue(null) // 키 없음

    const response = await POST(request({ mode: 'repair' }, { 'x-cron-secret': SECRET }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      mode: 'repair', scanned: 1, repaired: 0, stillNull: 1,
    })
    expect(admin.updateIds).toEqual([])
  })
})
