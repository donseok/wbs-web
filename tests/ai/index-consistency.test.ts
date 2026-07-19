import { describe, expect, it, vi } from 'vitest'
import {
  checkIndexConsistency,
  listIndexedEntitySummaries,
  planIndexConsistency,
  type IndexSourceSummary,
  type IndexedEntitySummary,
} from '@/lib/ai/index/consistency'
import { createSupabaseIndexSourceLister, runIndexBackfill } from '@/lib/ai/index/backfill'

function source(overrides: Partial<IndexSourceSummary> = {}): IndexSourceSummary {
  return {
    projectId: 'p1',
    domain: 'wbs',
    entityType: 'wbs_item',
    entityId: 'w1',
    updatedAt: '2026-07-19T01:00:00.000Z',
    contentHash: 'hash-1',
    ...overrides,
  }
}

function indexed(overrides: Partial<IndexedEntitySummary> = {}): IndexedEntitySummary {
  return {
    projectId: 'p1',
    domain: 'wbs',
    entityType: 'wbs_item',
    entityId: 'w1',
    contentHash: 'hash-1',
    indexedAt: '2026-07-19T02:00:00.000Z',
    ...overrides,
  }
}

describe('planIndexConsistency', () => {
  it('leaves a fresh entity alone and counts everything it checked', () => {
    const plan = planIndexConsistency({ sources: [source()], indexed: [indexed()] })
    expect(plan).toEqual({ checked: 2, mutations: [] })
  })

  it('enqueues an upsert for a source that is missing from the index', () => {
    const plan = planIndexConsistency({ sources: [source()], indexed: [] })
    expect(plan.mutations).toEqual([
      expect.objectContaining({ operation: 'upsert', entityId: 'w1', projectId: 'p1' }),
    ])
  })

  it('detects hash drift and source-newer-than-index drift as stale', () => {
    const hashDrift = planIndexConsistency({
      sources: [source({ contentHash: 'hash-2' })],
      indexed: [indexed()],
    })
    expect(hashDrift.mutations).toEqual([expect.objectContaining({ operation: 'upsert' })])

    const timeDrift = planIndexConsistency({
      sources: [source({ contentHash: null, updatedAt: '2026-07-19T03:00:00.000Z' })],
      indexed: [indexed()],
    })
    expect(timeDrift.mutations).toEqual([expect.objectContaining({ operation: 'upsert' })])
  })

  it('deletes an indexed entity whose source disappeared', () => {
    const plan = planIndexConsistency({
      sources: [],
      indexed: [indexed({ entityId: 'w-gone' })],
    })
    expect(plan.mutations).toEqual([
      expect.objectContaining({ operation: 'delete', entityId: 'w-gone' }),
    ])
  })

  it('treats different projects with the same entity id as different entities', () => {
    const plan = planIndexConsistency({
      sources: [source({ projectId: 'p1' })],
      indexed: [indexed({ projectId: 'p2' })],
    })
    expect(plan.mutations).toHaveLength(2)
    expect(plan.mutations).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'upsert', projectId: 'p1' }),
      expect.objectContaining({ operation: 'delete', projectId: 'p2' }),
    ]))
  })

  it('caps the mutation list at the requested limit', () => {
    const sources = Array.from({ length: 10 }, (_, index) => source({ entityId: `w${index}` }))
    const plan = planIndexConsistency({ sources, indexed: [], limit: 3 })
    expect(plan.mutations).toHaveLength(3)
  })
})

describe('checkIndexConsistency', () => {
  it('passes the drift mutations to the injected enqueue and reports the outcome', async () => {
    const enqueue = vi.fn(async () => ({ ok: true as const, data: { affected: 1 } }))
    const report = await checkIndexConsistency({
      sources: [source({ contentHash: 'hash-2' })],
      indexed: [indexed()],
      enqueue,
    })
    expect(enqueue).toHaveBeenCalledWith([expect.objectContaining({ operation: 'upsert', entityId: 'w1' })])
    expect(report).toMatchObject({ enqueued: 1, enqueueErrorCode: null })
  })

  it('reports an enqueue failure as a code instead of throwing', async () => {
    const report = await checkIndexConsistency({
      sources: [source()],
      indexed: [],
      enqueue: async () => ({
        ok: false as const,
        error: { code: 'INDEX_JOB_ENQUEUE_FAILED' as const, operation: 'enqueue' as const, retryable: true },
      }),
    })
    expect(report).toMatchObject({ enqueued: 0, enqueueErrorCode: 'INDEX_JOB_ENQUEUE_FAILED' })
  })

  it('never calls enqueue when everything is consistent', async () => {
    const enqueue = vi.fn(async () => ({ ok: true as const, data: { affected: 0 } }))
    await checkIndexConsistency({ sources: [source()], indexed: [indexed()], enqueue })
    expect(enqueue).not.toHaveBeenCalled()
  })
})

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

