import { BOT_DOMAINS, BOT_ENTITY_TYPES, type BotDomain, type BotEntityType } from '@/lib/ai/chat/protocol'
import { isValidKnowledgeTimestamp } from './freshness'
import {
  keywordCandidateScore,
  mergeHybridResults,
  normalizeSearchQuery,
  type HybridCandidate,
  type KnowledgeIndexAccessScope,
  type NormalizedSearchQuery,
} from './hybrid'
import { indexJobKey, isSafeIndexJobPayload, planIndexJobFailure } from './jobs'
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  type ClaimedIndexJob,
  type IndexDeleteSelector,
  type IndexJobPayload,
  type IndexJobWorkerQueue,
  type IndexMutationSummary,
  type KnowledgeDocument,
  type KnowledgeDocumentInput,
  type KnowledgeIndex,
  type KnowledgeIndexError,
  type KnowledgeIndexErrorCode,
  type KnowledgeIndexOperation,
  type KnowledgeIndexResult,
  type SearchQuery,
  type SearchResult,
} from './types'

type DbError = { code?: string | null; status?: number | null }
type DbResponse = { data: unknown; error: DbError | null }

/** Minimal structural client so an injected request client or service client can be used. */
export interface SupabaseKnowledgeQuery extends PromiseLike<DbResponse> {
  select(columns: string): SupabaseKnowledgeQuery
  upsert(values: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }): SupabaseKnowledgeQuery
  update(values: unknown): SupabaseKnowledgeQuery
  delete(): SupabaseKnowledgeQuery
  eq(column: string, value: unknown): SupabaseKnowledgeQuery
  in(column: string, values: readonly unknown[]): SupabaseKnowledgeQuery
  is(column: string, value: null): SupabaseKnowledgeQuery
  gte(column: string, value: unknown): SupabaseKnowledgeQuery
  lte(column: string, value: unknown): SupabaseKnowledgeQuery
  not(column: string, operator: string, value: unknown): SupabaseKnowledgeQuery
  or(filters: string): SupabaseKnowledgeQuery
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): SupabaseKnowledgeQuery
  limit(count: number): SupabaseKnowledgeQuery
  maybeSingle(): SupabaseKnowledgeQuery
}

export interface SupabaseKnowledgeClient {
  from(table: string): SupabaseKnowledgeQuery
  rpc(functionName: string, args: Record<string, unknown>): PromiseLike<DbResponse>
}

interface AdapterOptions {
  now?: () => Date
}

const DOCUMENT_COLUMNS = [
  'id', 'project_id', 'domain', 'entity_type', 'entity_id', 'chunk_no', 'index_version',
  'title', 'content', 'content_hash', 'href', 'team', 'occurred_on', 'source_updated_at',
  'embedding_model', 'embedding_dimensions', 'chunker_version', 'indexed_at',
].join(',')

// 어휘 사본을 두면 protocol.ts와 갈라져 유효 문서가 조용히 폐기된다(리뷰 M-1) — 단일 원천에서 파생.
const DOMAINS = new Set<BotDomain>(BOT_DOMAINS)
const ENTITY_TYPES = new Set<BotEntityType>(BOT_ENTITY_TYPES)
const MAX_INDEX_BATCH = 200
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_INT32 = 2_147_483_647
const MAX_FLOAT4 = 3.4028235e38
const MAX_DOCUMENT_CONTENT = 64_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRetryableDbError(error: DbError | null): boolean {
  if (!error) return true
  if (typeof error.status === 'number') return error.status >= 500
  if (typeof error.code !== 'string') return true
  if (/^(21|22|23|42)/.test(error.code)) return false
  if (/^PGRST(1|2)/.test(error.code)) return false
  return true
}

function failure<T>(
  code: KnowledgeIndexErrorCode,
  operation: KnowledgeIndexOperation,
  retryable: boolean,
): KnowledgeIndexResult<T> {
  return { ok: false, error: { code, operation, retryable } }
}

function queryFailure<T>(
  code: KnowledgeIndexErrorCode,
  operation: KnowledgeIndexOperation,
  error: DbError | null,
): KnowledgeIndexResult<T> {
  return failure(code, operation, isRetryableDbError(error))
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNullableString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === 'string' ? value : undefined
}

function validDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

function validTimestamp(value: string): boolean {
  return value.length <= 64 && isValidKnowledgeTimestamp(value)
}

function safeInternalHref(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return false
  try {
    return new URL(value, 'https://knowledge.invalid').origin === 'https://knowledge.invalid'
  } catch {
    return false
  }
}

function mapDocument(value: unknown): KnowledgeDocument | null {
  if (!isRecord(value)) return null
  const domain = asString(value.domain)
  const entityType = asString(value.entity_type)
  const projectId = asNullableString(value.project_id)
  const team = asNullableString(value.team)
  const occurredOn = asNullableString(value.occurred_on)
  const updatedAt = asNullableString(value.source_updated_at)
  if (
    !asString(value.id)
    || projectId === undefined
    || !domain || !DOMAINS.has(domain as BotDomain)
    || !entityType || !ENTITY_TYPES.has(entityType as BotEntityType)
    || !asString(value.entity_id)
    || !Number.isInteger(value.chunk_no) || Number(value.chunk_no) < 0 || Number(value.chunk_no) > MAX_INT32
    || !Number.isInteger(value.index_version) || Number(value.index_version) < 1 || Number(value.index_version) > MAX_INT32
    || typeof value.title !== 'string' || value.title.length > 500
    || typeof value.content !== 'string' || value.content.length > MAX_DOCUMENT_CONTENT
    || !asString(value.content_hash) || (value.content_hash as string).length > 256
    || typeof value.href !== 'string' || value.href.length > 2_048 || !safeInternalHref(value.href)
    || team === undefined || occurredOn === undefined || updatedAt === undefined
    || (occurredOn !== null && !validDate(occurredOn))
    || (updatedAt !== null && !validTimestamp(updatedAt))
    || !asString(value.embedding_model) || (value.embedding_model as string).length > 128
    || value.embedding_dimensions !== KNOWLEDGE_EMBEDDING_DIMENSIONS
    || !asString(value.chunker_version) || (value.chunker_version as string).length > 128
    || !asString(value.indexed_at) || !validTimestamp(value.indexed_at as string)
  ) return null

  return {
    id: value.id as string,
    projectId,
    domain: domain as BotDomain,
    entityType: entityType as BotEntityType,
    entityId: value.entity_id as string,
    chunkNo: value.chunk_no as number,
    indexVersion: value.index_version as number,
    title: value.title,
    content: value.content,
    contentHash: value.content_hash as string,
    href: value.href,
    team,
    occurredOn,
    updatedAt,
    embeddingModel: value.embedding_model as string,
    embeddingDimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
    chunkerVersion: value.chunker_version as string,
    indexedAt: value.indexed_at as string,
  }
}

function mapDocumentList(
  data: unknown,
  operation: 'search_keyword',
): KnowledgeIndexResult<KnowledgeDocument[]> {
  if (!Array.isArray(data)) return failure('INDEX_RESULT_INVALID', operation, false)
  const documents = data.map(mapDocument)
  if (documents.some(document => document == null)) {
    return failure('INDEX_RESULT_INVALID', operation, false)
  }
  return { ok: true, data: documents as KnowledgeDocument[] }
}

function quotedFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function applyProjectFilter(
  query: SupabaseKnowledgeQuery,
  scope: Pick<NormalizedSearchQuery, 'projectIds' | 'includeGlobal'>,
): SupabaseKnowledgeQuery {
  if (scope.includeGlobal && scope.projectIds.length === 0) return query.is('project_id', null)
  if (scope.includeGlobal) {
    const projectValues = scope.projectIds.map(quotedFilterValue).join(',')
    return query.or(`project_id.in.(${projectValues}),project_id.is.null`)
  }
  return query.in('project_id', scope.projectIds)
}

function applySearchFilters(
  query: SupabaseKnowledgeQuery,
  normalized: NormalizedSearchQuery,
): SupabaseKnowledgeQuery {
  let filtered = applyProjectFilter(query, normalized)
    .eq('index_version', normalized.indexVersion)
  if (normalized.domains.length) filtered = filtered.in('domain', normalized.domains)
  if (normalized.entityTypes.length) filtered = filtered.in('entity_type', normalized.entityTypes)
  if (normalized.team) filtered = filtered.eq('team', normalized.team)
  if (normalized.dateFrom) filtered = filtered.gte('occurred_on', normalized.dateFrom)
  if (normalized.dateTo) filtered = filtered.lte('occurred_on', normalized.dateTo)
  return filtered
}

