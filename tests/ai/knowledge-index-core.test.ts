import { describe, expect, it } from 'vitest'
import { assessKnowledgeFreshness } from '@/lib/ai/index/freshness'
import {
  MAX_SCOPE_PROJECTS,
  mergeHybridResults,
  normalizeSearchQuery,
} from '@/lib/ai/index/hybrid'
import {
  indexJobBackoffMs,
  indexJobKey,
  isSafeIndexJobPayload,
  planIndexJobFailure,
  safeIndexJobErrorCode,
} from '@/lib/ai/index/jobs'
import type { IndexMutation, KnowledgeDocument } from '@/lib/ai/index/types'

function document(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: 'doc-1',
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
    indexedAt: '2026-07-19T02:00:00.000Z',
    ...overrides,
  }
}

describe('KnowledgeIndex query and hybrid contracts', () => {
  it('intersects requested projects, clamps filters, and never grants global implicitly', () => {
    const allowed = Array.from({ length: MAX_SCOPE_PROJECTS + 10 }, (_, index) => `p${index}`)
    const result = normalizeSearchQuery({
      text: 'ERP 위험 알려줘',
      projectIds: ['p2', 'outside'],
      includeGlobal: true,
      limit: 999,
      candidateLimit: 999,
    }, { allowedProjectIds: allowed })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.query.projectIds).toEqual(['p2'])
    expect(result.query.includeGlobal).toBe(false)
    expect(result.query.limit).toBe(20)
    expect(result.query.candidateLimit).toBe(100)
    expect(result.query.keywords).toContain('erp')
  })

  it('rejects wrong, non-finite, zero, or float4-overflow vectors before an adapter call', () => {
    expect(normalizeSearchQuery({ text: '', queryEmbedding: [0.1] }, {
      allowedProjectIds: ['p1'],
    })).toEqual({ ok: false, reason: 'invalid_embedding' })
    expect(normalizeSearchQuery({ text: '', queryEmbedding: Array(768).fill(Number.NaN) }, {
      allowedProjectIds: ['p1'],
    })).toEqual({ ok: false, reason: 'invalid_embedding' })
    expect(normalizeSearchQuery({ text: '', queryEmbedding: Array(768).fill(0) }, {
      allowedProjectIds: ['p1'],
    })).toEqual({ ok: false, reason: 'invalid_embedding' })
    expect(normalizeSearchQuery({ text: '', queryEmbedding: Array(768).fill(Number.MAX_VALUE) }, {
      allowedProjectIds: ['p1'],
    })).toEqual({ ok: false, reason: 'invalid_embedding' })
  })

  it('rejects fractional or PostgreSQL-int-overflow index versions', () => {
    expect(normalizeSearchQuery({ text: 'ERP', indexVersion: 1.5 }, {
      allowedProjectIds: ['p1'],
    })).toEqual({ ok: false, reason: 'invalid_index_version' })
    expect(normalizeSearchQuery({ text: 'ERP', indexVersion: 2_147_483_648 }, {
      allowedProjectIds: ['p1'],
    })).toEqual({ ok: false, reason: 'invalid_index_version' })
  })

  it('rejects impossible calendar dates and bounds keyword URL input before storage', () => {
    expect(normalizeSearchQuery({ text: 'ERP', dateFrom: '2026-99-99' }, {
      allowedProjectIds: ['p1'],
    })).toEqual({ ok: false, reason: 'invalid_date_range' })
    const result = normalizeSearchQuery({
      text: '',
      keywords: Array.from({ length: 100 }, (_, index) => `${'한'.repeat(80)}${index}`),
    }, { allowedProjectIds: ['p1'] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.query.keywords.reduce((sum, value) => sum + encodeURIComponent(value).length, 0))
        .toBeLessThanOrEqual(1_600)
    }
  })

  it('deduplicates the same stable chunk and boosts a keyword+vector match', () => {
    const olderPhysicalRow = document({ id: 'old-id', indexedAt: '2026-07-19T01:00:00.000Z' })
    const newerPhysicalRow = document({ id: 'new-id', indexedAt: '2026-07-19T03:00:00.000Z' })
    const results = mergeHybridResults(
      [{ document: olderPhysicalRow, score: 0.8 }],
      [{ document: newerPhysicalRow, score: 0.9 }],
      8,
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      document: { id: 'new-id' },
      keywordScore: 0.8,
      vectorScore: 0.9,
      matchedBy: ['keyword', 'vector'],
    })
    expect(results[0].score).toBeCloseTo(0.89)
  })
})

