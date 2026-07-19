import {
  MAX_SEARCH_CANDIDATES,
  MAX_SEARCH_RESULTS,
  type KnowledgeDocument,
  type SearchQuery,
  type SearchResult,
} from './types'

export const MAX_SCOPE_PROJECTS = 100
export const MAX_SEARCH_KEYWORDS = 8
export const MAX_SEARCH_TEXT = 500
const MAX_FILTER_VALUES = 24
const MAX_KEYWORD_LENGTH = 80
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_KEYWORD_ENCODED_BYTES = 1_600
const MAX_INT32 = 2_147_483_647
const MAX_FLOAT4 = 3.4028235e38

export interface KnowledgeIndexAccessScope {
  allowedProjectIds: readonly string[]
  allowGlobal?: boolean
}

export interface NormalizedSearchQuery {
  text: string
  keywords: string[]
  queryEmbedding: readonly number[] | null
  projectIds: string[]
  includeGlobal: boolean
  domains: Array<NonNullable<SearchQuery['domains']>[number]>
  entityTypes: Array<NonNullable<SearchQuery['entityTypes']>[number]>
  team: string | null
  dateFrom: string | null
  dateTo: string | null
  indexVersion: number
  limit: number
  candidateLimit: number
}

export type SearchNormalizationResult =
  | { ok: true; query: NormalizedSearchQuery; hasAccessScope: boolean }
  | { ok: false; reason: 'invalid_embedding' | 'invalid_date_range' | 'invalid_index_version' }

const SEARCH_STOPWORDS = new Set([
  '알려줘', '보여줘', '찾아줘', '검색', '내용', '관련', '대한', '있는', '뭐야', '무엇',
  '이번', '현재', '정리', '요약', '프로젝트', '업무', '항목', '질문',
])

function boundedUnique(values: readonly string[] | undefined, max: number, maxLength = 256): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  // Do not scan an attacker-controlled unbounded array looking for enough unique values.
  for (const raw of (values ?? []).slice(0, max * 4)) {
    const value = raw.trim().slice(0, maxLength)
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (result.length >= max) break
  }
  return result
}

function validDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

function boundedKeywords(values: string[]): string[] {
  const out: string[] = []
  let used = 0
  for (const value of values) {
    const encoded = encodeURIComponent(value).length
    if (encoded > MAX_KEYWORD_ENCODED_BYTES || used + encoded > MAX_KEYWORD_ENCODED_BYTES) continue
    out.push(value)
    used += encoded
  }
  return out
}

export function deriveSearchKeywords(text: string, explicit?: readonly string[]): string[] {
  const supplied = boundedUnique(explicit, MAX_SEARCH_KEYWORDS, MAX_KEYWORD_LENGTH)
  if (supplied.length) return boundedKeywords(supplied)

  const boundedText = text.slice(0, MAX_SEARCH_TEXT)

  const quoted = [...boundedText.matchAll(/["'“”‘’]([^"'“”‘’]{1,80})["'“”‘’]/g)]
    .map(match => match[1]?.trim() ?? '')
    .filter(Boolean)
  if (quoted.length) return boundedKeywords(boundedUnique(quoted, MAX_SEARCH_KEYWORDS, MAX_KEYWORD_LENGTH))

  const tokens = boundedText
    .toLocaleLowerCase('ko-KR')
    .split(/[^\p{L}\p{N}_./+-]+/u)
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !SEARCH_STOPWORDS.has(token))
  return boundedKeywords(boundedUnique(tokens, MAX_SEARCH_KEYWORDS, MAX_KEYWORD_LENGTH))
}

