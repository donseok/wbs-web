import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type {
  WikiCertainty,
  WikiChangeType,
  WikiDecisionState,
  WikiItemKind as DomainWikiItemKind,
  WikiLifecycleState,
  WikiOrigin,
  WikiSourceRelation,
  WikiTopicType,
} from '@/lib/domain/wiki'

type Row = Record<string, unknown>
type JsonObject = Record<string, unknown>

export type WikiItemKind = DomainWikiItemKind

export interface WikiSource {
  id: string
  wikiItemId: string
  minuteId: string
  minuteVersionId: string | null
  bodyHash: string | null
  blockIndex: number | null
  blockHash: string | null
  evidenceExcerpt: string | null
  relation: WikiSourceRelation
  retractedAt?: string | null
  retractionReason?: string | null
  minuteTitle: string | null
  minuteDate: string | null
}

export interface WikiItem {
  id: string
  projectId: string
  topicId: string
  kind: WikiItemKind
  statement: string
  lifecycleState: WikiLifecycleState
  certainty: WikiCertainty
  decisionState: WikiDecisionState | null
  ownerTeam: string | null
  ownerMemberId: string | null
  dueDate: string | null
  observedAt: string | null
  validFrom: string | null
  validTo: string | null
  origin: WikiOrigin
  autoUpdateLocked: boolean
  structuredData: JsonObject
  createdAt: string
  updatedAt: string
  sources: WikiSource[]
}

export interface WikiTopic {
  id: string
  projectId: string
  title: string
  normalizedTitle: string
  type: WikiTopicType
  ownerTeam: string | null
  lastChangedAt: string
  createdAt: string
  updatedAt: string
}

export interface WikiTopicSummary extends WikiTopic {
  itemCount: number
  activeDecisionCount: number
  openItemCount: number
  conflictCount: number
}

export interface WikiChangeEvent {
  id: string
  projectId: string
  wikiItemId: string | null
  minuteId: string | null
  minuteVersionId: string | null
  sourceId?: string | null
  sourceBodyHash?: string | null
  sourceBlockIndex?: number | null
  sourceBlockHash?: string | null
  changeType: WikiChangeType
  beforeSnapshot: JsonObject | null
  afterSnapshot: JsonObject | null
  reason: string | null
  createdAt: string
  minuteTitle: string | null
  minuteDate: string | null
}

export interface WikiOverviewSummary {
  topicCount: number
  activeDecisionCount: number
  openItemCount: number
  conflictCount: number
  lastChangedAt: string | null
}

export interface WikiOverviewData {
  available: boolean
  topics: WikiTopicSummary[]
  items: WikiItem[]
  changes: WikiChangeEvent[]
  summary: WikiOverviewSummary
}

export interface WikiTopicDetailData {
  available: boolean
  topic: WikiTopicSummary | null
  items: WikiItem[]
  changes: WikiChangeEvent[]
}

const EMPTY_SUMMARY: WikiOverviewSummary = {
  topicCount: 0,
  activeDecisionCount: 0,
  openItemCount: 0,
  conflictCount: 0,
  lastChangedAt: null,
}

const EMPTY_OVERVIEW: WikiOverviewData = {
  available: false,
  topics: [],
  items: [],
  changes: [],
  summary: EMPTY_SUMMARY,
}

const CLOSED_STATES = new Set([
  'archived',
  'closed',
  'done',
  'resolved',
  'superseded',
  'withdrawn',
])

const NON_CURRENT_DECISION_STATES = new Set([
  'disputed',
  'on_hold',
  'proposed',
  'reversed',
  'superseded',
  'tentative',
  'withdrawn',
])

const CONFLICT_STATES = new Set([
  'conflict',
  'conflicted',
  'disputed',
])