function keywordOrFilter(keywords: readonly string[]): string {
  const clauses: string[] = []
  for (const keyword of keywords) {
    const escapedKeyword = keyword.replace(/([\\%_*])/g, '\\$1')
    const pattern = quotedFilterValue(`*${escapedKeyword}*`)
    clauses.push(`title.ilike.${pattern}`, `content.ilike.${pattern}`, `entity_id.ilike.${pattern}`)
  }
  return clauses.join(',')
}

function documentWriteRow(document: KnowledgeDocumentInput, indexedAt: string): Record<string, unknown> {
  return {
    project_id: document.projectId,
    domain: document.domain,
    entity_type: document.entityType,
    entity_id: document.entityId,
    chunk_no: document.chunkNo,
    index_version: document.indexVersion,
    title: document.title,
    content: document.content,
    content_hash: document.contentHash,
    href: document.href,
    team: document.team,
    occurred_on: document.occurredOn,
    source_updated_at: document.updatedAt,
    embedding_model: document.embeddingModel,
    embedding_dimensions: document.embeddingDimensions,
    chunker_version: document.chunkerVersion,
    embedding: document.embedding,
    indexed_at: indexedAt,
  }
}

function canAccessProject(projectId: string | null, scope: KnowledgeIndexAccessScope): boolean {
  const allowedProjectIds = scope.allowedProjectIds
    .map(id => id.trim())
    .filter(Boolean)
    .slice(0, 100)
  if (allowedProjectIds.length === 0) return false
  return projectId === null
    ? Boolean(scope.allowGlobal)
    : Boolean(projectId.trim() && allowedProjectIds.includes(projectId))
}

function documentMatchesSearchScope(
  document: KnowledgeDocument,
  query: NormalizedSearchQuery,
): boolean {
  if (document.projectId === null ? !query.includeGlobal : !query.projectIds.includes(document.projectId)) return false
  if (document.indexVersion !== query.indexVersion) return false
  if (query.domains.length && !query.domains.includes(document.domain)) return false
  if (query.entityTypes.length && !query.entityTypes.includes(document.entityType)) return false
  if (query.team && document.team !== query.team) return false
  if (query.dateFrom && (!document.occurredOn || document.occurredOn < query.dateFrom)) return false
  if (query.dateTo && (!document.occurredOn || document.occurredOn > query.dateTo)) return false
  return true
}

function validEmbedding(embedding: readonly number[] | null): boolean {
  return embedding === null || (
    embedding.length === KNOWLEDGE_EMBEDDING_DIMENSIONS
    && embedding.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_FLOAT4)
    && embedding.some(value => value !== 0)
  )
}

function validDocumentInput(document: KnowledgeDocumentInput): boolean {
  return Boolean(
    DOMAINS.has(document.domain)
    && ENTITY_TYPES.has(document.entityType)
    && document.entityId.trim() && document.entityId.length <= 256
    && Number.isInteger(document.chunkNo) && document.chunkNo >= 0 && document.chunkNo <= MAX_INT32
    && Number.isInteger(document.indexVersion) && document.indexVersion > 0 && document.indexVersion <= MAX_INT32
    && document.title.length <= 500
    && document.content.length <= MAX_DOCUMENT_CONTENT
    && document.contentHash.trim() && document.contentHash.length <= 256
    && document.href.length <= 2_048 && safeInternalHref(document.href)
    && document.embeddingModel.trim() && document.embeddingModel.length <= 128
    && document.chunkerVersion.trim() && document.chunkerVersion.length <= 128
    && document.embeddingDimensions === KNOWLEDGE_EMBEDDING_DIMENSIONS
    && validEmbedding(document.embedding)
    && (document.occurredOn == null || validDate(document.occurredOn))
    && (document.updatedAt == null || validTimestamp(document.updatedAt))
  )
}

function mutationError(code: KnowledgeIndexErrorCode, operation: KnowledgeIndexOperation): KnowledgeIndexError {
  return { code, operation, retryable: false }
}