export function normalizeSearchQuery(
  input: SearchQuery,
  scope: KnowledgeIndexAccessScope,
): SearchNormalizationResult {
  const allowed = boundedUnique(scope.allowedProjectIds, MAX_SCOPE_PROJECTS)
  const allowedSet = new Set(allowed)
  const requested = input.projectIds === undefined
    ? allowed
    : boundedUnique(input.projectIds, MAX_SCOPE_PROJECTS).filter(id => allowedSet.has(id))

  if (
    input.queryEmbedding != null
    && (
      !Array.isArray(input.queryEmbedding)
      || input.queryEmbedding.length !== 768
      || !input.queryEmbedding.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_FLOAT4)
      || !input.queryEmbedding.some(value => value !== 0)
    )
  ) {
    return { ok: false, reason: 'invalid_embedding' }
  }
  if ((input.dateFrom && !validDate(input.dateFrom)) || (input.dateTo && !validDate(input.dateTo))) {
    return { ok: false, reason: 'invalid_date_range' }
  }
  if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
    return { ok: false, reason: 'invalid_date_range' }
  }
  const rawIndexVersion = input.indexVersion ?? 1
  if (!Number.isInteger(rawIndexVersion) || rawIndexVersion < 1 || rawIndexVersion > MAX_INT32) {
    return { ok: false, reason: 'invalid_index_version' }
  }
  const indexVersion = rawIndexVersion

  const rawLimit = Number.isFinite(input.limit) ? input.limit as number : 8
  const limit = Math.max(1, Math.min(Math.floor(rawLimit), MAX_SEARCH_RESULTS))
  const rawCandidateLimit = Number.isFinite(input.candidateLimit)
    ? input.candidateLimit as number
    : Math.max(limit * 3, 20)
  const candidateLimit = Math.max(
    limit,
    Math.min(Math.floor(rawCandidateLimit), MAX_SEARCH_CANDIDATES),
  )

  return {
    ok: true,
    hasAccessScope: allowed.length > 0,
    query: {
      text: input.text.trim().slice(0, MAX_SEARCH_TEXT),
      keywords: deriveSearchKeywords(input.text, input.keywords),
      queryEmbedding: input.queryEmbedding ?? null,
      projectIds: requested,
      includeGlobal: Boolean(input.includeGlobal && scope.allowGlobal),
      domains: boundedUnique(input.domains, MAX_FILTER_VALUES) as NormalizedSearchQuery['domains'],
      entityTypes: boundedUnique(input.entityTypes, MAX_FILTER_VALUES) as NormalizedSearchQuery['entityTypes'],
      team: input.team?.trim().slice(0, 80) || null,
      dateFrom: input.dateFrom ?? null,
      dateTo: input.dateTo ?? null,
      indexVersion,
      limit,
      candidateLimit,
    },
  }
}

export interface HybridCandidate {
  document: KnowledgeDocument
  score: number
}

function stableDocumentKey(document: KnowledgeDocument): string {
  return [
    document.projectId ?? 'global',
    document.domain,
    document.entityType,
    document.entityId,
    document.chunkNo,
    document.indexVersion,
  ].join('\u001f')
}

function boundedScore(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0
}

/**
 * Deterministic weighted fusion. Stable document keys deduplicate rows even if
 * a future adapter uses different physical ids for the same logical chunk.
 */
export function mergeHybridResults(
  keywordCandidates: readonly HybridCandidate[],
  vectorCandidates: readonly HybridCandidate[],
  limit = 8,
): SearchResult[] {
  const merged = new Map<string, SearchResult>()
  const add = (candidate: HybridCandidate, kind: 'keyword' | 'vector') => {
    const key = stableDocumentKey(candidate.document)
    const score = boundedScore(candidate.score)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        document: candidate.document,
        score: 0,
        keywordScore: kind === 'keyword' ? score : null,
        vectorScore: kind === 'vector' ? score : null,
        matchedBy: [kind],
      })
      return
    }
    if (kind === 'keyword') existing.keywordScore = Math.max(existing.keywordScore ?? 0, score)
    else existing.vectorScore = Math.max(existing.vectorScore ?? 0, score)
    if (!existing.matchedBy.includes(kind)) existing.matchedBy.push(kind)
    if (candidate.document.indexedAt > existing.document.indexedAt) existing.document = candidate.document
  }

  keywordCandidates.slice(0, MAX_SEARCH_CANDIDATES).forEach(candidate => add(candidate, 'keyword'))
  vectorCandidates.slice(0, MAX_SEARCH_CANDIDATES).forEach(candidate => add(candidate, 'vector'))

  for (const result of merged.values()) {
    const keyword = result.keywordScore ?? 0
    const vector = result.vectorScore ?? 0
    const bothBonus = result.keywordScore != null && result.vectorScore != null ? 0.05 : 0
    result.score = boundedScore(keyword * 0.6 + vector * 0.4 + bothBonus)
    result.matchedBy.sort()
  }

  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_SEARCH_RESULTS))
  return [...merged.values()]
    .sort((a, b) => b.score - a.score
      || (b.document.updatedAt ?? '').localeCompare(a.document.updatedAt ?? '')
      || stableDocumentKey(a.document).localeCompare(stableDocumentKey(b.document)))
    .slice(0, boundedLimit)
}

export function keywordCandidateScore(document: KnowledgeDocument, keywords: readonly string[]): number {
  if (!keywords.length) return 0
  const title = document.title.toLocaleLowerCase('ko-KR')
  const content = document.content.toLocaleLowerCase('ko-KR')
  const entityId = document.entityId.toLocaleLowerCase('ko-KR')
  let total = 0
  for (const keyword of keywords) {
    const normalized = keyword.toLocaleLowerCase('ko-KR')
    if (title === normalized || entityId === normalized) total += 1
    else if (title.includes(normalized) || entityId.includes(normalized)) total += 0.85
    else if (content.includes(normalized)) total += 0.6
  }
  return boundedScore(total / keywords.length)
}