function normalizedState(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** 현재 유효한 결정인지 판정하는 표시 계층용 규칙. */
export function isActiveWikiDecision(item: WikiItem): boolean {
  if (item.kind !== 'decision') return false
  if (
    CLOSED_STATES.has(normalizedState(item.lifecycleState))
    || CONFLICT_STATES.has(normalizedState(item.lifecycleState))
  ) return false
  return !NON_CURRENT_DECISION_STATES.has(normalizedState(item.decisionState))
}

/** 실행·질문·리스크 중 아직 닫히지 않은 항목인지 판정한다. */
export function isOpenWikiItem(item: WikiItem): boolean {
  if (!['action', 'question', 'risk'].includes(item.kind)) return false
  return !CLOSED_STATES.has(normalizedState(item.lifecycleState))
}

/** 상태 또는 반대 근거가 있는 항목을 상충으로 센다. */
export function isConflictedWikiItem(item: WikiItem): boolean {
  if (
    CONFLICT_STATES.has(normalizedState(item.lifecycleState))
    || CONFLICT_STATES.has(normalizedState(item.decisionState))
  ) return true
  return item.sources.some((source) => (
    !source.retractedAt && normalizedState(source.relation) === 'contradicts'
  ))
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonObject
}

function mapTopic(row: Row): WikiTopic {
  const createdAt = asString(row.created_at)
  const updatedAt = asString(row.updated_at, createdAt)
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    title: asString(row.title),
    normalizedTitle: asString(row.normalized_title),
    type: asString(row.type, 'general') as WikiTopicType,
    ownerTeam: asNullableString(row.owner_team),
    lastChangedAt: asString(row.last_changed_at, updatedAt),
    createdAt,
    updatedAt,
  }
}

function mapSource(row: Row, minuteById: Map<string, { title: string; date: string }>): WikiSource {
  const minuteId = asString(row.minute_id)
  const minute = minuteById.get(minuteId)
  return {
    id: asString(row.id),
    wikiItemId: asString(row.wiki_item_id),
    minuteId,
    minuteVersionId: asNullableString(row.minute_version_id),
    bodyHash: asNullableString(row.body_hash),
    blockIndex: typeof row.block_index === 'number' ? row.block_index : null,
    blockHash: asNullableString(row.block_hash),
    evidenceExcerpt: asNullableString(row.evidence_excerpt),
    relation: asString(row.relation, 'supports') as WikiSourceRelation,
    retractedAt: asNullableString(row.retracted_at),
    retractionReason: asNullableString(row.retraction_reason),
    minuteTitle: minute?.title ?? null,
    minuteDate: minute?.date ?? null,
  }
}

function mapItem(row: Row, sourcesByItem: Map<string, WikiSource[]>): WikiItem {
  const id = asString(row.id)
  return {
    id,
    projectId: asString(row.project_id),
    topicId: asString(row.topic_id),
    kind: asString(row.kind, 'fact') as WikiItemKind,
    statement: asString(row.statement),
    lifecycleState: asString(row.lifecycle_state, 'active') as WikiLifecycleState,
    certainty: asString(row.certainty, 'explicit') as WikiCertainty,
    decisionState: asNullableString(row.decision_state) as WikiDecisionState | null,
    ownerTeam: asNullableString(row.owner_team),
    ownerMemberId: asNullableString(row.owner_member_id),
    dueDate: asNullableString(row.due_date),
    observedAt: asNullableString(row.observed_at),
    validFrom: asNullableString(row.valid_from),
    validTo: asNullableString(row.valid_to),
    origin: asString(row.origin, 'ai') as WikiOrigin,
    autoUpdateLocked: row.auto_update_locked === true,
    structuredData: asObject(row.structured_data) ?? {},
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    sources: sourcesByItem.get(id) ?? [],
  }
}

type WikiChangeSourceVersion = {
  minuteVersionId: string
  createdAt: string | null
}

type WikiChangeSourceVersionIndex = Map<string, WikiChangeSourceVersion[]>

function changeSourceKey(wikiItemId: string, minuteId: string): string {
  return `${wikiItemId}:${minuteId}`
}

/**
 * 변경 이벤트에는 버전 FK가 없지만, 이벤트 직전에 같은 item/minute에 붙인 원문 근거에는
 * 정확한 minute_version_id가 있다. 이벤트 시각 이전의 가장 최근 근거를 선택해 과거
 * 회의록 본문으로 연결한다. 이전 근거가 없으면(레거시/시계 오차) 가장 가까운 근거로 폴백한다.
 */