describe('KnowledgeIndex freshness and queue retry policies', () => {
  it('distinguishes missing timestamps from malformed or impossible calendar timestamps', () => {
    expect(assessKnowledgeFreshness({})).toEqual({
      stale: true,
      reason: 'missing_index_time',
    })
    expect(assessKnowledgeFreshness({ indexedAt: '2026-02-30T02:00:00.000Z' })).toEqual({
      stale: true,
      reason: 'invalid_index_time',
    })
    expect(assessKnowledgeFreshness({ indexedAt: '2026-07-19' })).toEqual({
      stale: true,
      reason: 'invalid_index_time',
    })

    const indexedAt = '2026-07-19T02:00:00.000Z'
    expect(assessKnowledgeFreshness({
      indexedAt,
      currentSourceUpdatedAt: 'July 19, 2026 03:00 UTC',
    })).toEqual({ stale: true, reason: 'invalid_source_update_time' })
    expect(assessKnowledgeFreshness({
      indexedAt,
      currentSourceUpdatedAt: '2026-02-30T03:00:00.000Z',
    })).toEqual({ stale: true, reason: 'invalid_source_update_time' })
  })

  it('treats an empty source update time as absent and accepts valid ISO offsets', () => {
    expect(assessKnowledgeFreshness({
      indexedAt: '2026-07-19T11:00:00.000+09:00',
      currentSourceUpdatedAt: '',
    })).toEqual({ stale: false, reason: 'fresh' })
    expect(assessKnowledgeFreshness({
      indexedAt: '2026-07-19T11:00:00+09:00',
      currentSourceUpdatedAt: '2026-07-19T02:00:00.000Z',
    })).toEqual({ stale: false, reason: 'fresh' })
    expect(assessKnowledgeFreshness({
      indexedAt: '2026-07-19T11:00:00+14:01',
    })).toEqual({ stale: true, reason: 'invalid_index_time' })
  })

  it('marks hash drift and a newer source as stale without reading storage', () => {
    expect(assessKnowledgeFreshness({
      indexedAt: '2026-07-19T02:00:00.000Z',
      indexedContentHash: 'old',
      currentContentHash: 'new',
    })).toEqual({ stale: true, reason: 'content_hash_mismatch' })

    expect(assessKnowledgeFreshness({
      indexedAt: '2026-07-19T02:00:00.000Z',
      currentSourceUpdatedAt: '2026-07-19T02:00:00.001Z',
    })).toEqual({ stale: true, reason: 'source_newer_than_index' })

    expect(assessKnowledgeFreshness({
      indexedAt: '2026-07-19T02:00:00.000Z',
      currentContentHash: 'new',
    })).toEqual({ stale: true, reason: 'missing_content_hash' })
  })

  it('supports an age policy while leaving fresh hashes usable', () => {
    expect(assessKnowledgeFreshness({
      indexedAt: '2026-07-19T02:00:00.000Z',
      indexedContentHash: 'same',
      currentContentHash: 'same',
    }, {
      now: new Date('2026-07-19T02:10:00.000Z'),
      maxAgeMs: 11 * 60_000,
    })).toEqual({ stale: false, reason: 'fresh' })
  })

  it('uses one entity key across upsert/delete so the newest operation replaces the old job', () => {
    const base = { projectId: 'p1', domain: 'wbs' as const, entityType: 'wbs_item' as const, entityId: 'w1' }
    const upsert: IndexMutation = { ...base, operation: 'upsert' }
    const remove: IndexMutation = { ...base, operation: 'delete' }
    expect(indexJobKey(upsert)).toBe(indexJobKey(remove))
  })

  it('backs off exponentially and dead-letters on the fifth failure', () => {
    expect(indexJobBackoffMs(1)).toBe(30_000)
    expect(indexJobBackoffMs(3)).toBe(120_000)
    expect(planIndexJobFailure(
      { attempts: 3 },
      'VECTOR_TIMEOUT',
      new Date('2026-07-19T00:00:00.000Z'),
    )).toMatchObject({
      status: 'pending',
      attempts: 4,
      runAfter: '2026-07-19T00:04:00.000Z',
      lastError: 'VECTOR_TIMEOUT',
    })
    expect(planIndexJobFailure(
      { attempts: 4 },
      'VECTOR_TIMEOUT',
      new Date('2026-07-19T00:00:00.000Z'),
    )).toMatchObject({
      status: 'dead_letter',
      attempts: 5,
      runAfter: '2026-07-19T00:00:00.000Z',
    })
  })

  it('does not persist raw error sentences or sensitive source-body payloads', () => {
    expect(safeIndexJobErrorCode('VECTOR_TIMEOUT')).toBe('VECTOR_TIMEOUT')
    expect(safeIndexJobErrorCode('failed: transcript contained secret')).toBe('INDEX_JOB_FAILED')
    expect(isSafeIndexJobPayload({ contentHash: 'sha256', indexVersion: 1 })).toBe(true)
    expect(isSafeIndexJobPayload({ body: '회의 원문' })).toBe(false)
  })
})