describe('listIndexedEntitySummaries adapter', () => {
  it('maps chunk-0 rows and keeps a read failure distinct from empty', async () => {
    const rows = [{
      project_id: 'p1', domain: 'wbs', entity_type: 'wbs_item', entity_id: 'w1',
      content_hash: 'hash-1', indexed_at: '2026-07-19T02:00:00.000Z',
    }]
    const okClient = { from: vi.fn(() => queryBuilder({ data: rows, error: null })), rpc: vi.fn() }
    await expect(listIndexedEntitySummaries(okClient as never, { domain: 'wbs' })).resolves.toEqual({
      ok: true,
      data: [{
        projectId: 'p1', domain: 'wbs', entityType: 'wbs_item', entityId: 'w1',
        contentHash: 'hash-1', indexedAt: '2026-07-19T02:00:00.000Z',
      }],
    })

    const failedClient = { from: vi.fn(() => queryBuilder({ data: null, error: { code: '08006' } })), rpc: vi.fn() }
    await expect(listIndexedEntitySummaries(failedClient as never, { domain: 'wbs' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'INDEX_CONSISTENCY_READ_FAILED',
    })
  })

  it('rejects rows from a different domain instead of trusting them', async () => {
    const rows = [{
      project_id: 'p1', domain: 'minutes', entity_type: 'minute', entity_id: 'm1',
      content_hash: null, indexed_at: null,
    }]
    const client = { from: vi.fn(() => queryBuilder({ data: rows, error: null })), rpc: vi.fn() }
    await expect(listIndexedEntitySummaries(client as never, { domain: 'wbs' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'INDEX_CONSISTENCY_ROW_INVALID',
    })
  })
})

describe('runIndexBackfill', () => {
  const listed = [
    source({ entityId: 'w1' }),
    source({ entityId: 'w2' }),
    source({ entityId: 'w3' }),
  ]

  it('enqueues upsert mutations in bounded batches', async () => {
    const enqueue = vi.fn(async (mutations: readonly unknown[]) => ({
      ok: true as const, data: { affected: mutations.length },
    }))
    const summary = await runIndexBackfill({
      domain: 'wbs',
      list: async () => ({ ok: true, data: listed }),
      enqueue,
      batchSize: 2,
    })
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(enqueue.mock.calls[0][0]).toHaveLength(2)
    expect(enqueue.mock.calls[1][0]).toHaveLength(1)
    expect(summary).toMatchObject({ planned: 3, enqueued: 3, batches: 2, dryRun: false })
  })

  it('plans without writing anything in dry-run mode', async () => {
    const enqueue = vi.fn(async () => ({ ok: true as const, data: { affected: 0 } }))
    const summary = await runIndexBackfill({
      domain: 'wbs',
      list: async () => ({ ok: true, data: listed }),
      enqueue,
      dryRun: true,
    })
    expect(enqueue).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ planned: 3, enqueued: 0, dryRun: true })
  })

  it('stops on the first failed batch and reports honest partial progress', async () => {
    const enqueue = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { affected: 2 } })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'INDEX_JOB_ENQUEUE_FAILED', operation: 'enqueue', retryable: true },
      })
    const summary = await runIndexBackfill({
      domain: 'wbs',
      list: async () => ({ ok: true, data: listed }),
      enqueue,
      batchSize: 2,
    })
    expect(summary).toMatchObject({ planned: 3, enqueued: 2, batches: 1, enqueueErrorCode: 'INDEX_JOB_ENQUEUE_FAILED' })
  })
})

describe('createSupabaseIndexSourceLister', () => {
  it('derives the minute project from its meeting and filters joined projects client-side', async () => {
    const rows = [
      { id: 'm1', updated_at: '2026-07-19T01:00:00.000Z', created_at: '2026-07-18T00:00:00.000Z', meetings: { project_id: 'p1' } },
      { id: 'm2', updated_at: null, created_at: '2026-07-18T00:00:00.000Z', meetings: null },
    ]
    const client = { from: vi.fn(() => queryBuilder({ data: rows, error: null })), rpc: vi.fn() }
    const lister = createSupabaseIndexSourceLister(client as never)

    const all = await lister('minutes')
    expect(all).toMatchObject({
      ok: true,
      data: [
        expect.objectContaining({ entityId: 'm1', projectId: 'p1', entityType: 'minute', updatedAt: '2026-07-19T01:00:00.000Z' }),
        expect.objectContaining({ entityId: 'm2', projectId: null, updatedAt: '2026-07-18T00:00:00.000Z' }),
      ],
    })

    const scoped = await lister('minutes', 'p1')
    if (!scoped.ok) throw new Error('열거가 실패했습니다.')
    expect(scoped.data.map(row => row.entityId)).toEqual(['m1'])
  })

  it('keeps a read failure distinct from an empty table', async () => {
    const client = { from: vi.fn(() => queryBuilder({ data: null, error: { code: '08006' } })), rpc: vi.fn() }
    const lister = createSupabaseIndexSourceLister(client as never)
    await expect(lister('wbs', 'p1')).resolves.toMatchObject({
      ok: false,
      errorCode: 'INDEX_BACKFILL_READ_FAILED',
    })
  })
})
