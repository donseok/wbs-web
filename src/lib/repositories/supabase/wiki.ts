// Wiki 읽기 리포지토리 — 챗봇이 프로젝트 지식을 근거와 함께 인용하기 위한 계약 구현.
// 요청 스코프 클라이언트를 그대로 쓰므로 RLS(0045 읽기 정책)가 유지된다.
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
  'decision_state', 'owner_team', 'due_date', 'observed_at', 'updated_at',
].join(', ')

const TOPIC_COLUMNS = 'id, project_id, title, type, owner_team, last_changed_at'

/** 봇에 보이는 상태 — 사람이 숨긴 archived와 종료 이력은 계약에서 제외한다. */
const VISIBLE_STATES = ['active', 'open', 'conflicted']

/** 근거 발췌 상한. 회의록 본문 전문이 도구 응답으로 새어나가지 않게 한다. */
const EXCERPT_CAP = 300
const SCAN_CAP = 200

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
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
  const { data, error } = await client
    .from('wiki_item_sources')
    .select('wiki_item_id, minute_id, evidence_excerpt, retracted_at')
    .in('wiki_item_id', itemIds)
  if (error) {
    console.error('[wiki-repo] 근거 조회 실패(지식은 그대로 반환):', error.message)
    return byItem
  }
  for (const row of (data ?? []) as unknown as Row[]) {
    if (row.retracted_at) continue
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
  return byItem
}

async function loadTopicTitles(
  client: SupabaseServerClient,
  projectId: string,
): Promise<Map<string, string>> {
  const { data, error } = await client
    .from('wiki_topics')
    .select('id, title')
    .eq('project_id', projectId)
    .limit(SCAN_CAP * 2)
  if (error) {
    console.error('[wiki-repo] 주제 제목 조회 실패(제목 없이 반환):', error.message)
    return new Map()
  }
  return new Map(((data ?? []) as unknown as Row[]).map((row) => [text(row.id), text(row.title)]))
}

export function createSupabaseWikiRepository(client: SupabaseServerClient): WikiRepository {
  return {
    async searchWikiKnowledge({ projectId, query, kind, limit }) {
      let request = client
        .from('wiki_items')
        .select(ITEM_COLUMNS)
        .eq('project_id', projectId)
        .in('lifecycle_state', VISIBLE_STATES)
      if (kind) request = request.eq('kind', kind)
      if (query) request = request.ilike('statement', `%${query}%`)

      const { data, error } = await request
        .order('updated_at', { ascending: false })
        .limit(SCAN_CAP)
      if (error) {
        return repositoryError('WIKI_ITEMS_READ_FAILED', isRetryableReadError(error))
      }

      const rows = (data ?? []) as unknown as Row[]
      const selected = rows.slice(0, limit)
      const [topicTitleById, sources] = await Promise.all([
        loadTopicTitles(client, projectId),
        loadSources(client, selected.map((row) => text(row.id)).filter(Boolean)),
      ])
      return repositoryOk({
        items: selected.map((row) => mapItem(row, topicTitleById, sources)),
        scanTruncated: rows.length >= SCAN_CAP,
      })
    },

    async getWikiTopic({ projectId, topicId, titleQuery }) {
      let topicRequest = client
        .from('wiki_topics')
        .select(TOPIC_COLUMNS)
        .eq('project_id', projectId)
      topicRequest = topicId
        ? topicRequest.eq('id', topicId)
        : topicRequest.ilike('title', `%${titleQuery ?? ''}%`)

      const { data: topicData, error: topicError } = await topicRequest
        .order('last_changed_at', { ascending: false })
        .limit(1)
      if (topicError) {
        return repositoryError('WIKI_TOPICS_READ_FAILED', isRetryableReadError(topicError))
      }
      const topicRow = ((topicData ?? []) as unknown as Row[])[0]
      if (!topicRow) return repositoryOk<WikiTopicSnapshot | null>(null)
      const topic = mapTopic(topicRow)

      const { data: itemData, error: itemError } = await client
        .from('wiki_items')
        .select(ITEM_COLUMNS)
        .eq('project_id', projectId)
        .eq('topic_id', topic.id)
        .in('lifecycle_state', VISIBLE_STATES)
        .order('updated_at', { ascending: false })
        .limit(SCAN_CAP)
      if (itemError) {
        return repositoryError('WIKI_ITEMS_READ_FAILED', isRetryableReadError(itemError))
      }

      const rows = (itemData ?? []) as unknown as Row[]
      const sources = await loadSources(client, rows.map((row) => text(row.id)).filter(Boolean))
      const topicTitleById = new Map([[topic.id, topic.title]])
      return repositoryOk<WikiTopicSnapshot | null>({
        topic,
        items: rows.map((row) => mapItem(row, topicTitleById, sources)),
      })
    },
  }
}