function buildChangeSourceVersionIndex(sourceRows: Row[]): WikiChangeSourceVersionIndex {
  const index: WikiChangeSourceVersionIndex = new Map()
  for (const row of sourceRows) {
    const wikiItemId = asString(row.wiki_item_id)
    const minuteId = asString(row.minute_id)
    const minuteVersionId = asString(row.minute_version_id)
    if (!wikiItemId || !minuteId || !minuteVersionId) continue
    const key = changeSourceKey(wikiItemId, minuteId)
    const refs = index.get(key) ?? []
    refs.push({
      minuteVersionId,
      createdAt: asNullableString(row.created_at),
    })
    index.set(key, refs)
  }
  return index
}

function minuteVersionForChange(
  row: Row,
  sourceVersions: WikiChangeSourceVersionIndex,
  sourceVersionById: Map<string, string>,
): string | null {
  const immutableVersionId = asNullableString(row.minute_version_id)
  if (immutableVersionId) return immutableVersionId
  const sourceId = asNullableString(row.source_id)
  if (sourceId) {
    const exact = sourceVersionById.get(sourceId)
    if (exact) return exact
  }
  const wikiItemId = asNullableString(row.wiki_item_id)
  const minuteId = asNullableString(row.minute_id)
  if (!wikiItemId || !minuteId) return null
  const refs = sourceVersions.get(changeSourceKey(wikiItemId, minuteId)) ?? []
  if (refs.length === 0) return null

  const eventTime = Date.parse(asString(row.created_at))
  if (Number.isFinite(eventTime)) {
    const preceding = refs
      .map(ref => ({ ref, time: ref.createdAt ? Date.parse(ref.createdAt) : Number.NaN }))
      .filter(candidate => Number.isFinite(candidate.time) && candidate.time <= eventTime)
      .sort((a, b) => b.time - a.time)
    if (preceding[0]) return preceding[0].ref.minuteVersionId

    const nearest = refs
      .map(ref => ({ ref, time: ref.createdAt ? Date.parse(ref.createdAt) : Number.NaN }))
      .filter(candidate => Number.isFinite(candidate.time))
      .sort((a, b) => Math.abs(a.time - eventTime) - Math.abs(b.time - eventTime))
    if (nearest[0]) return nearest[0].ref.minuteVersionId
  }

  return refs[refs.length - 1]?.minuteVersionId ?? null
}

function mapChange(
  row: Row,
  minuteById: Map<string, { title: string; date: string }>,
  sourceVersions: WikiChangeSourceVersionIndex,
  sourceVersionById: Map<string, string>,
): WikiChangeEvent {
  const minuteId = asNullableString(row.minute_id)
  const minute = minuteId ? minuteById.get(minuteId) : undefined
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    wikiItemId: asNullableString(row.wiki_item_id),
    minuteId,
    minuteVersionId: minuteVersionForChange(row, sourceVersions, sourceVersionById),
    sourceId: asNullableString(row.source_id),
    sourceBodyHash: asNullableString(row.source_body_hash),
    sourceBlockIndex: typeof row.source_block_index === 'number' ? row.source_block_index : null,
    sourceBlockHash: asNullableString(row.source_block_hash),
    changeType: asString(row.change_type, 'new') as WikiChangeType,
    beforeSnapshot: asObject(row.before_snapshot),
    afterSnapshot: asObject(row.after_snapshot),
    reason: asNullableString(row.reason),
    createdAt: asString(row.created_at),
    minuteTitle: minute?.title ?? null,
    minuteDate: minute?.date ?? null,
  }
}

function latestIso(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => Boolean(value))
  if (present.length === 0) return null
  return present.sort((a, b) => b.localeCompare(a))[0]
}

function summarizeTopic(topic: WikiTopic, items: WikiItem[]): WikiTopicSummary {
  return {
    ...topic,
    itemCount: items.length,
    activeDecisionCount: items.filter(isActiveWikiDecision).length,
    openItemCount: items.filter(isOpenWikiItem).length,
    conflictCount: items.filter(isConflictedWikiItem).length,
    lastChangedAt: latestIso([
      topic.lastChangedAt,
      ...items.map((item) => item.updatedAt),
    ]) ?? topic.lastChangedAt,
  }
}

function schemaMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const message = error.message?.toLowerCase() ?? ''
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || message.includes('wiki_topics')
    || message.includes('wiki_items')
    || message.includes('wiki_change_events')
    || message.includes('wiki_item_sources')
}

function logWikiReadError(scope: string, error: { code?: string; message?: string }): void {
  const kind = schemaMissing(error) ? '스키마 준비 전' : '조회 실패'
  console.error(`[${scope}] Wiki ${kind}:`, error.message ?? error.code ?? 'unknown error')
}

/**
 * 프로젝트 Wiki 홈/상세 공용 읽기 모델.
 *
 * Wiki 마이그레이션이 아직 반영되지 않은 개발환경에서도 페이지 전체를 실패시키지
 * 않도록 스키마 누락은 available=false인 빈 모델로 강등한다. 그 외 조회 실패도
 * 사용자가 잘못된 부분 데이터를 보지 않도록 같은 빈 모델을 반환하되 원인은 로그에 남긴다.
 */
export const getWikiOverview = cache(async (projectId: string): Promise<WikiOverviewData> => {
  const sb = await createServerClient()

  // 토픽 테이블을 게이트로 먼저 확인해, 마이그레이션 전 환경에서 실패 쿼리를 연쇄 실행하지 않는다.
  const topicsRes = await sb.from('wiki_topics')
    .select('id, project_id, title, normalized_title, type, owner_team, last_changed_at, created_at, updated_at')
    .eq('project_id', projectId)
    .order('last_changed_at', { ascending: false })
    .limit(200)

  if (topicsRes.error) {
    logWikiReadError('getWikiOverview', topicsRes.error)
    return EMPTY_OVERVIEW
  }

  const [itemsRes, changesRes] = await Promise.all([
    sb.from('wiki_items')
      .select('id, project_id, topic_id, kind, statement, lifecycle_state, certainty, decision_state, owner_team, owner_member_id, due_date, observed_at, valid_from, valid_to, origin, auto_update_locked, structured_data, created_at, updated_at')
      .eq('project_id', projectId)
      // 현재 Wiki는 current projection만 읽고, superseded/archive 이력은 change event에서 본다.
      .in('lifecycle_state', ['active', 'open', 'conflicted'])
      .order('updated_at', { ascending: false })
      .limit(500),
    sb.from('wiki_change_events')
      .select('id, project_id, wiki_item_id, minute_id, source_id, minute_version_id, source_body_hash, source_block_index, source_block_hash, change_type, before_snapshot, after_snapshot, reason, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  if (itemsRes.error || changesRes.error) {
    if (itemsRes.error) logWikiReadError('getWikiOverview.items', itemsRes.error)
    if (changesRes.error) logWikiReadError('getWikiOverview.changes', changesRes.error)
    return EMPTY_OVERVIEW
  }

  const itemRows = (itemsRes.data ?? []) as Row[]
  const itemIds = itemRows.map((row) => asString(row.id)).filter(Boolean)

  const sourcesRes = itemIds.length > 0
    ? await sb.from('wiki_item_sources')
      .select('id, wiki_item_id, minute_id, minute_version_id, body_hash, block_index, block_hash, evidence_excerpt, relation, retracted_at, retraction_reason, created_at')
      .in('wiki_item_id', itemIds)
    : { data: [] as Row[], error: null }

  if (sourcesRes.error) {
    logWikiReadError('getWikiOverview.sources', sourcesRes.error)
    return EMPTY_OVERVIEW
  }

  const sourceRows = (sourcesRes.data ?? []) as Row[]
  const changeRows = (changesRes.data ?? []) as Row[]
  const minuteIds = Array.from(new Set([
    ...sourceRows.map((row) => asString(row.minute_id)),
    ...changeRows.map((row) => asString(row.minute_id)),
  ].filter(Boolean)))

  const minuteById = new Map<string, { title: string; date: string }>()
  if (minuteIds.length > 0) {
    const minutesRes = await sb.from('minutes')
      .select('id, title, minute_date')
      .in('id', minuteIds)
    if (minutesRes.error) {
      // 제목 보강 실패는 핵심 Wiki 지식의 부재가 아니므로 원문 링크는 id만으로 유지한다.
      console.error('[getWikiOverview.minutes] 회의록 메타 조회 실패:', minutesRes.error.message)
    } else {
      for (const row of (minutesRes.data ?? []) as Row[]) {
        minuteById.set(asString(row.id), {
          title: asString(row.title),
          date: asString(row.minute_date),
        })
      }
    }
  }

  const sourcesByItem = new Map<string, WikiSource[]>()
  for (const row of sourceRows) {
    const source = mapSource(row, minuteById)
    const list = sourcesByItem.get(source.wikiItemId)
    if (list) list.push(source)
    else sourcesByItem.set(source.wikiItemId, [source])
  }

  const items = itemRows.map((row) => mapItem(row, sourcesByItem))
  const itemByTopic = new Map<string, WikiItem[]>()
  for (const item of items) {
    const list = itemByTopic.get(item.topicId)
    if (list) list.push(item)
    else itemByTopic.set(item.topicId, [item])
  }

  const topics = ((topicsRes.data ?? []) as Row[])
    .map(mapTopic)
    .map((topic) => summarizeTopic(topic, itemByTopic.get(topic.id) ?? []))
    .sort((a, b) => b.lastChangedAt.localeCompare(a.lastChangedAt))

  const changeSourceVersions = buildChangeSourceVersionIndex(sourceRows)
  const sourceVersionById = new Map(
    sourceRows.map(row => [asString(row.id), asString(row.minute_version_id)] as const),
  )
  const changes = changeRows.map((row) => mapChange(
    row,
    minuteById,
    changeSourceVersions,
    sourceVersionById,
  ))
  const summary: WikiOverviewSummary = {
    topicCount: topics.length,
    activeDecisionCount: items.filter(isActiveWikiDecision).length,
    openItemCount: items.filter(isOpenWikiItem).length,
    conflictCount: items.filter(isConflictedWikiItem).length,
    lastChangedAt: latestIso([
      ...topics.map((topic) => topic.lastChangedAt),
      ...changes.map((change) => change.createdAt),
    ]),
  }

  return { available: true, topics, items, changes, summary }
})

function snapshotTopicId(snapshot: JsonObject | null): string | null {
  if (!snapshot) return null
  return asNullableString(snapshot.topic_id) ?? asNullableString(snapshot.topicId)
}

function snapshotItemId(snapshot: JsonObject | null): string | null {
  if (!snapshot) return null
  return asNullableString(snapshot.id)
    ?? asNullableString(snapshot.wiki_item_id)
    ?? asNullableString(snapshot.wikiItemId)
}

/** 주제 상세는 홈 읽기 모델을 재사용해 페이지 간 KPI·상태 판정이 어긋나지 않게 한다. */
export const getWikiTopicDetail = cache(async (
  projectId: string,
  topicId: string,
): Promise<WikiTopicDetailData> => {
  const overview = await getWikiOverview(projectId)
  if (!overview.available) {
    return { available: false, topic: null, items: [], changes: [] }
  }

  const topic = overview.topics.find((candidate) => candidate.id === topicId) ?? null
  if (!topic) {
    return { available: true, topic: null, items: [], changes: [] }
  }

  const items = overview.items.filter((item) => item.topicId === topicId)
  const itemIds = new Set(items.map((item) => item.id))
  const changes = overview.changes.filter((change) => {
    if (change.wikiItemId && itemIds.has(change.wikiItemId)) return true
    const topicIds = [
      snapshotTopicId(change.beforeSnapshot),
      snapshotTopicId(change.afterSnapshot),
    ]
    if (topicIds.includes(topicId)) return true
    const changeItemIds = [
      snapshotItemId(change.beforeSnapshot),
      snapshotItemId(change.afterSnapshot),
    ]
    return changeItemIds.some((itemId) => itemId !== null && itemIds.has(itemId))
  })

  return { available: true, topic, items, changes }
})
