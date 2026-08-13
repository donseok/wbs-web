// Wiki 읽기 리포지토리 — 챗봇이 프로젝트 지식을 근거와 함께 인용하기 위한 계약 구현.
// 요청 스코프 클라이언트를 그대로 쓰므로 RLS(0045 읽기 정책)가 유지된다.
import { ilikeOrPattern } from '@/lib/domain/minutes'
import {
  repositoryError,
  repositoryOk,
  type WikiKnowledgeRecord,
  type WikiRepository,
  type WikiTopicRecord,
  type WikiTopicSnapshot,
} from '@/lib/repositories/types'
import { isRetryableReadError, type SupabaseServerClient } from './common'

type Row = Record<string, unknown>

const ITEM_COLUMNS = [
  'id', 'project_id', 'topic_id', 'kind', 'statement', 'lifecycle_state', 'certainty',
  'decision_state', 'owner_team', 'due_date', 'observed_at', 'updated_at', 'review_state',
].join(', ')
const LEGACY_ITEM_COLUMNS = ITEM_COLUMNS.replace(', review_state', '')

const TOPIC_COLUMNS = 'id, project_id, title, type, owner_team, last_changed_at'

/** 봇에 보이는 상태 — 사람이 숨긴 archived와 종료 이력은 계약에서 제외한다. */
const VISIBLE_STATES = ['active', 'open', 'conflicted']

/** 근거 발췌 상한. 회의록 본문 전문이 도구 응답으로 새어나가지 않게 한다. */
const EXCERPT_CAP = 300
const SCAN_CAP = 200
const SOURCE_PAGE_SIZE = 500

type QueryError = { code?: string; message?: string }

function reviewStateMissing(error: QueryError | null): boolean {
  if (!error) return false
  const message = error.message?.toLowerCase() ?? ''
  return (error.code === 'PGRST204' || error.code === '42703') && message.includes('review_state')
}

const WIKI_QUERY_STOPWORDS = new Set([
  '그리고', '그러면', '그런데', '대한', '대해', '어떻게', '무엇', '무엇인가요', '뭐',
  '알려줘', '알려주세요', '인가요', '하나요', '되나요', '있나요', '주세요', '관련',
])
const KOREAN_PARTICLES = [
  '으로는', '에서는', '에게서', '까지는', '부터는', '이라는', '라고는',
  '으로', '에서', '에게', '까지', '부터', '처럼', '보다', '하고',
  '은', '는', '이', '가', '을', '를', '의', '에', '로', '와', '과', '도', '만',
]

