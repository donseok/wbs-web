import { describe, expect, it, vi } from 'vitest'
import {
  createSupabaseIndexJobQueue,
  createSupabaseKnowledgeIndex,
} from '@/lib/ai/index/pgvector'
import type { KnowledgeDocumentInput } from '@/lib/ai/index/types'

type QueryResponse = { data: unknown; error: { code?: string; status?: number } | null }

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

function rawDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    project_id: 'p1',
    domain: 'minutes',
    entity_type: 'minute_block',
    entity_id: 'minute-1',
    chunk_no: 0,
    index_version: 1,
    title: 'ERP 결정사항',
    content: 'ERP 전환 일정을 확정했다.',
    content_hash: 'hash-1',
    href: '/minutes/minute-1',
    team: 'PI',
    occurred_on: '2026-07-19',
    source_updated_at: '2026-07-19T01:00:00.000Z',
    embedding_model: 'text-embedding',
    embedding_dimensions: 768,
    chunker_version: 'v1',
    indexed_at: '2026-07-19T02:00:00.000Z',
    ...overrides,
  }
}

function rawJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    job_key: 'v1:p1:wbs:wbs_item:w1',
    operation: 'upsert',
    project_id: 'p1',
    domain: 'wbs',
    entity_type: 'wbs_item',
    entity_id: 'w1',
    payload: { indexVersion: 1 },
    status: 'running',
    attempts: 1,
    run_after: '2026-07-19T00:00:00.000Z',
    locked_at: '2026-07-19T00:00:01.000Z',
    last_error: null,
    created_at: '2026-07-18T00:00:00.000Z',
    updated_at: '2026-07-19T00:00:01.000Z',
    generation: 3,
    ...overrides,
  }
}

function inputDocument(overrides: Partial<KnowledgeDocumentInput> = {}): KnowledgeDocumentInput {
  return {
    projectId: 'p1',
    domain: 'minutes',
    entityType: 'minute_block',
    entityId: 'minute-1',
    chunkNo: 0,
    indexVersion: 1,
    title: 'ERP 결정사항',
    content: 'ERP 전환 일정을 확정했다.',
    contentHash: 'hash-1',
    href: '/minutes/minute-1',
    team: 'PI',
    occurredOn: '2026-07-19',
    updatedAt: '2026-07-19T01:00:00.000Z',
    embeddingModel: 'text-embedding',
    embeddingDimensions: 768,
    chunkerVersion: 'v1',
    embedding: Array(768).fill(0.01),
    ...overrides,
  }
}