export function createSupabaseKnowledgeIndex(
  client: SupabaseKnowledgeClient,
  accessScope: KnowledgeIndexAccessScope,
  options: AdapterOptions = {},
): KnowledgeIndex {
  const now = options.now ?? (() => new Date())

  async function keywordSearch(normalized: NormalizedSearchQuery): Promise<KnowledgeIndexResult<HybridCandidate[]>> {
    if (!normalized.keywords.length) return { ok: true, data: [] }
    let query = client.from('ai_documents').select(DOCUMENT_COLUMNS)
    query = applySearchFilters(query, normalized)
      .or(keywordOrFilter(normalized.keywords))
      .order('source_updated_at', { ascending: false, nullsFirst: false })
      .limit(normalized.candidateLimit)
    const { data, error } = await query
    if (error) return queryFailure('INDEX_KEYWORD_READ_FAILED', 'search_keyword', error)
    const mapped = mapDocumentList(data, 'search_keyword')
    if (!mapped.ok) return mapped
    if (mapped.data.some(document => !documentMatchesSearchScope(document, normalized))) {
      return failure('INDEX_RESULT_INVALID', 'search_keyword', false)
    }
    return {
      ok: true,
      data: mapped.data.map(document => ({
        document,
        score: keywordCandidateScore(document, normalized.keywords),
      })),
    }
  }

  async function vectorSearch(normalized: NormalizedSearchQuery): Promise<KnowledgeIndexResult<HybridCandidate[]>> {
    if (!normalized.queryEmbedding) return { ok: true, data: [] }
    const { data, error } = await client.rpc('match_ai_documents', {
      query_embedding: normalized.queryEmbedding,
      match_count: normalized.candidateLimit,
      p_project_ids: normalized.projectIds,
      p_include_global: normalized.includeGlobal,
      p_domains: normalized.domains.length ? normalized.domains : null,
      p_entity_types: normalized.entityTypes.length ? normalized.entityTypes : null,
      p_team: normalized.team,
      p_date_from: normalized.dateFrom,
      p_date_to: normalized.dateTo,
      p_index_version: normalized.indexVersion,
    })
    if (error) return queryFailure('INDEX_VECTOR_READ_FAILED', 'search_vector', error)
    if (!Array.isArray(data)) return failure('INDEX_RESULT_INVALID', 'search_vector', false)

    // 0031의 match_ai_documents가 mapDocument 요구 컬럼 전부를 반환하므로
    // RPC 단일 호출로 문서를 완성한다 — 2차 하이드레이트 재조회 금지(리뷰 M-9).
    const candidates: HybridCandidate[] = []
    for (const row of data) {
      if (!isRecord(row) || typeof row.similarity !== 'number' || !Number.isFinite(row.similarity)) {
        return failure('INDEX_RESULT_INVALID', 'search_vector', false)
      }
      const document = mapDocument(row)
      if (!document || !documentMatchesSearchScope(document, normalized)) {
        return failure('INDEX_RESULT_INVALID', 'search_vector', false)
      }
      candidates.push({ document, score: Math.max(0, Math.min(row.similarity, 1)) })
    }
    return { ok: true, data: candidates }
  }

  return {
    async search(input: SearchQuery): Promise<KnowledgeIndexResult<SearchResult[]>> {
      const normalized = normalizeSearchQuery(input, accessScope)
      if (!normalized.ok) return failure('INDEX_QUERY_INVALID', 'search_keyword', false)
      // Even global reads require a non-empty server-resolved project scope.
      if (!normalized.hasAccessScope) return { ok: true, data: [] }
      if (!normalized.query.projectIds.length && !normalized.query.includeGlobal) {
        return { ok: true, data: [] }
      }
      if (!normalized.query.keywords.length && !normalized.query.queryEmbedding) {
        return { ok: true, data: [] }
      }

      const [keyword, vector] = await Promise.all([
        keywordSearch(normalized.query),
        vectorSearch(normalized.query),
      ])
      if (!keyword.ok) return keyword
      if (!vector.ok) return vector
      return {
        ok: true,
        data: mergeHybridResults(keyword.data, vector.data, normalized.query.limit),
      }
    },

    async upsert(documents, upsertOptions = {}): Promise<KnowledgeIndexResult<IndexMutationSummary>> {
      if (documents.length === 0) return { ok: true, data: { affected: 0 } }
      if (documents.length > MAX_INDEX_BATCH || documents.some(document => !validDocumentInput(document))) {
        return failure('INDEX_QUERY_INVALID', 'upsert', false)
      }
      if (documents.some(document => !canAccessProject(document.projectId, accessScope))) {
        return { ok: false, error: mutationError('INDEX_ACCESS_DENIED', 'upsert') }
      }

      const groups = new Map<string, KnowledgeDocumentInput[]>()
      for (const document of documents) {
        const key = [
          document.projectId ?? 'global', document.domain, document.entityType,
          document.entityId, document.indexVersion,
        ].join('\u001f')
        const group = groups.get(key) ?? []
        group.push(document)
        groups.set(key, group)
      }
      if (upsertOptions.replaceEntityChunks) {
        for (const group of groups.values()) {
          const chunks = group.map(document => document.chunkNo).sort((a, b) => a - b)
          const sourceTimes = new Set(group.map(document => document.updatedAt))
          if (chunks.some((chunk, index) => chunk !== index) || sourceTimes.size !== 1) {
            return failure('INDEX_QUERY_INVALID', 'upsert', false)
          }
        }
      }

      const indexedAt = now().toISOString()
      if (upsertOptions.replaceEntityChunks) {
        let affected = 0
        for (const group of groups.values()) {
          const first = group[0]
          const { data, error } = await client.rpc('replace_ai_document_chunks', {
            p_project_id: first.projectId,
            p_domain: first.domain,
            p_entity_type: first.entityType,
            p_entity_id: first.entityId,
            p_index_version: first.indexVersion,
            p_source_updated_at: first.updatedAt,
            p_indexed_at: indexedAt,
            p_documents: group.map(document => documentWriteRow(document, indexedAt)),
          })
          if (error) return queryFailure('INDEX_UPSERT_FAILED', 'upsert', error)
          if (typeof data !== 'number' || !Number.isInteger(data) || data < 0 || data > group.length) {
            return failure('INDEX_RESULT_INVALID', 'upsert', false)
          }
          affected += data
        }
        return { ok: true, data: { affected } }
      }

      const { error } = await client.from('ai_documents').upsert(
        documents.map(document => documentWriteRow(document, indexedAt)),
        {
          onConflict: 'project_scope,domain,entity_type,entity_id,chunk_no,index_version',
          ignoreDuplicates: false,
        },
      )
      if (error) return queryFailure('INDEX_UPSERT_FAILED', 'upsert', error)
      return { ok: true, data: { affected: documents.length } }
    },

    async delete(selector: IndexDeleteSelector): Promise<KnowledgeIndexResult<IndexMutationSummary>> {
      if (
        !selector.entityId.trim() || selector.entityId.length > 256
        || !DOMAINS.has(selector.domain)
        || !ENTITY_TYPES.has(selector.entityType)
        || !Number.isInteger(selector.indexVersion) || selector.indexVersion < 1 || selector.indexVersion > MAX_INT32
        || (selector.chunkNos?.length ?? 0) > MAX_INDEX_BATCH
        || (selector.chunkNos?.some(chunk => !Number.isInteger(chunk) || chunk < 0 || chunk > MAX_INT32) ?? false)
      ) return failure('INDEX_QUERY_INVALID', 'delete', false)
      if (!canAccessProject(selector.projectId, accessScope)) {
        return failure('INDEX_ACCESS_DENIED', 'delete', false)
      }
      if (selector.chunkNos !== undefined && selector.chunkNos.length === 0) {
        return { ok: true, data: { affected: 0 } }
      }

      let query = client.from('ai_documents').delete()
        .eq('domain', selector.domain)
        .eq('entity_type', selector.entityType)
        .eq('entity_id', selector.entityId)
        .eq('index_version', selector.indexVersion)
      query = selector.projectId === null
        ? query.is('project_id', null)
        : query.eq('project_id', selector.projectId)
      if (selector.chunkNos?.length) query = query.in('chunk_no', selector.chunkNos.slice(0, MAX_INDEX_BATCH))
      const { data, error } = await query.select('id')
      if (error) return queryFailure('INDEX_DELETE_FAILED', 'delete', error)
      if (!Array.isArray(data)) return failure('INDEX_RESULT_INVALID', 'delete', false)
      return { ok: true, data: { affected: data.length } }
    },

    async health() {
      const { data, error } = await client.from('ai_documents').select('id').limit(1)
      if (error) return queryFailure('INDEX_HEALTH_FAILED', 'health', error)
      if (!Array.isArray(data)) return failure('INDEX_RESULT_INVALID', 'health', false)
      return { ok: true, data: { available: true, checkedAt: now().toISOString() } }
    },
  }
}

