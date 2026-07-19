import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planIndexJobFailure } from '@/lib/ai/index/jobs'
import { createSupabaseIndexContentLoader } from '@/lib/ai/index/content'
import {
  INDEX_WORKER_DEFAULT_BATCH,
  INDEX_WORKER_DEFAULT_LEASE_SECONDS,
  runIndexWorkerOnce,
} from '@/lib/ai/index/worker'
import type {
  ClaimedIndexJob,
  IndexContentLoader,
  IndexJobWorkerQueue,
  KnowledgeDocumentInput,
  KnowledgeIndex,
} from '@/lib/ai/index/types'

function claimedJob(overrides: Partial<ClaimedIndexJob> = {}): ClaimedIndexJob {
  return {
    id: 7,
    jobKey: 'v1:p1:wbs:wbs_item:w1',
    operation: 'upsert',
    projectId: 'p1',
    domain: 'wbs',
    entityType: 'wbs_item',
    entityId: 'w1',
    payload: { indexVersion: 1 },
    status: 'running',
    attempts: 1,
    runAfter: '2026-07-19T00:00:00.000Z',
    lockedAt: '2026-07-19T00:00:01.000Z',
    lastError: null,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:01.000Z',
    generation: 3,
    ...overrides,
  }
}

function documentInput(overrides: Partial<KnowledgeDocumentInput> = {}): KnowledgeDocumentInput {
  return {
    projectId: 'p1',
    domain: 'wbs',
    entityType: 'wbs_item',
    entityId: 'w1',
    chunkNo: 0,
    indexVersion: 1,
    title: 'W1 항목',
    content: 'ERP 인터페이스 정의',
    contentHash: 'hash-1',
    href: '/p/p1/wbs?focus=w1',
    team: 'ERP',
    occurredOn: '2026-07-19',
    updatedAt: '2026-07-19T01:00:00.000Z',
    embeddingModel: 'text-embedding',
    embeddingDimensions: 768,
    chunkerVersion: 'md1500-v1',
    embedding: null,
    ...overrides,
  }
}

function fakeQueue(jobs: ClaimedIndexJob[]): IndexJobWorkerQueue {
  return {
    enqueue: vi.fn(async () => ({ ok: true as const, data: { affected: 0 } })),
    recordFailure: vi.fn(async () => ({ ok: false as const, error: { code: 'INDEX_JOB_INVALID' as const, operation: 'retry' as const, retryable: false } })),
    claim: vi.fn(async () => ({ ok: true as const, data: jobs })),
    complete: vi.fn(async () => ({ ok: true as const, data: { applied: true } })),
    fail: vi.fn(async () => ({ ok: true as const, data: { applied: true } })),
  }
}

function fakeIndex(): KnowledgeIndex {
  return {
    search: vi.fn(async () => ({ ok: true as const, data: [] })),
    upsert: vi.fn(async () => ({ ok: true as const, data: { affected: 1 } })),
    delete: vi.fn(async () => ({ ok: true as const, data: { affected: 1 } })),
    health: vi.fn(async () => ({ ok: true as const, data: { available: true as const, checkedAt: '2026-07-19T00:00:00.000Z' } })),
  }
}

const loaderWithDocuments: IndexContentLoader = async () => ({
  ok: true,
  data: { documents: [documentInput()], sourceUpdatedAt: '2026-07-19T01:00:00.000Z' },
})