describe('Supabase pgvector KnowledgeIndex search adapter', () => {
  it('fails closed without an allowed project scope and performs no storage call', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() }
    const index = createSupabaseKnowledgeIndex(client as never, { allowedProjectIds: [], allowGlobal: true })

    await expect(index.search({ text: 'ERP', keywords: ['ERP'], includeGlobal: true })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(client.from).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('does not query when every client-requested project is outside the server scope', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() }
    const index = createSupabaseKnowledgeIndex(client as never, { allowedProjectIds: ['p1'] })

    await expect(index.search({
      text: 'ERP', keywords: ['ERP'], projectIds: ['outside'],
    })).resolves.toEqual({ ok: true, data: [] })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('keeps a healthy empty keyword result distinct from a read failure', async () => {
    const empty = queryBuilder({ data: [], error: null })
    const emptyIndex = createSupabaseKnowledgeIndex({
      from: vi.fn(() => empty), rpc: vi.fn(),
    } as never, { allowedProjectIds: ['p1'] })
    await expect(emptyIndex.search({ text: 'ERP', keywords: ['ERP'] })).resolves.toEqual({ ok: true, data: [] })

    const failed = queryBuilder({ data: null, error: { code: '08006' } })
    const failedIndex = createSupabaseKnowledgeIndex({
      from: vi.fn(() => failed), rpc: vi.fn(),
    } as never, { allowedProjectIds: ['p1'] })
    await expect(failedIndex.search({ text: 'ERP', keywords: ['ERP'] })).resolves.toEqual({
      ok: false,
      error: { code: 'INDEX_KEYWORD_READ_FAILED', operation: 'search_keyword', retryable: true },
    })
  })

  it('fails closed if storage returns a document outside the normalized scope', async () => {
    const query = queryBuilder({ data: [rawDocument({ project_id: 'p2' })], error: null })
    const index = createSupabaseKnowledgeIndex({
      from: vi.fn(() => query), rpc: vi.fn(),
    } as never, { allowedProjectIds: ['p1'] })

    await expect(index.search({ text: 'ERP', keywords: ['ERP'] })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INDEX_RESULT_INVALID', operation: 'search_keyword' },
    })
  })

  it('passes only the allowed project intersection to match_ai_documents and completes documents from the single RPC', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ ...rawDocument({ project_id: 'p2' }), similarity: 0.9 }],
      error: null,
    }))
    const from = vi.fn()
    const index = createSupabaseKnowledgeIndex({ from, rpc } as never, {
      allowedProjectIds: ['p1', 'p2'],
    })

    const result = await index.search({
      text: '',
      keywords: [],
      queryEmbedding: Array(768).fill(0.01),
      projectIds: ['p2', 'outside'],
      domains: ['minutes'],
      limit: 5,
    })

    expect(result).toMatchObject({
      ok: true,
      data: [{
        document: {
          id: 'doc-1',
          projectId: 'p2',
          contentHash: 'hash-1',
          embeddingModel: 'text-embedding',
          chunkerVersion: 'v1',
          indexedAt: '2026-07-19T02:00:00.000Z',
        },
        vectorScore: 0.9,
        matchedBy: ['vector'],
      }],
    })
    expect(rpc).toHaveBeenCalledWith('match_ai_documents', expect.objectContaining({
      p_project_ids: ['p2'],
      p_include_global: false,
      p_domains: ['minutes'],
      p_index_version: 1,
    }))
    // 하이드레이트 재조회 제거(리뷰 M-9) — 벡터 검색은 RPC 단일 호출로 끝나야 한다.
    expect(from).not.toHaveBeenCalled()
  })

  it('fails closed when the vector RPC returns a document outside the normalized scope', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ ...rawDocument({ project_id: 'p2' }), similarity: 0.9 }],
      error: null,
    }))
    const index = createSupabaseKnowledgeIndex({ from: vi.fn(), rpc } as never, { allowedProjectIds: ['p1'] })

    await expect(index.search({
      text: '', keywords: [], queryEmbedding: Array(768).fill(0.01),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INDEX_RESULT_INVALID', operation: 'search_vector' },
    })
  })

  it('rejects a vector RPC row that lacks the full document columns', async () => {
    // id+similarity만 돌려주는 옛 RPC 계약은 이제 무효 — 조용한 필드 유실 대신 실패한다.
    const rpc = vi.fn(async () => ({ data: [{ id: 'doc-1', similarity: 0.9 }], error: null }))
    const from = vi.fn()
    const index = createSupabaseKnowledgeIndex({ from, rpc } as never, { allowedProjectIds: ['p1'] })

    await expect(index.search({
      text: '', keywords: [], queryEmbedding: Array(768).fill(0.01),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INDEX_RESULT_INVALID', operation: 'search_vector' },
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('keeps a vector RPC failure distinct from a healthy zero-match RPC', async () => {
    const emptyIndex = createSupabaseKnowledgeIndex({
      from: vi.fn(),
      rpc: vi.fn(async () => ({ data: [], error: null })),
    } as never, { allowedProjectIds: ['p1'] })
    await expect(emptyIndex.search({
      text: '', keywords: [], queryEmbedding: Array(768).fill(0.01),
    })).resolves.toEqual({ ok: true, data: [] })

    const failedIndex = createSupabaseKnowledgeIndex({
      from: vi.fn(),
      rpc: vi.fn(async () => ({ data: null, error: { code: '08006' } })),
    } as never, { allowedProjectIds: ['p1'] })
    await expect(failedIndex.search({
      text: '', keywords: [], queryEmbedding: Array(768).fill(0.01),
    })).resolves.toEqual({
      ok: false,
      error: { code: 'INDEX_VECTOR_READ_FAILED', operation: 'search_vector', retryable: true },
    })
  })

  it('merges and deduplicates keyword and vector candidates from ai_documents', async () => {
    const keyword = queryBuilder({ data: [rawDocument()], error: null })
    const from = vi.fn(() => keyword)
    const rpc = vi.fn(async () => ({ data: [{ ...rawDocument(), similarity: 0.9 }], error: null }))
    const index = createSupabaseKnowledgeIndex({ from, rpc } as never, { allowedProjectIds: ['p1'] })

    const result = await index.search({
      text: 'ERP',
      keywords: ['ERP'],
      queryEmbedding: Array(768).fill(0.01),
    })

    expect(result).toMatchObject({
      ok: true,
      data: [{
        document: { id: 'doc-1' },
        keywordScore: 0.85,
        vectorScore: 0.9,
        matchedBy: ['keyword', 'vector'],
      }],
    })
    // 스토리지 테이블 조회는 키워드 경로 1회뿐 — 벡터 경로는 RPC 결과만 사용한다.
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('ai_documents')
  })

  it('rejects a malformed embedding before querying pgvector', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() }
    const index = createSupabaseKnowledgeIndex(client as never, { allowedProjectIds: ['p1'] })
    await expect(index.search({ text: '', queryEmbedding: [0.1] })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INDEX_QUERY_INVALID' },
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('rejects a zero query vector before querying pgvector', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() }
    const index = createSupabaseKnowledgeIndex(client as never, { allowedProjectIds: ['p1'] })
    await expect(index.search({ text: '', queryEmbedding: Array(768).fill(0) })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INDEX_QUERY_INVALID' },
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })
})

describe('Supabase KnowledgeIndex mutation and queue boundaries', () => {
  it('replaces all entity chunks through one atomic, generation-aware RPC', async () => {
    const rpc = vi.fn(async () => ({ data: 2, error: null }))
    const from = vi.fn()
    const index = createSupabaseKnowledgeIndex({ from, rpc } as never, {
      allowedProjectIds: ['p1'],
    }, { now: () => new Date('2026-07-19T03:00:00.000Z') })

    const result = await index.upsert([
      inputDocument({ chunkNo: 0 }),
      inputDocument({ chunkNo: 1, contentHash: 'hash-2' }),
    ], { replaceEntityChunks: true })

    expect(result).toEqual({ ok: true, data: { affected: 2 } })
    expect(rpc).toHaveBeenCalledWith('replace_ai_document_chunks', expect.objectContaining({
      p_project_id: 'p1',
      p_domain: 'minutes',
      p_entity_type: 'minute_block',
      p_entity_id: 'minute-1',
      p_index_version: 1,
      p_source_updated_at: '2026-07-19T01:00:00.000Z',
      p_indexed_at: '2026-07-19T03:00:00.000Z',
      p_documents: expect.arrayContaining([expect.objectContaining({
        project_id: 'p1',
        entity_type: 'minute_block',
        content_hash: 'hash-1',
        source_updated_at: '2026-07-19T01:00:00.000Z',
        embedding_dimensions: 768,
        indexed_at: '2026-07-19T03:00:00.000Z',
      })]),
    }))
    expect(from).not.toHaveBeenCalled()
  })

  it('blocks writes outside the injected scope before touching storage', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() }
    const index = createSupabaseKnowledgeIndex(client as never, { allowedProjectIds: ['p1'] })

    await expect(index.upsert([inputDocument({ projectId: 'p2' })])).resolves.toMatchObject({
      ok: false,
      error: { code: 'INDEX_ACCESS_DENIED' },
    })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('rejects zero vectors and impossible dates before touching storage', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() }
    const index = createSupabaseKnowledgeIndex(client as never, { allowedProjectIds: ['p1'] })
    await expect(index.upsert([inputDocument({ embedding: Array(768).fill(0) })]))
      .resolves.toMatchObject({ ok: false, error: { code: 'INDEX_QUERY_INVALID' } })
    await expect(index.upsert([inputDocument({ occurredOn: '2026-99-99' })]))
      .resolves.toMatchObject({ ok: false, error: { code: 'INDEX_QUERY_INVALID' } })
    await expect(index.upsert([inputDocument({ updatedAt: '2026-02-30T01:00:00.000Z' })]))
      .resolves.toMatchObject({ ok: false, error: { code: 'INDEX_QUERY_INVALID' } })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('reports a healthy zero-row delete separately from a delete error', async () => {
    const empty = queryBuilder({ data: [], error: null })
    const index = createSupabaseKnowledgeIndex({
      from: vi.fn(() => empty), rpc: vi.fn(),
    } as never, { allowedProjectIds: ['p1'] })
    await expect(index.delete({
      projectId: 'p1', domain: 'minutes', entityType: 'minute_block', entityId: 'minute-1', indexVersion: 1,
    })).resolves.toEqual({ ok: true, data: { affected: 0 } })

    const failed = queryBuilder({ data: null, error: { code: '42501' } })
    const failedIndex = createSupabaseKnowledgeIndex({
      from: vi.fn(() => failed), rpc: vi.fn(),
    } as never, { allowedProjectIds: ['p1'] })
    await expect(failedIndex.delete({
      projectId: 'p1', domain: 'minutes', entityType: 'minute_block', entityId: 'minute-1', indexVersion: 1,
    })).resolves.toMatchObject({ ok: false, error: { code: 'INDEX_DELETE_FAILED', retryable: false } })
  })

  it('treats an explicit empty chunk list as a no-op, never as an entity delete', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() }
    const index = createSupabaseKnowledgeIndex(client as never, { allowedProjectIds: ['p1'] })
    await expect(index.delete({
      projectId: 'p1', domain: 'minutes', entityType: 'minute_block',
      entityId: 'minute-1', indexVersion: 1, chunkNos: [],
    })).resolves.toEqual({ ok: true, data: { affected: 0 } })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('enqueues through the generation-aware RPC without storing source body text', async () => {
    // PostgREST upsert로는 conflict 시 generation+1이 불가하므로 반드시 RPC를 경유해야 한다.
    const rpc = vi.fn(async () => ({ data: 1, error: null }))
    const from = vi.fn()
    const queue = createSupabaseIndexJobQueue({ from, rpc } as never, { allowedProjectIds: ['p1'] })

    await expect(queue.enqueue([{
      operation: 'upsert',
      projectId: 'p1',
      domain: 'wbs',
      entityType: 'wbs_item',
      entityId: 'w1',
      payload: { contentHash: 'sha256', indexVersion: 1 },
    }])).resolves.toEqual({ ok: true, data: { affected: 1 } })
    expect(rpc).toHaveBeenCalledWith('upsert_ai_index_jobs', {
      p_jobs: [expect.objectContaining({
        job_key: 'v1:p1:wbs:wbs_item:w1',
        operation: 'upsert',
        payload: { contentHash: 'sha256', indexVersion: 1 },
        run_after: null,
      })],
    })
    expect(from).not.toHaveBeenCalled()

    await expect(queue.enqueue([{
      operation: 'upsert', projectId: 'p1', domain: 'wbs', entityType: 'wbs_item', entityId: 'w1',
      payload: { body: '민감한 업무 원문' },
    }])).resolves.toMatchObject({ ok: false, error: { code: 'INDEX_JOB_INVALID' } })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('deduplicates same-entity jobs within one batch using last-write-wins', async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }))
    const queue = createSupabaseIndexJobQueue({
      from: vi.fn(), rpc,
    } as never, { allowedProjectIds: ['p1'] })
    const base = {
      projectId: 'p1', domain: 'wbs' as const, entityType: 'wbs_item' as const, entityId: 'w1',
    }
    await expect(queue.enqueue([
      { ...base, operation: 'upsert' },
      { ...base, operation: 'delete' },
    ])).resolves.toEqual({ ok: true, data: { affected: 1 } })
    expect(rpc).toHaveBeenCalledWith('upsert_ai_index_jobs', {
      p_jobs: [expect.objectContaining({ operation: 'delete', job_key: 'v1:p1:wbs:wbs_item:w1' })],
    })
  })

  it('claims jobs atomically through the lease-aware RPC and maps generations', async () => {
    const rpc = vi.fn(async () => ({ data: [rawJob()], error: null }))
    const queue = createSupabaseIndexJobQueue({ from: vi.fn(), rpc } as never, { allowedProjectIds: ['p1'] })

    const result = await queue.claim(10, 300)
    expect(rpc).toHaveBeenCalledWith('claim_ai_index_jobs', { p_limit: 10, p_lease_seconds: 300 })
    expect(result).toMatchObject({
      ok: true,
      data: [{
        id: 7,
        jobKey: 'v1:p1:wbs:wbs_item:w1',
        operation: 'upsert',
        status: 'running',
        attempts: 1,
        generation: 3,
      }],
    })
  })

  it('fails closed when a claimed row lacks a generation or is not running', async () => {
    const noGeneration = createSupabaseIndexJobQueue({
      from: vi.fn(), rpc: vi.fn(async () => ({ data: [rawJob({ generation: undefined })], error: null })),
    } as never, { allowedProjectIds: ['p1'] })
    await expect(noGeneration.claim(10, 300)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INDEX_RESULT_INVALID', operation: 'claim' },
    })

    const notRunning = createSupabaseIndexJobQueue({
      from: vi.fn(), rpc: vi.fn(async () => ({ data: [rawJob({ status: 'pending' })], error: null })),
    } as never, { allowedProjectIds: ['p1'] })
    await expect(notRunning.claim(10, 300)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INDEX_RESULT_INVALID', operation: 'claim' },
    })
  })

  it('reports the complete CAS verdict so a superseded job counts as requeued', async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }))
    const queue = createSupabaseIndexJobQueue({ from: vi.fn(), rpc } as never, { allowedProjectIds: ['p1'] })
    await expect(queue.complete({ id: 7, generation: 3 })).resolves.toEqual({
      ok: true,
      data: { applied: false },
    })
    expect(rpc).toHaveBeenCalledWith('complete_ai_index_job', { p_id: 7, p_generation: 3 })
  })

  it('sends the planned backoff to the fail RPC with the claimed generation', async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }))
    const queue = createSupabaseIndexJobQueue({ from: vi.fn(), rpc } as never, { allowedProjectIds: ['p1'] })
    await expect(queue.fail(
      { id: 7, generation: 3, attempts: 1 },
      'INDEX_UPSERT_FAILED',
      new Date('2026-07-19T00:00:00.000Z'),
    )).resolves.toEqual({ ok: true, data: { applied: true } })
    expect(rpc).toHaveBeenCalledWith('fail_ai_index_job', {
      p_id: 7,
      p_generation: 3,
      p_attempts: 2,
      p_status: 'pending',
      p_run_after: '2026-07-19T00:01:00.000Z',
      p_last_error: 'INDEX_UPSERT_FAILED',
    })
  })

  it('persists only a safe retry code and moves the fifth failure to dead_letter', async () => {
    const retry = queryBuilder({ data: { id: 10 }, error: null })
    const queue = createSupabaseIndexJobQueue({
      from: vi.fn(() => retry), rpc: vi.fn(),
    } as never, { allowedProjectIds: ['p1'] })

    const result = await queue.recordFailure(
      { id: 10, attempts: 4, status: 'running' },
      'raw failure: transcript secret',
      new Date('2026-07-19T00:00:00.000Z'),
    )
    expect(result).toMatchObject({
      ok: true,
      data: { status: 'dead_letter', attempts: 5, lastError: 'INDEX_JOB_FAILED' },
    })
    expect(retry.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead_letter', attempts: 5, last_error: 'INDEX_JOB_FAILED', locked_at: null,
    }))
    expect(JSON.stringify((retry.update as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('transcript secret')
  })
})