/** Explicit alias used by composition roots that select the current pgvector backend. */
export const createSupabasePgvectorKnowledgeIndex = createSupabaseKnowledgeIndex

function asJobPayload(value: unknown): IndexJobPayload | null {
  if (!isRecord(value)) return null
  return isSafeIndexJobPayload(value as IndexJobPayload) ? value as IndexJobPayload : null
}

/** claim RPC가 반환한 ai_index_jobs 행 → ClaimedIndexJob. 형이 어긋나면 null(fail-closed). */
function mapClaimedIndexJob(value: unknown): ClaimedIndexJob | null {
  if (!isRecord(value)) return null
  const projectId = asNullableString(value.project_id)
  const domain = asString(value.domain)
  const entityType = asString(value.entity_type)
  const payload = asJobPayload(value.payload)
  if (
    (typeof value.id !== 'string' && !Number.isInteger(value.id))
    || !asString(value.job_key)
    || (value.operation !== 'upsert' && value.operation !== 'delete')
    || projectId === undefined
    || !domain || !DOMAINS.has(domain as BotDomain)
    || !entityType || !ENTITY_TYPES.has(entityType as BotEntityType)
    || !asString(value.entity_id)
    || payload === null
    || value.status !== 'running'
    || !Number.isInteger(value.attempts) || Number(value.attempts) < 0
    || !asString(value.run_after)
    || asNullableString(value.locked_at) === undefined
    || asNullableString(value.last_error) === undefined
    || !asString(value.created_at) || !asString(value.updated_at)
    || !Number.isInteger(value.generation) || Number(value.generation) < 0
  ) return null

  return {
    id: value.id as string | number,
    jobKey: value.job_key as string,
    operation: value.operation,
    projectId,
    domain: domain as BotDomain,
    entityType: entityType as BotEntityType,
    entityId: value.entity_id as string,
    payload,
    status: 'running',
    attempts: value.attempts as number,
    runAfter: value.run_after as string,
    lockedAt: asNullableString(value.locked_at) ?? null,
    lastError: asNullableString(value.last_error) ?? null,
    createdAt: value.created_at as string,
    updatedAt: value.updated_at as string,
    generation: value.generation as number,
  }
}