describe('runIndexWorkerOnce', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('passes batch and lease bounds to claim and defaults them safely', async () => {
    const queue = fakeQueue([])
    await runIndexWorkerOnce({ queue, index: fakeIndex(), loadContent: loaderWithDocuments, batchSize: 5, leaseSeconds: 120 })
    expect(queue.claim).toHaveBeenCalledWith(5, 120)

    const defaulted = fakeQueue([])
    await runIndexWorkerOnce({ queue: defaulted, index: fakeIndex(), loadContent: loaderWithDocuments })
    expect(defaulted.claim).toHaveBeenCalledWith(INDEX_WORKER_DEFAULT_BATCH, INDEX_WORKER_DEFAULT_LEASE_SECONDS)
  })

  it('upserts loaded chunks atomically and completes with the claimed generation', async () => {
    const queue = fakeQueue([claimedJob()])
    const index = fakeIndex()

    const summary = await runIndexWorkerOnce({ queue, index, loadContent: loaderWithDocuments })

    expect(index.upsert).toHaveBeenCalledWith([expect.objectContaining({ entityId: 'w1' })], { replaceEntityChunks: true })
    expect(queue.complete).toHaveBeenCalledWith({ id: 7, generation: 3 })
    expect(summary).toEqual({ claimed: 1, upserted: 1, deleted: 0, failed: 0, requeued: 0 })
  })

  it('deletes every chunk for a delete job using the payload index version', async () => {
    const queue = fakeQueue([claimedJob({ operation: 'delete', payload: { indexVersion: 2 } })])
    const index = fakeIndex()

    const summary = await runIndexWorkerOnce({ queue, index, loadContent: loaderWithDocuments })

    expect(index.delete).toHaveBeenCalledWith({
      projectId: 'p1', domain: 'wbs', entityType: 'wbs_item', entityId: 'w1', indexVersion: 2,
    })
    expect(index.upsert).not.toHaveBeenCalled()
    expect(summary).toEqual({ claimed: 1, upserted: 0, deleted: 1, failed: 0, requeued: 0 })
  })

  it('converges an upsert whose source disappeared into a delete (tombstone rule)', async () => {
    // 구세대 upsert가 CAS로 재실행되면 로더가 원본 부재를 확인해 delete로 수렴해야 한다.
    const queue = fakeQueue([claimedJob()])
    const index = fakeIndex()
    const loadContent: IndexContentLoader = async () => ({ ok: true, data: null })

    const summary = await runIndexWorkerOnce({ queue, index, loadContent })

    expect(index.delete).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'w1', indexVersion: 1 }))
    expect(queue.complete).toHaveBeenCalledWith({ id: 7, generation: 3 })
    expect(summary).toEqual({ claimed: 1, upserted: 0, deleted: 1, failed: 0, requeued: 0 })
  })

  it('records a backoff failure with a sanitized code when the load fails', async () => {
    const queue = fakeQueue([claimedJob()])
    const index = fakeIndex()
    const now = new Date('2026-07-19T00:00:00.000Z')
    const loadContent: IndexContentLoader = async () => ({
      ok: false, errorCode: 'raw failure: secret transcript', retryable: true,
    })

    const summary = await runIndexWorkerOnce({ queue, index, loadContent, now })

    expect(queue.fail).toHaveBeenCalledWith({ id: 7, generation: 3, attempts: 1 }, 'INDEX_JOB_FAILED', now)
    expect(index.upsert).not.toHaveBeenCalled()
    expect(index.delete).not.toHaveBeenCalled()
    expect(summary).toEqual({ claimed: 1, upserted: 0, deleted: 0, failed: 1, requeued: 0 })
  })

  it('records an index write failure without completing the job', async () => {
    const queue = fakeQueue([claimedJob()])
    const index = fakeIndex()
    index.upsert = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'INDEX_UPSERT_FAILED' as const, operation: 'upsert' as const, retryable: true },
    }))

    const summary = await runIndexWorkerOnce({ queue, index, loadContent: loaderWithDocuments })

    expect(queue.fail).toHaveBeenCalledWith(
      { id: 7, generation: 3, attempts: 1 }, 'INDEX_UPSERT_FAILED', expect.any(Date),
    )
    expect(queue.complete).not.toHaveBeenCalled()
    expect(summary.failed).toBe(1)
  })

  it('counts a lost complete CAS as requeued, not done', async () => {
    const queue = fakeQueue([claimedJob()])
    queue.complete = vi.fn(async () => ({ ok: true as const, data: { applied: false } }))

    const summary = await runIndexWorkerOnce({ queue, index: fakeIndex(), loadContent: loaderWithDocuments })

    expect(summary).toEqual({ claimed: 1, upserted: 0, deleted: 0, failed: 0, requeued: 1 })
  })

  it('returns a zero summary when the claim itself fails', async () => {
    const queue = fakeQueue([])
    queue.claim = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'INDEX_JOB_CLAIM_FAILED' as const, operation: 'claim' as const, retryable: true },
    }))

    const summary = await runIndexWorkerOnce({ queue, index: fakeIndex(), loadContent: loaderWithDocuments })
    expect(summary).toEqual({ claimed: 0, upserted: 0, deleted: 0, failed: 0, requeued: 0 })
  })

  it('isolates one throwing job so the rest of the batch still processes', async () => {
    const queue = fakeQueue([claimedJob(), claimedJob({ id: 8, jobKey: 'v1:p1:wbs:wbs_item:w2', entityId: 'w2' })])
    const index = fakeIndex()
    const loadContent: IndexContentLoader = async job => {
      if (job.entityId === 'w1') throw new Error('예기치 못한 예외')
      return { ok: true, data: { documents: [documentInput({ entityId: 'w2' })], sourceUpdatedAt: null } }
    }

    const summary = await runIndexWorkerOnce({ queue, index, loadContent })
    expect(summary).toEqual({ claimed: 2, upserted: 1, deleted: 0, failed: 1, requeued: 0 })
  })
})

describe('planIndexJobFailure generation policy', () => {
  it('returns to pending without consuming attempts when the claimed generation is stale', () => {
    const update = planIndexJobFailure(
      { attempts: 4 },
      'INDEX_UPSERT_FAILED',
      new Date('2026-07-19T00:00:00.000Z'),
      { claimedGeneration: 3, currentGeneration: 4 },
    )
    expect(update).toEqual({
      status: 'pending',
      attempts: 4,
      runAfter: '2026-07-19T00:00:00.000Z',
      lockedAt: null,
      lastError: 'INDEX_UPSERT_FAILED',
    })
  })

  it('applies the normal backoff when the generation still matches', () => {
    const update = planIndexJobFailure(
      { attempts: 1 },
      'INDEX_UPSERT_FAILED',
      new Date('2026-07-19T00:00:00.000Z'),
      { claimedGeneration: 3, currentGeneration: 3 },
    )
    expect(update).toMatchObject({ status: 'pending', attempts: 2, runAfter: '2026-07-19T00:01:00.000Z' })
  })
})

