import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { chunked } from '@/lib/ai/util'
import {
  wikiAutomationState,
  type WikiAutomationState,
} from '@/lib/wiki/serviceState'
import {
  isActiveWikiDecision,
  isClosedByPersonWikiItem,
  isConflictedWikiItem,
  isOpenWikiItem,
} from '@/lib/domain/wikiView'
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
export type WikiReadState = 'ready' | 'schema_missing' | 'error'
export type WikiReviewState = 'pending' | 'accepted' | 'rejected'

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
  /** 변경 이벤트를 당시 원문 버전으로 되돌려 잇는 데 쓰는 근거 생성 시각. */
  createdAt: string | null
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
  /** 0079 이전 스키마에서는 accepted로 호환 매핑한다. */
  reviewState: WikiReviewState
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
  bodyMd: string | null
  bodyUpdatedAt: string | null
  bodyUpdatedBy: string | null
  parentId: string | null
  sort: number
  pinnedOrder: number | null
  origin: WikiOrigin
  documentKind: string | null
  verifiedAt: string | null
  verifiedBy: string | null
  reviewDueAt: string | null
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

export interface WikiQuestion {
  id: string
  projectId: string
  topicId: string | null
  question: string
  answer: string | null
  status: string
  askedBy: string | null
  answeredBy: string | null
  createdAt: string
  updatedAt: string
  answeredAt: string | null
}

export interface WikiFeedback {
  id: string
  projectId: string
  topicId: string | null
  userId: string | null
  feedbackType: string
  comment: string | null
  resolution: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface WikiTopicRevision {
  id: string
  versionNo: number
  title: string
  bodyMd: string
  editedByName: string | null
  createdAt: string
}

export interface WikiTopicDetailData {
  available: boolean
  readState: WikiReadState
  automationState: WikiAutomationState
  topic: WikiTopicSummary | null
  items: WikiItem[]
  /** 승인 전/거절된 AI 추출물. 일반 지식 목록과 집계에는 절대 섞지 않는다. */
  proposals: WikiItem[]
  changes: WikiChangeEvent[]
  /** 최근 변경 첫 페이지 계약의 다음 행 존재 여부. */
  changesTruncated: boolean
  /** 방어용 최대 페이지 수에 닿았을 때만 true. 부분 결과임을 숨기지 않는다. */
  dataTruncated: boolean
  revisions?: WikiTopicRevision[]
  questions?: WikiQuestion[]
  feedback?: WikiFeedback[]
}

// 상태 판정은 lib/domain/wikiView가 단일 정본이다. 기존 호출부 호환을 위해 재수출한다.
export {
  isActiveWikiDecision,
  isArchivedWikiItem,
  isClosedByPersonWikiItem,
  isConflictedWikiItem,
  isCurrentWikiKnowledge,
  isDiscussingWikiItem,
  isOpenWikiItem,
  isResolvedWikiItem,
} from '@/lib/domain/wikiView'

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

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
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
    bodyMd: asNullableString(row.body_md),
    bodyUpdatedAt: asNullableString(row.body_updated_at),
    bodyUpdatedBy: asNullableString(row.body_updated_by),
    parentId: asNullableString(row.parent_id),
    sort: asNumber(row.sort),
    pinnedOrder: typeof row.pinned_order === 'number' ? row.pinned_order : null,
    origin: asString(row.origin, 'ai') as WikiOrigin,
    documentKind: asNullableString(row.document_kind),
    verifiedAt: asNullableString(row.verified_at),
    verifiedBy: asNullableString(row.verified_by),
    reviewDueAt: asNullableString(row.review_due_at),
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
    createdAt: asNullableString(row.created_at),
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
    reviewState: asString(row.review_state, 'accepted') as WikiReviewState,
    structuredData: asObject(row.structured_data) ?? {},
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    sources: sourcesByItem.get(id) ?? [],
  }
}

