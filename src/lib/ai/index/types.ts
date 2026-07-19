import type { BotDomain, BotEntityType } from '@/lib/ai/chat/protocol'

export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 768 as const
export const MAX_SEARCH_RESULTS = 20
export const MAX_SEARCH_CANDIDATES = 100
export const MAX_INDEX_JOB_ATTEMPTS = 5

export interface KnowledgeDocument {
  id: string
  projectId: string | null
  domain: BotDomain
  entityType: BotEntityType
  entityId: string
  chunkNo: number
  indexVersion: number
  title: string
  content: string
  contentHash: string
  href: string
  team: string | null
  occurredOn: string | null
  /** The source row's update time (`ai_documents.source_updated_at`). */
  updatedAt: string | null
  embeddingModel: string
  embeddingDimensions: typeof KNOWLEDGE_EMBEDDING_DIMENSIONS
  chunkerVersion: string
  indexedAt: string
}

/** Write shape. The physical row id remains database-generated and stable on conflict. */
export interface KnowledgeDocumentInput extends Omit<KnowledgeDocument, 'id' | 'indexedAt'> {
  embedding: readonly number[] | null
}

export interface SearchQuery {
  text: string
  keywords?: readonly string[]
  queryEmbedding?: readonly number[] | null
  /** Requested project subset. The adapter must intersect this with its server-resolved scope. */
  projectIds?: readonly string[]
  includeGlobal?: boolean
  domains?: readonly BotDomain[]
  entityTypes?: readonly BotEntityType[]
  team?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  indexVersion?: number
  limit?: number
  candidateLimit?: number
}

export interface SearchResult {
  document: KnowledgeDocument
  /** Hybrid rank score in the inclusive range 0..1. */
  score: number
  keywordScore: number | null
  vectorScore: number | null
  matchedBy: Array<'keyword' | 'vector'>
}

export type IndexJobPayloadValue = string | number | boolean | null
export type IndexJobPayload = Record<string, IndexJobPayloadValue>

/** Entity-level mutation queued after a business record changes. */
export interface IndexMutation {
  operation: 'upsert' | 'delete'
  projectId: string | null
  domain: BotDomain
  entityType: BotEntityType
  entityId: string
  /** Metadata only (for example contentHash/indexVersion), never source body text. */
  payload?: IndexJobPayload
  runAfter?: string
}

export type IndexJobStatus = 'pending' | 'running' | 'done' | 'dead_letter'

/** Camel-case projection of the `ai_index_jobs` table in migration 0031. */
export interface IndexJob extends IndexMutation {
  id: string | number
  jobKey: string
  payload: IndexJobPayload
  status: IndexJobStatus
  attempts: number
  runAfter: string
  lockedAt: string | null
  /** A bounded diagnostic code, not a raw exception or source body. */
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface IndexDeleteSelector {
  projectId: string | null
  domain: BotDomain
  entityType: BotEntityType
  entityId: string
  indexVersion: number
  chunkNos?: readonly number[]
}

export interface IndexMutationSummary {
  affected: number | null
}

export interface KnowledgeIndexHealth {
  available: true
  checkedAt: string
}

export type KnowledgeIndexOperation =
  | 'search_keyword'
  | 'search_vector'
  | 'upsert'
  | 'delete'
  | 'health'
  | 'enqueue'
  | 'retry'
  | 'claim'
  | 'complete'
  | 'fail'

export type KnowledgeIndexErrorCode =
  | 'INDEX_QUERY_INVALID'
  | 'INDEX_ACCESS_DENIED'
  | 'INDEX_RESULT_INVALID'
  | 'INDEX_KEYWORD_READ_FAILED'
  | 'INDEX_VECTOR_READ_FAILED'
  | 'INDEX_UPSERT_FAILED'
  | 'INDEX_STALE_CHUNK_DELETE_FAILED'
  | 'INDEX_DELETE_FAILED'
  | 'INDEX_HEALTH_FAILED'
  | 'INDEX_JOB_INVALID'
  | 'INDEX_JOB_ENQUEUE_FAILED'
  | 'INDEX_JOB_RETRY_FAILED'
  | 'INDEX_JOB_CONFLICT'
  | 'INDEX_JOB_CLAIM_FAILED'
  | 'INDEX_JOB_COMPLETE_FAILED'

export interface KnowledgeIndexError {
  code: KnowledgeIndexErrorCode
  operation: KnowledgeIndexOperation
  retryable: boolean
}

/** Healthy empty data and storage failures are deliberately different variants. */
export type KnowledgeIndexResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: KnowledgeIndexError }

export interface KnowledgeIndex {
  search(query: SearchQuery): Promise<KnowledgeIndexResult<SearchResult[]>>
  upsert(
    documents: readonly KnowledgeDocumentInput[],
    options?: { replaceEntityChunks?: boolean },
  ): Promise<KnowledgeIndexResult<IndexMutationSummary>>
  delete(selector: IndexDeleteSelector): Promise<KnowledgeIndexResult<IndexMutationSummary>>
  health(): Promise<KnowledgeIndexResult<KnowledgeIndexHealth>>
}

export interface IndexJobRetryUpdate {
  status: 'pending' | 'dead_letter'
  attempts: number
  runAfter: string
  lockedAt: null
  lastError: string
}

export interface IndexJobQueue {
  enqueue(mutations: readonly IndexMutation[]): Promise<KnowledgeIndexResult<IndexMutationSummary>>
  recordFailure(
    job: Pick<IndexJob, 'id' | 'attempts' | 'status'>,
    safeErrorCode: string,
    now?: Date,
  ): Promise<KnowledgeIndexResult<IndexJobRetryUpdate>>
}

/** 워커가 선점한 작업 — generation은 CAS 기준점(0033)이며 claim 시점 값으로 고정된다. */
export interface ClaimedIndexJob extends IndexJob {
  generation: number
}

/**
 * 워커 전용 큐 계약. claim/complete/fail 전부 0033 RPC로 원자 처리한다.
 * complete/fail의 `applied=false`는 처리 중 같은 job_key에 새 generation이
 * enqueue되었다는 뜻이고, 행은 서버에서 pending으로 복귀해 재처리된다.
 */
export interface IndexJobWorkerQueue extends IndexJobQueue {
  claim(limit: number, leaseSeconds: number): Promise<KnowledgeIndexResult<ClaimedIndexJob[]>>
  complete(job: Pick<ClaimedIndexJob, 'id' | 'generation'>): Promise<KnowledgeIndexResult<{ applied: boolean }>>
  fail(
    job: Pick<ClaimedIndexJob, 'id' | 'generation' | 'attempts'>,
    safeErrorCode: string,
    now?: Date,
  ): Promise<KnowledgeIndexResult<{ applied: boolean }>>
}

export interface IndexContentSnapshot {
  documents: KnowledgeDocumentInput[]
  sourceUpdatedAt: string | null
}

/**
 * 도메인 원본 → 색인 문서 로더. `data: null`은 "원본이 삭제됨"이라는 뜻이며 워커는
 * delete로 수렴한다(tombstone 규약). errorCode는 RepositoryErrorCode를 포함하는
 * 넓은 문자열 계약 — 큐에는 safeIndexJobErrorCode로 정제된 코드만 기록된다.
 */
export type IndexContentLoadResult =
  | { ok: true; data: IndexContentSnapshot | null }
  | { ok: false; errorCode: string; retryable: boolean }

export type IndexContentLoader = (job: ClaimedIndexJob) => Promise<IndexContentLoadResult>

export interface IndexWorkerRunSummary {
  claimed: number
  upserted: number
  deleted: number
  failed: number
  requeued: number
}