const MAX_LEASE_SECONDS = 3_600

/**
 * Phase 2 워커 큐 어댑터. enqueue는 0033 upsert_ai_index_jobs RPC를 경유한다 —
 * PostgREST upsert로는 conflict 시 generation+1(CAS 기준점)을 만들 수 없다.
 */
export function createSupabaseIndexJobQueue(
  client: SupabaseKnowledgeClient,
  accessScope: KnowledgeIndexAccessScope,
  options: AdapterOptions = {},
): IndexJobWorkerQueue {
  const currentTime = options.now ?? (() => new Date())
  return {
    async enqueue(mutations) {
      if (mutations.length === 0) return { ok: true, data: { affected: 0 } }
      if (
        mutations.length > MAX_INDEX_BATCH
        || mutations.some(mutation =>
          !canAccessProject(mutation.projectId, accessScope)
          || (mutation.operation !== 'upsert' && mutation.operation !== 'delete')
          || !DOMAINS.has(mutation.domain)
          || !ENTITY_TYPES.has(mutation.entityType)
          || !mutation.entityId.trim() || mutation.entityId.length > 256
          || !isSafeIndexJobPayload(mutation.payload)
          || (mutation.runAfter != null && !validTimestamp(mutation.runAfter)),
        )
      ) return failure('INDEX_JOB_INVALID', 'enqueue', false)

      const uniqueMutations = new Map<string, (typeof mutations)[number]>()
      for (const mutation of mutations) uniqueMutations.set(indexJobKey(mutation), mutation)
      const rows = [...uniqueMutations.values()].map(mutation => ({
        job_key: indexJobKey(mutation),
        operation: mutation.operation,
        project_id: mutation.projectId,
        domain: mutation.domain,
        entity_type: mutation.entityType,
        entity_id: mutation.entityId,
        payload: mutation.payload ?? {},
        run_after: mutation.runAfter ?? null,
      }))
      const { data, error } = await client.rpc('upsert_ai_index_jobs', { p_jobs: rows })
      if (error) return queryFailure('INDEX_JOB_ENQUEUE_FAILED', 'enqueue', error)
      if (typeof data !== 'number' || !Number.isInteger(data) || data < 0 || data > rows.length) {
        return failure('INDEX_RESULT_INVALID', 'enqueue', false)
      }
      return { ok: true, data: { affected: data } }
    },

    async claim(limit, leaseSeconds) {
      if (
        !Number.isInteger(limit) || limit < 1
        || !Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > MAX_LEASE_SECONDS
      ) return failure('INDEX_JOB_INVALID', 'claim', false)
      const { data, error } = await client.rpc('claim_ai_index_jobs', {
        p_limit: Math.min(limit, MAX_INDEX_BATCH),
        p_lease_seconds: leaseSeconds,
      })
      if (error) return queryFailure('INDEX_JOB_CLAIM_FAILED', 'claim', error)
      if (!Array.isArray(data)) return failure('INDEX_RESULT_INVALID', 'claim', false)
      const jobs = data.map(mapClaimedIndexJob)
      if (jobs.some(job => job === null)) return failure('INDEX_RESULT_INVALID', 'claim', false)
      return { ok: true, data: jobs as ClaimedIndexJob[] }
    },

    async complete(job) {
      const { data, error } = await client.rpc('complete_ai_index_job', {
        p_id: job.id,
        p_generation: job.generation,
      })
      if (error) return queryFailure('INDEX_JOB_COMPLETE_FAILED', 'complete', error)
      if (typeof data !== 'boolean') return failure('INDEX_RESULT_INVALID', 'complete', false)
      return { ok: true, data: { applied: data } }
    },

    async fail(job, safeErrorCode, now = currentTime()) {
      if (!Number.isInteger(job.attempts) || job.attempts < 0) {
        return failure('INDEX_JOB_INVALID', 'fail', false)
      }
      // generation 일치를 가정한 백오프 계획을 보내면, RPC가 서버 현재 generation과
      // CAS 비교해 불일치 시 attempts 유지 + pending 복귀로 스스로 되돌린다(0033).
      const update = planIndexJobFailure({ attempts: job.attempts }, safeErrorCode, now)
      const { data, error } = await client.rpc('fail_ai_index_job', {
        p_id: job.id,
        p_generation: job.generation,
        p_attempts: update.attempts,
        p_status: update.status,
        p_run_after: update.runAfter,
        p_last_error: update.lastError,
      })
      if (error) return queryFailure('INDEX_JOB_RETRY_FAILED', 'fail', error)
      if (typeof data !== 'boolean') return failure('INDEX_RESULT_INVALID', 'fail', false)
      return { ok: true, data: { applied: data } }
    },

    async recordFailure(job, safeErrorCode, now = currentTime()) {
      if (job.status !== 'running' || !Number.isInteger(job.attempts) || job.attempts < 0) {
        return failure('INDEX_JOB_INVALID', 'retry', false)
      }
      const update = planIndexJobFailure(job, safeErrorCode, now)
      const { data, error } = await client.from('ai_index_jobs').update({
        status: update.status,
        attempts: update.attempts,
        run_after: update.runAfter,
        locked_at: null,
        last_error: update.lastError,
        updated_at: now.toISOString(),
      })
        .eq('id', job.id)
        .eq('status', 'running')
        .eq('attempts', job.attempts)
        .select('id')
        .maybeSingle()
      if (error) return queryFailure('INDEX_JOB_RETRY_FAILED', 'retry', error)
      if (!data) return failure('INDEX_JOB_CONFLICT', 'retry', false)
      return { ok: true, data: update }
    },
  }
}