/** 자연어 질문을 Wiki 검색용 핵심어로 축약한다. 원문을 SQL 문자열로 직접 이어 붙이지 않는다. */
export function wikiSearchTokens(query: string): string[] {
  const raw = query.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const unique = new Set<string>()
  for (const original of raw) {
    if (WIKI_QUERY_STOPWORDS.has(original)) continue
    let token = original
    for (const particle of KOREAN_PARTICLES) {
      if (token.endsWith(particle) && token.length - particle.length >= 2) {
        token = token.slice(0, -particle.length)
        break
      }
    }
    if (token.length < 2 || WIKI_QUERY_STOPWORDS.has(token)) continue
    unique.add(token)
    if (unique.size >= 6) break
  }
  return Array.from(unique)
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function ilikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`
}

function mapTopic(row: Row): WikiTopicRecord {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    title: text(row.title),
    type: text(row.type, 'general'),
    ownerTeam: nullableText(row.owner_team),
    lastChangedAt: text(row.last_changed_at),
  }
}

function mapItem(
  row: Row,
  topicTitleById: Map<string, string>,
  sources: Map<string, { minuteIds: string[]; excerpt: string | null }>,
): WikiKnowledgeRecord {
  const id = text(row.id)
  const topicId = text(row.topic_id)
  const source = sources.get(id)
  return {
    id,
    projectId: text(row.project_id),
    topicId,
    topicTitle: topicTitleById.get(topicId) ?? '',
    kind: text(row.kind, 'fact'),
    statement: text(row.statement),
    lifecycleState: text(row.lifecycle_state, 'active'),
    certainty: text(row.certainty, 'explicit'),
    decisionState: nullableText(row.decision_state),
    ownerTeam: nullableText(row.owner_team),
    dueDate: nullableText(row.due_date),
    observedAt: nullableText(row.observed_at),
    updatedAt: text(row.updated_at),
    sourceMinuteIds: source?.minuteIds ?? [],
    evidenceExcerpt: source?.excerpt ?? null,
  }
}

/**
 * 근거는 별도 조회로 붙인다. 임베드 조인은 관계가 어긋나는 순간 쿼리 전체가 거절돼
 * 지식이 통째로 사라진다(2026-07 회의록 인사이트 실종 사고와 같은 함정).
 * 근거 조회 실패는 지식 자체의 부재가 아니므로 링크 없이 계속 진행한다.
 */
async function loadSources(
  client: SupabaseServerClient,
  itemIds: string[],
): Promise<Map<string, { minuteIds: string[]; excerpt: string | null }>> {
  const byItem = new Map<string, { minuteIds: string[]; excerpt: string | null }>()
  if (itemIds.length === 0) return byItem
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await client
      .from('wiki_item_sources')
      .select('wiki_item_id, minute_id, evidence_excerpt, retracted_at')
      .in('wiki_item_id', itemIds)
      .is('retracted_at', null)
      .order('created_at', { ascending: false })
      .range(page * SOURCE_PAGE_SIZE, (page + 1) * SOURCE_PAGE_SIZE - 1)
    if (error) {
      console.error('[wiki-repo] 근거 조회 실패(지식은 그대로 반환):', error.message)
      return byItem
    }
    const rows = (data ?? []) as unknown as Row[]
    for (const row of rows) {
      const itemId = text(row.wiki_item_id)
      const minuteId = text(row.minute_id)
      const entry = byItem.get(itemId) ?? { minuteIds: [], excerpt: null }
      if (minuteId && !entry.minuteIds.includes(minuteId)) entry.minuteIds.push(minuteId)
      if (!entry.excerpt) {
        const excerpt = nullableText(row.evidence_excerpt)
        if (excerpt) entry.excerpt = excerpt.slice(0, EXCERPT_CAP)
      }
      byItem.set(itemId, entry)
    }
    if (rows.length < SOURCE_PAGE_SIZE) break
  }
  return byItem
}

async function loadTopicTitles(
  client: SupabaseServerClient,
  projectId: string,
  topicIds: string[],
): Promise<Map<string, string>> {
  if (topicIds.length === 0) return new Map()
  const { data, error } = await client
    .from('wiki_topics')
    .select('id, title')
    .eq('project_id', projectId)
    .in('id', Array.from(new Set(topicIds)))
  if (error) {
    console.error('[wiki-repo] 주제 제목 조회 실패(제목 없이 반환):', error.message)
    return new Map()
  }
  return new Map(((data ?? []) as unknown as Row[]).map((row) => [text(row.id), text(row.title)]))
}

async function loadMatchingTopics(
  client: SupabaseServerClient,
  projectId: string,
  tokens: string[],
): Promise<{ rows: Row[]; truncated: boolean }> {
  if (tokens.length === 0) return { rows: [], truncated: false }
  const filter = tokens.map((token) => `title.ilike.${ilikeOrPattern(token)}`).join(',')
  const { data, error } = await client
    .from('wiki_topics')
    .select('id, title')
    .eq('project_id', projectId)
    .or(filter)
    .order('last_changed_at', { ascending: false })
    .limit(SCAN_CAP)
  if (error) {
    console.error('[wiki-repo] 주제 검색 실패(문장 검색은 계속):', error.message)
    return { rows: [], truncated: false }
  }
  const rows = (data ?? []) as unknown as Row[]
  return { rows, truncated: rows.length >= SCAN_CAP }
}

function relevance(row: Row, topicTitle: string, query: string, tokens: string[]): number {
  if (tokens.length === 0) return 1
  const statement = text(row.statement).toLowerCase()
  const title = topicTitle.toLowerCase()
  const phrase = query.trim().toLowerCase()
  let score = 0
  if (phrase && statement.includes(phrase)) score += 100
  if (phrase && title.includes(phrase)) score += 80
  let statementHits = 0
  let titleHits = 0
  for (const token of tokens) {
    if (statement.includes(token)) { score += 5; statementHits += 1 }
    if (title.includes(token)) { score += 3; titleHits += 1 }
  }
  if (statementHits === tokens.length) score += 12
  if (titleHits === tokens.length) score += 8
  return score
}

function itemSearchRequest(
  client: SupabaseServerClient,
  projectId: string,
  columns: string,
  kind: string | null,
  tokens: string[],
  acceptedOnly: boolean,
  topicId?: string,
  topicIds?: string[],
) {
  let request = client
    .from('wiki_items')
    .select(columns)
    .eq('project_id', projectId)
    .in('lifecycle_state', VISIBLE_STATES)
  if (acceptedOnly) request = request.eq('review_state', 'accepted')
  if (kind) request = request.eq('kind', kind)
  if (topicId) request = request.eq('topic_id', topicId)
  if (topicIds?.length) request = request.in('topic_id', topicIds)
  if (tokens.length > 0) {
    request = request.or(tokens.map((token) => (
      `statement.ilike.${ilikeOrPattern(token)}`
    )).join(','))
  }
  return request.order('updated_at', { ascending: false }).limit(SCAN_CAP)
}

async function readVisibleItems(
  client: SupabaseServerClient,
  args: {
    projectId: string
    kind?: string | null
    tokens?: string[]
    topicId?: string
    topicIds?: string[]
  },
): Promise<{ rows: Row[]; error: QueryError | null; legacy: boolean }> {
  const tokens = args.tokens ?? []
  const modern = itemSearchRequest(
    client, args.projectId, ITEM_COLUMNS, args.kind ?? null, tokens, true,
    args.topicId, args.topicIds,
  )
  const modernResult = await modern
  if (!modernResult.error) {
    return { rows: (modernResult.data ?? []) as unknown as Row[], error: null, legacy: false }
  }
  if (!reviewStateMissing(modernResult.error)) {
    return { rows: [], error: modernResult.error, legacy: false }
  }

  // 0079 미적용 배포는 기존 지식이 모두 accepted라는 이행 계약으로 읽는다.
  const legacy = itemSearchRequest(
    client, args.projectId, LEGACY_ITEM_COLUMNS, args.kind ?? null, tokens, false,
    args.topicId, args.topicIds,
  )
  const legacyResult = await legacy
  return {
    rows: (legacyResult.data ?? []) as unknown as Row[],
    error: legacyResult.error,
    legacy: true,
  }
}

export function createSupabaseWikiRepository(client: SupabaseServerClient): WikiRepository {
  return {
    async searchWikiKnowledge({ projectId, query, kind, limit }) {
      const normalizedQuery = query?.trim() || null
      const tokens = normalizedQuery ? wikiSearchTokens(normalizedQuery) : []
      // 불용어뿐인 질문은 원문 전체를 핵심어로 사용해 기존 정확 부분일치 동작을 보존한다.
      const effectiveTokens = normalizedQuery && tokens.length === 0 ? [normalizedQuery] : tokens
      const [itemResult, topicResult] = await Promise.all([
        readVisibleItems(client, { projectId, kind, tokens: effectiveTokens }),
        normalizedQuery
          ? loadMatchingTopics(client, projectId, effectiveTokens)
          : Promise.resolve({ rows: [], truncated: false }),
      ])
      if (itemResult.error) {
        return repositoryError('WIKI_ITEMS_READ_FAILED', isRetryableReadError(itemResult.error))
      }

      const matchingTopicIds = topicResult.rows.map((row) => text(row.id)).filter(Boolean)
      const topicItems = matchingTopicIds.length > 0
        ? await readVisibleItems(client, { projectId, kind, topicIds: matchingTopicIds })
        : { rows: [] as Row[], error: null, legacy: false }
      if (topicItems.error) {
        return repositoryError('WIKI_ITEMS_READ_FAILED', isRetryableReadError(topicItems.error))
      }
      const topicIdSet = new Set(matchingTopicIds)
      const byId = new Map<string, Row>()
      for (const row of [...itemResult.rows, ...topicItems.rows]) {
        if (itemResult.rows.includes(row) || topicIdSet.has(text(row.topic_id))) byId.set(text(row.id), row)
      }
      const rows = Array.from(byId.values())
      const topicIds = rows.map((row) => text(row.topic_id)).filter(Boolean)
      const topicTitleById = await loadTopicTitles(client, projectId, topicIds)
      const ranked = normalizedQuery
        ? rows.filter((row) => relevance(
          row, topicTitleById.get(text(row.topic_id)) ?? '', normalizedQuery, effectiveTokens,
        ) > 0)
          .sort((a, b) => (
            relevance(b, topicTitleById.get(text(b.topic_id)) ?? '', normalizedQuery, effectiveTokens)
            - relevance(a, topicTitleById.get(text(a.topic_id)) ?? '', normalizedQuery, effectiveTokens)
            || text(b.updated_at).localeCompare(text(a.updated_at))
          ))
        : rows
      const selected = ranked.slice(0, limit)
      const sources = await loadSources(
        client,
        selected.map((row) => text(row.id)).filter(Boolean),
      )
      return repositoryOk({
        items: selected.map((row) => mapItem(row, topicTitleById, sources)),
        scanTruncated: itemResult.rows.length >= SCAN_CAP
          || topicItems.rows.length >= SCAN_CAP
          || topicResult.truncated
          || ranked.length > limit,
      })
    },

    async getWikiTopic({ projectId, topicId, titleQuery }) {
      let topicRequest = client
        .from('wiki_topics')
        .select(TOPIC_COLUMNS)
        .eq('project_id', projectId)
      topicRequest = topicId
        ? topicRequest.eq('id', topicId)
        : topicRequest.ilike('title', ilikePattern(titleQuery ?? ''))

      const { data: topicData, error: topicError } = await topicRequest
        .order('last_changed_at', { ascending: false })
        .limit(1)
      if (topicError) {
        return repositoryError('WIKI_TOPICS_READ_FAILED', isRetryableReadError(topicError))
      }
      const topicRow = ((topicData ?? []) as unknown as Row[])[0]
      if (!topicRow) return repositoryOk<WikiTopicSnapshot | null>(null)
      const topic = mapTopic(topicRow)

      const itemResult = await readVisibleItems(client, { projectId, topicId: topic.id })
      if (itemResult.error) {
        return repositoryError('WIKI_ITEMS_READ_FAILED', isRetryableReadError(itemResult.error))
      }

      const rows = itemResult.rows
      const sources = await loadSources(client, rows.map((row) => text(row.id)).filter(Boolean))
      const topicTitleById = new Map([[topic.id, topic.title]])
      return repositoryOk<WikiTopicSnapshot | null>({
        topic,
        items: rows.map((row) => mapItem(row, topicTitleById, sources)),
      })
    },
  }
}
