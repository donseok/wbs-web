import type { BotDomain, BotEntityType } from '@/lib/ai/chat/protocol'
import { CURRENT_INDEX_VERSION } from './content'
import { assessKnowledgeFreshness } from './freshness'
import { indexJobKey } from './jobs'
import type { SupabaseKnowledgeClient } from './pgvector'
import type { IndexMutation, IndexMutationSummary, KnowledgeIndexResult } from './types'

export const MAX_CONSISTENCY_MUTATIONS = 200
const MAX_SCAN_ENTITIES = 5_000

/** 원본 테이블에서 뽑은 엔티티 요약 — contentHash가 없으면 updatedAt만으로 비교한다. */
export interface IndexSourceSummary {
  projectId: string | null
  domain: BotDomain
  entityType: BotEntityType
  entityId: string
  updatedAt: string | null
  contentHash: string | null
}

/** ai_documents(chunk 0)에서 뽑은 색인 요약. */
export interface IndexedEntitySummary {
  projectId: string | null
  domain: BotDomain
  entityType: BotEntityType
  entityId: string
  contentHash: string | null
  indexedAt: string | null
}

export interface IndexConsistencyPlan {
  checked: number
  mutations: IndexMutation[]
}

export interface IndexConsistencyReport extends IndexConsistencyPlan {
  enqueued: number
  enqueueErrorCode: string | null
}

/**
 * 순수 정합성 비교 — 이벤트 누락을 보완한다(설계 §10.4).
 * 원본에 있는데 색인이 없거나 stale이면 upsert, 색인만 남았으면 delete 뮤테이션을 만든다.
 */
export function planIndexConsistency(input: {
  sources: readonly IndexSourceSummary[]
  indexed: readonly IndexedEntitySummary[]
  limit?: number
  now?: Date
  maxAgeMs?: number | null
}): IndexConsistencyPlan {
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? MAX_CONSISTENCY_MUTATIONS), MAX_CONSISTENCY_MUTATIONS))
  const sources = input.sources.slice(0, MAX_SCAN_ENTITIES)
  const indexed = input.indexed.slice(0, MAX_SCAN_ENTITIES)

  const indexedByKey = new Map<string, IndexedEntitySummary>()
  for (const entry of indexed) indexedByKey.set(indexJobKey(entry), entry)

  const mutations: IndexMutation[] = []
  const sourceKeys = new Set<string>()
  for (const source of sources) {
    const key = indexJobKey(source)
    sourceKeys.add(key)
    const entry = indexedByKey.get(key)
    const stale = !entry || assessKnowledgeFreshness({
      indexedAt: entry.indexedAt,
      indexedContentHash: entry.contentHash,
      currentSourceUpdatedAt: source.updatedAt,
      currentContentHash: source.contentHash,
    }, { now: input.now, maxAgeMs: input.maxAgeMs ?? null }).stale
    if (stale) {
      mutations.push({
        operation: 'upsert',
        projectId: source.projectId,
        domain: source.domain,
        entityType: source.entityType,
        entityId: source.entityId,
        payload: { reason: 'consistency' },
      })
    }
  }
  for (const entry of indexed) {
    if (sourceKeys.has(indexJobKey(entry))) continue
    mutations.push({
      operation: 'delete',
      projectId: entry.projectId,
      domain: entry.domain,
      entityType: entry.entityType,
      entityId: entry.entityId,
      payload: { reason: 'consistency_orphan', indexVersion: CURRENT_INDEX_VERSION },
    })
  }
  return { checked: sources.length + indexed.length, mutations: mutations.slice(0, limit) }
}

/** 정합성 비교 후 불일치 뮤테이션을 주입된 enqueue로 넘긴다. enqueue 실패는 코드로만 보고. */
export async function checkIndexConsistency(input: {
  sources: readonly IndexSourceSummary[]
  indexed: readonly IndexedEntitySummary[]
  enqueue?: (mutations: readonly IndexMutation[]) => Promise<KnowledgeIndexResult<IndexMutationSummary>>
  limit?: number
  now?: Date
  maxAgeMs?: number | null
}): Promise<IndexConsistencyReport> {
  const plan = planIndexConsistency(input)
  if (!input.enqueue || plan.mutations.length === 0) {
    return { ...plan, enqueued: 0, enqueueErrorCode: null }
  }
  const result = await input.enqueue(plan.mutations)
  if (!result.ok) return { ...plan, enqueued: 0, enqueueErrorCode: result.error.code }
  return { ...plan, enqueued: result.data.affected ?? plan.mutations.length, enqueueErrorCode: null }
}

export type IndexedSummaryListResult =
  | { ok: true; data: IndexedEntitySummary[] }
  | { ok: false; errorCode: string; retryable: boolean }

const DOMAIN_RE = /^[a-z_]{1,32}$/

/**
 * Supabase 조회 어댑터 — 엔티티 대표 행(chunk 0)만 읽어 색인 요약을 만든다.
 * service-role 경로 전용(워커 라우트에서만 조립).
 */
export async function listIndexedEntitySummaries(
  client: SupabaseKnowledgeClient,
  filter: { domain: BotDomain; projectId?: string | null; limit?: number },
): Promise<IndexedSummaryListResult> {
  if (!DOMAIN_RE.test(filter.domain)) return { ok: false, errorCode: 'INDEX_CONSISTENCY_FILTER_INVALID', retryable: false }
  let query = client.from('ai_documents')
    .select('project_id, domain, entity_type, entity_id, content_hash, indexed_at')
    .eq('domain', filter.domain)
    .eq('chunk_no', 0)
    .eq('index_version', CURRENT_INDEX_VERSION)
  if (filter.projectId === null) query = query.is('project_id', null)
  else if (typeof filter.projectId === 'string') query = query.eq('project_id', filter.projectId)
  const { data, error } = await query.limit(Math.max(1, Math.min(filter.limit ?? MAX_SCAN_ENTITIES, MAX_SCAN_ENTITIES)))
  if (error) return { ok: false, errorCode: 'INDEX_CONSISTENCY_READ_FAILED', retryable: true }
  if (!Array.isArray(data)) return { ok: false, errorCode: 'INDEX_CONSISTENCY_READ_FAILED', retryable: false }

  const summaries: IndexedEntitySummary[] = []
  for (const value of data) {
    if (!value || typeof value !== 'object') {
      return { ok: false, errorCode: 'INDEX_CONSISTENCY_ROW_INVALID', retryable: false }
    }
    const row = value as Record<string, unknown>
    if (typeof row.entity_id !== 'string' || typeof row.entity_type !== 'string' || row.domain !== filter.domain) {
      return { ok: false, errorCode: 'INDEX_CONSISTENCY_ROW_INVALID', retryable: false }
    }
    summaries.push({
      projectId: typeof row.project_id === 'string' ? row.project_id : null,
      domain: filter.domain,
      entityType: row.entity_type as BotEntityType,
      entityId: row.entity_id,
      contentHash: typeof row.content_hash === 'string' ? row.content_hash : null,
      indexedAt: typeof row.indexed_at === 'string' ? row.indexed_at : null,
    })
  }
  return { ok: true, data: summaries }
}