function mapQuestion(row: Row): WikiQuestion {
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    topicId: asNullableString(row.topic_id),
    question: asString(row.question),
    answer: asNullableString(row.answer),
    status: asString(row.status, 'open'),
    askedBy: asNullableString(row.asked_by),
    answeredBy: asNullableString(row.answered_by),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    answeredAt: asNullableString(row.answered_at),
  }
}

function mapFeedback(row: Row): WikiFeedback {
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    topicId: asNullableString(row.topic_id),
    userId: asNullableString(row.user_id),
    feedbackType: asString(row.feedback_type),
    comment: asNullableString(row.comment),
    resolution: asNullableString(row.resolution),
    resolvedAt: asNullableString(row.resolved_at),
    resolvedBy: asNullableString(row.resolved_by),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

function mapRevision(row: Row): WikiTopicRevision {
  return {
    id: asString(row.id),
    versionNo: asNumber(row.version_no),
    title: asString(row.title),
    bodyMd: asString(row.body_md),
    editedByName: asNullableString(row.edited_by_name),
    createdAt: asString(row.created_at),
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
function buildChangeSourceVersionIndex(sources: WikiSource[]): WikiChangeSourceVersionIndex {
  const index: WikiChangeSourceVersionIndex = new Map()
  for (const source of sources) {
    if (!source.wikiItemId || !source.minuteId || !source.minuteVersionId) continue
    const key = changeSourceKey(source.wikiItemId, source.minuteId)
    const refs = index.get(key) ?? []
    refs.push({
      minuteVersionId: source.minuteVersionId,
      createdAt: source.createdAt,
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
    // 시각 파싱은 한 번만 하고, 이벤트 이전 근거 → 가장 가까운 근거 순으로 고른다.
    const timed = refs
      .map(ref => ({ ref, time: ref.createdAt ? Date.parse(ref.createdAt) : Number.NaN }))
      .filter(candidate => Number.isFinite(candidate.time))
    const preceding = timed
      .filter(candidate => candidate.time <= eventTime)
      .sort((a, b) => b.time - a.time)
    if (preceding[0]) return preceding[0].ref.minuteVersionId

    const nearest = [...timed]
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

/** 집계는 살아 있는 항목만 센다. 사람이 닫거나 숨긴 항목이 주제 카드 숫자와 KPI를 부풀리면 안 된다. */
function summarizeTopic(topic: WikiTopic, items: WikiItem[]): WikiTopicSummary {
  const live = items.filter((item) => !isClosedByPersonWikiItem(item))
  return {
    ...topic,
    itemCount: live.length,
    activeDecisionCount: live.filter(isActiveWikiDecision).length,
    openItemCount: live.filter(isOpenWikiItem).length,
    conflictCount: live.filter(isConflictedWikiItem).length,
    lastChangedAt: latestIso([
      topic.lastChangedAt,
      ...items.map((item) => item.updatedAt),
    ]) ?? topic.lastChangedAt,
  }
}

type WikiReadError = { code?: string; message?: string }

/** 테이블 자체가 없거나 PostgREST 스키마 캐시에 아직 올라오지 않은 경우. */
function schemaMissing(error: WikiReadError | null): boolean {
  if (!error) return false
  const message = error.message?.toLowerCase() ?? ''
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || message.includes('relation') && message.includes('does not exist')
    || message.includes('could not find the table')
}

/** 0079 컬럼/테이블이 아직 없는 환경을 레거시 Wiki 전체 장애와 구분한다. */
function wikiDocumentsSchemaMissing(error: WikiReadError | null): boolean {
  if (!error) return false
  const message = error.message?.toLowerCase() ?? ''
  const extensionNames = [
    'body_md', 'body_updated_at', 'body_updated_by', 'parent_id', 'sort', 'pinned_order',
    'origin', 'document_kind', 'verified_at', 'verified_by', 'review_due_at', 'review_state',
    'wiki_questions', 'wiki_feedback', 'wiki_topic_revisions',
  ]
  return (error.code === 'PGRST204' || error.code === '42703' || schemaMissing(error))
    && extensionNames.some((name) => message.includes(name))
}

function logWikiReadError(scope: string, error: WikiReadError): void {
  const kind = schemaMissing(error) || wikiDocumentsSchemaMissing(error) ? '스키마 준비 전' : '조회 실패'
  console.error(`[${scope}] Wiki ${kind}:`, error.message ?? error.code ?? 'unknown error')
}

type WikiQueryResult = { data: unknown; error: WikiReadError | null }
type PagedRows = { rows: Row[]; error: WikiReadError | null; truncated: boolean }

const READ_BATCH_SIZE = 500
const READ_MAX_PAGES = 200
const SOURCE_ID_BATCH_SIZE = 100
const TOPIC_CHANGE_LIMIT = 300
const TOPIC_CURATE_LIMIT = 50

const TOPIC_COLUMNS_LEGACY = 'id, project_id, title, normalized_title, type, owner_team, last_changed_at, created_at, updated_at'
const TOPIC_COLUMNS = `${TOPIC_COLUMNS_LEGACY}, body_md, body_updated_at, body_updated_by, parent_id, sort, pinned_order, origin, document_kind, verified_at, verified_by, review_due_at`
const ITEM_COLUMNS_LEGACY = 'id, project_id, topic_id, kind, statement, lifecycle_state, certainty, decision_state, owner_team, owner_member_id, due_date, observed_at, valid_from, valid_to, origin, auto_update_locked, structured_data, created_at, updated_at'
const ITEM_COLUMNS = `${ITEM_COLUMNS_LEGACY}, review_state`
const CHANGE_COLUMNS = 'id, project_id, wiki_item_id, minute_id, source_id, minute_version_id, source_body_hash, source_block_index, source_block_hash, change_type, before_snapshot, after_snapshot, reason, created_at'
const SOURCE_COLUMNS = 'id, wiki_item_id, minute_id, minute_version_id, body_hash, block_index, block_hash, evidence_excerpt, relation, retracted_at, retraction_reason, created_at'
const QUESTION_COLUMNS = 'id, project_id, topic_id, question, answer, status, asked_by, answered_by, created_at, updated_at, answered_at'
const FEEDBACK_COLUMNS = 'id, project_id, topic_id, user_id, feedback_type, comment, resolution, resolved_at, resolved_by, created_at, updated_at'
const REVISION_COLUMNS = 'id, version_no, title, body_md, edited_by_name, created_at'

/**
 * PostgREST 기본 max_rows와 무관하게 안정적인 range 페이지로 전량을 읽는다. 비정상 mock이나
 * 폭증 데이터가 무한 루프를 만들지 않도록 방어 상한을 두되, 닿으면 truncated를 반환한다.
 */
async function fetchPagedRows(
  page: (from: number, to: number) => PromiseLike<WikiQueryResult>,
  batchSize = READ_BATCH_SIZE,
): Promise<PagedRows> {
  const rows: Row[] = []
  for (let pageNo = 0; pageNo < READ_MAX_PAGES; pageNo += 1) {
    const from = pageNo * batchSize
    const result = await page(from, from + batchSize - 1)
    if (result.error) return { rows: [], error: result.error, truncated: false }
    const received = (result.data ?? []) as Row[]
    rows.push(...received)
    if (received.length < batchSize) return { rows, error: null, truncated: false }
  }
  return { rows, error: null, truncated: true }
}

type WikiMinuteMeta = Map<string, { title: string; date: string }>

/** 근거·변경 링크에 붙일 회의록 제목/일자 보강. 실패해도 지식 자체는 유지한다. */
async function fetchMinuteMeta(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  minuteIds: string[],
  scope: string,
): Promise<WikiMinuteMeta> {
  const minuteById: WikiMinuteMeta = new Map()
  if (minuteIds.length === 0) return minuteById
  for (const ids of chunked(Array.from(new Set(minuteIds)), SOURCE_ID_BATCH_SIZE)) {
    const minutesRes = await sb.from('minutes')
      .select('id, title, minute_date')
      .in('id', ids)
    if (minutesRes.error) {
      // 제목 보강 실패는 핵심 Wiki 지식의 부재가 아니므로 원문 링크는 id만으로 유지한다.
      console.error(`[${scope}.minutes] 회의록 메타 조회 실패:`, minutesRes.error.message)
      continue
    }
    for (const row of (minutesRes.data ?? []) as Row[]) {
      minuteById.set(asString(row.id), {
        title: asString(row.title),
        date: asString(row.minute_date),
      })
    }
  }
  return minuteById
}

type ExtensionRows = PagedRows & { extensionMissing: boolean }

async function fetchTopicRows(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  projectId: string,
  topicId?: string,
): Promise<ExtensionRows> {
  const read = (columns: string) => fetchPagedRows((from, to) => {
    let query = sb.from('wiki_topics').select(columns).eq('project_id', projectId)
    if (topicId) query = query.eq('id', topicId)
    return query
      .order('last_changed_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
  })
  const modern = await read(TOPIC_COLUMNS)
  if (!modern.error) return { ...modern, extensionMissing: false }
  if (!wikiDocumentsSchemaMissing(modern.error)) return { ...modern, extensionMissing: false }
  logWikiReadError('wiki.topics.documents', modern.error)
  const legacy = await read(TOPIC_COLUMNS_LEGACY)
  return { ...legacy, extensionMissing: true }
}

const ITEM_LIFECYCLE_STATES = ['active', 'open', 'conflicted', 'archived', 'resolved']

async function fetchItemRows(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  projectId: string,
  topicId?: string,
): Promise<{
  accepted: Row[]
  proposals: Row[]
  error: WikiReadError | null
  extensionMissing: boolean
  truncated: boolean
}> {
  const read = (columns: string, reviewStates?: WikiReviewState[]) => fetchPagedRows((from, to) => {
    let query = sb.from('wiki_items')
      .select(columns)
      .eq('project_id', projectId)
      .in('lifecycle_state', ITEM_LIFECYCLE_STATES)
    if (topicId) query = query.eq('topic_id', topicId)
    if (reviewStates?.length === 1) query = query.eq('review_state', reviewStates[0])
    if (reviewStates && reviewStates.length > 1) query = query.in('review_state', reviewStates)
    return query
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
  })

  // accepted/proposal은 서로 독립인 읽기라 동시에 발행한다. 폴백 판정은 종전과 동일하게
  // 결과별로 하며, 레거시 스키마 폴백(순차 재조회)은 accepted 오류 분기 안에 그대로 둔다.
  const [accepted, proposals] = await Promise.all([
    read(ITEM_COLUMNS, ['accepted']),
    read(ITEM_COLUMNS, ['pending', 'rejected']),
  ])
  if (accepted.error) {
    // 병렬 발행이라 accepted 가 실패해도 proposals 는 이미 나갔다. 아래 분기는 accepted 기준으로만
    // 반환하므로 proposals 오류는 그대로 버려진다 — 표시=로깅 원칙대로 최소한 흔적은 남긴다.
    if (proposals.error) logWikiReadError('wiki.items.proposals', proposals.error)
    if (!wikiDocumentsSchemaMissing(accepted.error)) {
      return { accepted: [], proposals: [], error: accepted.error, extensionMissing: false, truncated: false }
    }
    logWikiReadError('wiki.items.review_state', accepted.error)
    const legacy = await read(ITEM_COLUMNS_LEGACY)
    return {
      accepted: legacy.rows,
      proposals: [],
      error: legacy.error,
      extensionMissing: true,
      truncated: legacy.truncated,
    }
  }

  if (proposals.error) {
    if (wikiDocumentsSchemaMissing(proposals.error)) {
      logWikiReadError('wiki.items.proposals', proposals.error)
      return {
        accepted: accepted.rows,
        proposals: [],
        error: null,
        extensionMissing: true,
        truncated: accepted.truncated,
      }
    }
    return {
      accepted: accepted.rows,
      proposals: [],
      error: proposals.error,
      extensionMissing: false,
      truncated: accepted.truncated,
    }
  }
  return {
    accepted: accepted.rows,
    proposals: proposals.rows,
    error: null,
    extensionMissing: false,
    truncated: accepted.truncated || proposals.truncated,
  }
}

async function fetchSources(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  itemIds: string[],
): Promise<{
  activeRows: Row[]
  provenanceRows: Row[]
  error: WikiReadError | null
  truncated: boolean
}> {
  const activeRows: Row[] = []
  const provenanceRows: Row[] = []
  let truncated = false
  for (const ids of chunked(Array.from(new Set(itemIds)), SOURCE_ID_BATCH_SIZE)) {
    const active = await fetchPagedRows((from, to) => sb.from('wiki_item_sources')
      .select(SOURCE_COLUMNS)
      .in('wiki_item_id', ids)
      .is('retracted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to))
    if (active.error) return { activeRows: [], provenanceRows: [], error: active.error, truncated: false }
    activeRows.push(...active.rows)
    truncated ||= active.truncated

    // 철회 근거는 현재 지식 카드에는 절대 붙이지 않고 과거 change의 원문 버전 복원에만 쓴다.
    const historical = await fetchPagedRows((from, to) => sb.from('wiki_item_sources')
      .select(SOURCE_COLUMNS)
      .in('wiki_item_id', ids)
      .not('retracted_at', 'is', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to))
    if (historical.error) return { activeRows: [], provenanceRows: [], error: historical.error, truncated: false }
    provenanceRows.push(...historical.rows)
    truncated ||= historical.truncated
  }
  return { activeRows, provenanceRows, error: null, truncated }
}

async function fetchOptionalRows(
  page: (from: number, to: number) => PromiseLike<WikiQueryResult>,
  scope: string,
): Promise<ExtensionRows> {
  const result = await fetchPagedRows(page, 200)
  if (result.error && wikiDocumentsSchemaMissing(result.error)) {
    logWikiReadError(scope, result.error)
    return { rows: [], error: null, truncated: false, extensionMissing: true }
  }
  return { ...result, extensionMissing: false }
}

function sourcesByItem(sources: WikiSource[]): Map<string, WikiSource[]> {
  const result = new Map<string, WikiSource[]>()
  for (const source of sources) {
    const existing = result.get(source.wikiItemId)
    if (existing) existing.push(source)
    else result.set(source.wikiItemId, [source])
  }
  return result
}

/**
 * 주제 병합 이벤트는 스냅샷에 wiki_topics 행을 통째로 담는다(0048 merge_wiki_topics).
 * 그 행의 id는 topic id이므로 항목 스냅샷과 구분해야 한다 — normalized_title은 주제 행에만 있다.
 */
function snapshotTopicRowId(snapshot: JsonObject | null): string | null {
  if (!snapshot) return null
  if (typeof snapshot.normalized_title !== 'string') return null
  return asNullableString(snapshot.id)
}

function emptyDetail(readState: WikiReadState): WikiTopicDetailData {
  return {
    available: false,
    readState,
    automationState: wikiAutomationState(),
    topic: null,
    items: [],
    proposals: [],
    changes: [],
    changesTruncated: false,
    dataTruncated: false,
    revisions: [],
    questions: [],
    feedback: [],
  }
}

/** 주제 상세는 홈 배열에 의존하지 않고 project+topic으로 직접 읽어 cap 밖 딥링크도 연다. */
export const getWikiTopicDetail = cache(async (
  projectId: string,
  topicId: string,
): Promise<WikiTopicDetailData> => {
  const sb = await createServerClient()
  // 주제 행·항목·큐레이션 이벤트는 모두 projectId/topicId만으로 발행 가능한 독립 읽기라
  // 동시에 던진다. 항목별 변경 이벤트·근거는 itemIds가 나와야 발행할 수 있어 뒤 단계다.
  const [topicResult, itemsResult, curateResult] = await Promise.all([
    fetchTopicRows(sb, projectId, topicId),
    fetchItemRows(sb, projectId, topicId),
    sb.from('wiki_change_events')
      .select(CHANGE_COLUMNS)
      .eq('project_id', projectId)
      .eq('change_type', 'curate')
      .is('wiki_item_id', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(0, TOPIC_CURATE_LIMIT),
  ])
  if (topicResult.error) {
    logWikiReadError('getWikiTopicDetail.topic', topicResult.error)
    return emptyDetail(schemaMissing(topicResult.error) ? 'schema_missing' : 'error')
  }
  const topicRow = topicResult.rows[0]
  if (!topicRow) {
    return {
      ...emptyDetail(topicResult.extensionMissing ? 'schema_missing' : 'ready'),
      available: true,
    }
  }

  if (itemsResult.error) {
    logWikiReadError('getWikiTopicDetail.items', itemsResult.error)
    return emptyDetail(schemaMissing(itemsResult.error) ? 'schema_missing' : 'error')
  }
  const allItemRows = [...itemsResult.accepted, ...itemsResult.proposals]
  const itemIds = allItemRows.map((row) => asString(row.id)).filter(Boolean)
  let hadError = false
  let hadSchemaMissing = false

  // 근거와 항목별 변경 이벤트는 둘 다 itemIds에만 의존하고 서로는 독립이라 동시에 읽는다.
  const [sourceResult, itemChanges] = await Promise.all([
    fetchSources(sb, itemIds),
    (async () => {
      const rows: Row[] = []
      let truncated = false
      let errored = false
      let schemaMissed = false
      for (const ids of chunked(itemIds, SOURCE_ID_BATCH_SIZE)) {
        const result = await sb.from('wiki_change_events')
          .select(CHANGE_COLUMNS)
          .eq('project_id', projectId)
          .in('wiki_item_id', ids)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(0, TOPIC_CHANGE_LIMIT)
        if (result.error) {
          logWikiReadError('getWikiTopicDetail.changes', result.error)
          if (schemaMissing(result.error)) schemaMissed = true
          else errored = true
          continue
        }
        const received = (result.data ?? []) as Row[]
        truncated ||= received.length > TOPIC_CHANGE_LIMIT
        rows.push(...received.slice(0, TOPIC_CHANGE_LIMIT))
      }
      return { rows, truncated, errored, schemaMissed }
    })(),
  ])
  if (sourceResult.error) {
    logWikiReadError('getWikiTopicDetail.sources', sourceResult.error)
    if (schemaMissing(sourceResult.error)) hadSchemaMissing = true
    else hadError = true
  }
  hadError ||= itemChanges.errored
  hadSchemaMissing ||= itemChanges.schemaMissed
  const changeRows: Row[] = [...itemChanges.rows]
  let changesTruncated = itemChanges.truncated

  if (curateResult.error) {
    logWikiReadError('getWikiTopicDetail.curate', curateResult.error)
    if (schemaMissing(curateResult.error)) hadSchemaMissing = true
    else hadError = true
  } else {
    const curateRows = (curateResult.data ?? []) as Row[]
    changesTruncated ||= curateRows.length > TOPIC_CURATE_LIMIT
    changeRows.push(...curateRows.slice(0, TOPIC_CURATE_LIMIT).filter((row) => (
      snapshotTopicRowId(asObject(row.before_snapshot)) === topicId
      || snapshotTopicRowId(asObject(row.after_snapshot)) === topicId
    )))
  }

  let extensionMissing = topicResult.extensionMissing || itemsResult.extensionMissing
  let revisionsResult: ExtensionRows = { rows: [], error: null, truncated: false, extensionMissing: false }
  let questionsResult: ExtensionRows = { rows: [], error: null, truncated: false, extensionMissing: false }
  let feedbackResult: ExtensionRows = { rows: [], error: null, truncated: false, extensionMissing: false }
  if (!extensionMissing) {
    [revisionsResult, questionsResult, feedbackResult] = await Promise.all([
      fetchOptionalRows((from, to) => sb.from('wiki_topic_revisions')
        .select(REVISION_COLUMNS)
        .eq('project_id', projectId)
        .eq('topic_id', topicId)
        .order('version_no', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to), 'getWikiTopicDetail.revisions'),
      fetchOptionalRows((from, to) => sb.from('wiki_questions')
        .select(QUESTION_COLUMNS)
        .eq('project_id', projectId)
        .eq('topic_id', topicId)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to), 'getWikiTopicDetail.questions'),
      fetchOptionalRows((from, to) => sb.from('wiki_feedback')
        .select(FEEDBACK_COLUMNS)
        .eq('project_id', projectId)
        .eq('topic_id', topicId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to), 'getWikiTopicDetail.feedback'),
    ])
    extensionMissing ||= revisionsResult.extensionMissing
      || questionsResult.extensionMissing
      || feedbackResult.extensionMissing
    for (const [scope, result] of [
      ['revisions', revisionsResult],
      ['questions', questionsResult],
      ['feedback', feedbackResult],
    ] as const) {
      if (result.error) {
        logWikiReadError(`getWikiTopicDetail.${scope}`, result.error)
        if (schemaMissing(result.error)) hadSchemaMissing = true
        else hadError = true
      }
    }
  }

  const allSourceRows = [...sourceResult.activeRows, ...sourceResult.provenanceRows]
  const minuteById = await fetchMinuteMeta(
    sb,
    Array.from(new Set([
      ...allSourceRows.map((row) => asString(row.minute_id)),
      ...changeRows.map((row) => asString(row.minute_id)),
    ].filter(Boolean))),
    'getWikiTopicDetail',
  )
  const activeSources = sourceResult.activeRows.map((row) => mapSource(row, minuteById))
  const provenanceSources = sourceResult.provenanceRows.map((row) => mapSource(row, minuteById))
  const currentSourcesByItem = sourcesByItem(activeSources)
  const items = itemsResult.accepted.map((row) => mapItem(row, currentSourcesByItem))
  const proposals = itemsResult.proposals.map((row) => mapItem(row, currentSourcesByItem))
  const topic = summarizeTopic(mapTopic(topicRow), items)

  const allSources = [...activeSources, ...provenanceSources]
  const sourceVersions = buildChangeSourceVersionIndex(allSources)
  const sourceVersionById = new Map(
    allSources.map((source) => [source.id, source.minuteVersionId ?? ''] as const),
  )
  const byId = new Map<string, WikiChangeEvent>()
  for (const row of changeRows) {
    const change = mapChange(row, minuteById, sourceVersions, sourceVersionById)
    if (!byId.has(change.id)) byId.set(change.id, change)
  }

  return {
    available: true,
    readState: extensionMissing || hadSchemaMissing ? 'schema_missing' : hadError ? 'error' : 'ready',
    automationState: wikiAutomationState(),
    topic,
    items,
    proposals,
    changes: Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    changesTruncated,
    dataTruncated: topicResult.truncated
      || itemsResult.truncated
      || sourceResult.truncated
      || revisionsResult.truncated
      || questionsResult.truncated
      || feedbackResult.truncated,
    revisions: revisionsResult.rows.map(mapRevision),
    questions: questionsResult.rows.map(mapQuestion),
    feedback: feedbackResult.rows.map(mapFeedback),
  }
})