describe('createSupabaseIndexContentLoader', () => {
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

  function clientFor(tables: Record<string, QueryResponse>) {
    return {
      from: vi.fn((table: string) => queryBuilder(tables[table] ?? { data: null, error: null })),
      rpc: vi.fn(),
    }
  }

  beforeEach(() => {
    // 키가 없으면 임베딩 호출 자체가 없어야 한다(keyword 폴백 계약) — 네트워크 금지.
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_API_KEY', '')
    vi.stubEnv('AI_PROVIDER', '')
  })

  it('returns null when the source row no longer exists', async () => {
    const loader = createSupabaseIndexContentLoader(clientFor({}) as never)
    await expect(loader(claimedJob())).resolves.toEqual({ ok: true, data: null })
  })

  it('builds contiguous chunks without account or author PII and keeps embeddings null without a key', async () => {
    const client = clientFor({
      minutes: {
        data: {
          id: 'm1',
          minute_date: '2026-07-18',
          team_code: 'ERP',
          title: 'ERP 정례회의록',
          body_md: '## 결정사항\nERP 전환 일정을 확정했다.',
          created_at: '2026-07-18T01:00:00.000Z',
          updated_at: '2026-07-18T02:00:00.000Z',
          created_by_name: '실명노출금지',
          meetings: { project_id: 'p1' },
        },
        error: null,
      },
    })
    const loader = createSupabaseIndexContentLoader(client as never)
    const result = await loader(claimedJob({
      domain: 'minutes', entityType: 'minute', entityId: 'm1', jobKey: 'v1:p1:minutes:minute:m1',
    }))

    expect(result.ok).toBe(true)
    if (!result.ok || !result.data) throw new Error('로더가 문서를 만들지 못했습니다.')
    expect(result.data.documents.length).toBeGreaterThan(0)
    expect(result.data.documents[0]).toMatchObject({
      projectId: 'p1',
      domain: 'minutes',
      entityType: 'minute',
      entityId: 'm1',
      chunkNo: 0,
      href: '/minutes/m1',
      team: 'ERP',
      occurredOn: '2026-07-18',
      updatedAt: '2026-07-18T02:00:00.000Z',
      embedding: null,
    })
    const allContent = result.data.documents.map(document => document.content).join('\n')
    expect(allContent).toContain('ERP 전환 일정')
    expect(allContent).not.toContain('실명노출금지')
  })

  it('fails closed when the loaded row belongs to a different project', async () => {
    const client = clientFor({
      meetings: {
        data: { id: 'mt1', project_id: 'p2', title: '주간회의', meeting_date: '2026-07-20', body: '' },
        error: null,
      },
    })
    const loader = createSupabaseIndexContentLoader(client as never)
    await expect(loader(claimedJob({
      domain: 'meetings', entityType: 'meeting', entityId: 'mt1',
    }))).resolves.toMatchObject({ ok: false, errorCode: 'INDEX_CONTENT_SCOPE_MISMATCH', retryable: false })
  })

  it('rejects unsupported entity types instead of treating them as deletions', async () => {
    const loader = createSupabaseIndexContentLoader(clientFor({}) as never)
    await expect(loader(claimedJob({ entityType: 'attachment' }))).resolves.toMatchObject({
      ok: false, errorCode: 'INDEX_CONTENT_UNSUPPORTED', retryable: false,
    })
  })
})

describe('0033 migration static audit', () => {
  const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
  const forward = readFileSync(join(migrationsDir, '0033_ai_index_worker.sql'), 'utf8')
  const rollback = readFileSync(join(migrationsDir, '0033_ai_index_worker_rollback.sql'), 'utf8')

  it('adds the generation CAS column and all four worker RPCs as service_role only', () => {
    expect(forward).toContain('add column if not exists generation bigint not null default 0')
    for (const fn of [
      'upsert_ai_index_jobs', 'claim_ai_index_jobs', 'complete_ai_index_job', 'fail_ai_index_job',
    ]) {
      expect(forward).toContain(`create or replace function public.${fn}`)
      expect(forward).toContain(`grant execute on function public.${fn}`)
    }
    expect(forward).toContain('for update skip locked')
    expect(forward).toContain('generation = public.ai_index_jobs.generation + 1')
    expect((forward.match(/revoke all on function/g) ?? []).length).toBe(4)
    expect(forward).not.toMatch(/grant .* to authenticated/)
  })

  it('keeps the rollback symmetric with the forward migration', () => {
    for (const fn of [
      'fail_ai_index_job', 'complete_ai_index_job', 'claim_ai_index_jobs', 'upsert_ai_index_jobs',
    ]) expect(rollback).toContain(`drop function if exists public.${fn}`)
    expect(rollback).toContain('drop column if exists generation')
    // 0031 소유 객체(테이블·검색 RPC)는 0033 롤백이 건드리면 안 된다.
    expect(rollback).not.toContain('drop table')
    expect(rollback).not.toContain('match_ai_documents')
    expect(rollback).not.toContain('replace_ai_document_chunks')
  })
})
