import type { ChatMessage } from '@/lib/ai/llm'

export const CHAT_PROTOCOL_VERSION = 1 as const
export const CHAT_TIMEZONE = 'Asia/Seoul' as const

/**
 * 도메인·엔티티 어휘의 단일 원천. protocol/verifier/pgvector가 전부 이 배열에서
 * 런타임 Set을 파생한다 — 유니온과 검증 Set이 갈라져 유효 데이터가 조용히
 * 폐기되는 회귀(리뷰 M-1)를 타입 수준에서 차단한다.
 */
export const BOT_DOMAINS = [
  'projects',
  'dashboard',
  'wbs',
  'kanban',
  'members',
  'attendance',
  'announcements',
  'meetings',
  'weekly',
  'minutes',
  'settings',
  'unknown',
] as const

export type BotDomain = (typeof BOT_DOMAINS)[number]

export const BOT_ENTITY_TYPES = [
  'project',
  'wbs_item',
  'attachment',
  'team',
  'member',
  'meeting',
  'meeting_occurrence',
  'minute',
  'minute_block',
  'announcement',
  'weekly_report',
  'weekly_row',
  'attendance_record',
] as const

export type BotEntityType = (typeof BOT_ENTITY_TYPES)[number]

export interface BotEntityQualifier {
  occurrenceDate?: string
  anchor?: string
}

export interface BotEntityRef {
  type: BotEntityType
  id: string
  qualifier?: BotEntityQualifier
}

export type BotFilterValue = string | string[] | number | boolean | null

export interface PageContextV1 {
  contextVersion: 1
  pathname: string
  domain: BotDomain
  projectId: string | null
  /**
   * 전역 화면(예: /meetings)에서 사용자가 고른 프로젝트. URL의 projectId와 달리
   * 목록 필터가 아니라 상세 힌트다. untyped filters 사이드채널(리뷰 M-4) 대신
   * typed 필드로 계약을 고정한다. 서버는 이 값도 허용 범위와 교집합 후에만 쓴다.
   */
  selectedProjectId?: string | null
  selectedEntity?: BotEntityRef | null
  view?: string | null
  date?: string | null
  weekStart?: string | null
  range?: { from: string | null; to: string | null } | null
  filters?: Record<string, BotFilterValue>
  search?: string | null
  timezone: typeof CHAT_TIMEZONE
}

export interface ConversationEntityV1 extends BotEntityRef {
  ref: string
  projectId: string | null
  title: string
}

export interface ConversationStateV1 {
  version: 1
  lastEntities: ConversationEntityV1[]
  lastDomains: BotDomain[]
}

export interface ChatRequestV2 {
  projectId: string | null
  message: string
  history: ChatMessage[]
  pageContext?: PageContextV1
  conversationState?: ConversationStateV1
}

/** A source is safe to render only after the server verifier accepts its internal href. */
export interface BotSource {
  id: string
  domain: BotDomain
  entityType: BotEntityType
  entityId: string
  projectId: string | null
  title: string
  href: string
  updatedAt: string | null
  qualifier?: BotEntityQualifier
  excerpt?: string
}

interface ChatStreamEventBase {
  v: typeof CHAT_PROTOCOL_VERSION
  requestId: string
}

export interface ChatStatusEvent extends ChatStreamEventBase {
  type: 'status'
  message: string
}

export interface ChatDeltaEvent extends ChatStreamEventBase {
  type: 'delta'
  text: string
}

export interface ChatSourcesEvent extends ChatStreamEventBase {
  type: 'sources'
  items: BotSource[]
}

export interface ChatStateEvent extends ChatStreamEventBase {
  type: 'state'
  conversationState: ConversationStateV1
}

export interface ChatDoneEvent extends ChatStreamEventBase {
  type: 'done'
  asOf: string
  tools: string[]
  truncated: boolean
}

export interface ChatErrorEvent extends ChatStreamEventBase {
  type: 'error'
  code: string
  message: string
  retryable: boolean
}

export type ChatTerminalEvent = ChatDoneEvent | ChatErrorEvent
export type ChatStreamEvent =
  | ChatStatusEvent
  | ChatDeltaEvent
  | ChatSourcesEvent
  | ChatStateEvent
  | ChatTerminalEvent

export interface ChatRequestValidationError {
  code: 'INVALID_JSON' | 'INVALID_REQUEST' | 'UNSUPPORTED_CONTEXT_VERSION'
  message: string
  status: 400
}

export type ChatRequestValidationResult =
  | { ok: true; value: ChatRequestV2 }
  | { ok: false; error: ChatRequestValidationError }

const DOMAINS = new Set<BotDomain>(BOT_DOMAINS)
const ENTITY_TYPES = new Set<BotEntityType>(BOT_ENTITY_TYPES)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const FILTER_KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/
const MAX_MESSAGE = 2_000
const MAX_HISTORY = 12
const MAX_HISTORY_CONTENT = 4_000
const MAX_PATHNAME = 2_048
const MAX_ID = 256
const MAX_FILTERS = 24
const MAX_FILTER_STRING = 500
const MAX_FILTER_ARRAY = 24
const MAX_LAST_ENTITIES = 10

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clippedString(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null
}

function nullableString(value: unknown, max: number): string | null | undefined {
  if (value === null) return null
  return clippedString(value, max) ?? undefined
}

function validDate(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || !DATE_RE.test(value)) return undefined
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? value
    : undefined
}

function sanitizeQualifier(value: unknown): BotEntityQualifier | undefined {
  if (!isRecord(value)) return undefined
  const occurrenceDate = validDate(value.occurrenceDate)
  const anchor = clippedString(value.anchor, 256) ?? undefined
  const out: BotEntityQualifier = {}
  if (typeof occurrenceDate === 'string') out.occurrenceDate = occurrenceDate
  if (anchor) out.anchor = anchor
  return Object.keys(out).length ? out : undefined
}

function sanitizeEntity(value: unknown): BotEntityRef | null {
  if (!isRecord(value) || !ENTITY_TYPES.has(value.type as BotEntityType)) return null
  const id = clippedString(value.id, MAX_ID)?.trim()
  if (!id) return null
  const qualifier = sanitizeQualifier(value.qualifier)
  return qualifier ? { type: value.type as BotEntityType, id, qualifier } : { type: value.type as BotEntityType, id }
}

function sanitizeFilters(value: unknown): Record<string, BotFilterValue> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, BotFilterValue> = Object.create(null) as Record<string, BotFilterValue>
  let accepted = 0
  for (const [key, raw] of Object.entries(value)) {
    if (accepted >= MAX_FILTERS || !FILTER_KEY_RE.test(key) || key === '__proto__' || key === 'constructor') continue
    let safe: BotFilterValue | undefined
    if (raw === null || typeof raw === 'boolean') safe = raw
    else if (typeof raw === 'number' && Number.isFinite(raw)) safe = raw
    else if (typeof raw === 'string') safe = raw.slice(0, MAX_FILTER_STRING)
    else if (Array.isArray(raw) && raw.every(x => typeof x === 'string')) {
      safe = raw.slice(0, MAX_FILTER_ARRAY).map(x => x.slice(0, MAX_FILTER_STRING))
    }
    if (safe !== undefined) {
      out[key] = safe
      accepted++
    }
  }
  return accepted ? out : undefined
}

function sanitizePageContext(value: unknown): PageContextV1 | null | 'unsupported' {
  if (!isRecord(value)) return null
  if (value.contextVersion !== 1) return 'unsupported'
  const pathname = clippedString(value.pathname, MAX_PATHNAME)
  if (
    !pathname
    || !pathname.startsWith('/')
    || pathname.startsWith('//')
    || /[\\\u0000-\u001f\u007f]/.test(pathname)
    || value.timezone !== CHAT_TIMEZONE
  ) return null
  const domain = DOMAINS.has(value.domain as BotDomain) ? value.domain as BotDomain : 'unknown'
  const projectId = value.projectId === null ? null : clippedString(value.projectId, MAX_ID)?.trim()
  if (projectId === undefined || projectId === '') return null
  let selectedProjectId: string | null | undefined
  if (value.selectedProjectId !== undefined) {
    selectedProjectId = value.selectedProjectId === null
      ? null
      : clippedString(value.selectedProjectId, MAX_ID)?.trim()
    if (selectedProjectId === undefined || selectedProjectId === '') return null
  }
  const selectedEntity = value.selectedEntity === null ? null : sanitizeEntity(value.selectedEntity)
  const view = nullableString(value.view, 128)
  const date = validDate(value.date)
  const weekStart = validDate(value.weekStart)
  let range: PageContextV1['range']
  if (value.range === null) range = null
  else if (isRecord(value.range)) {
    const from = validDate(value.range.from)
    const to = validDate(value.range.to)
    if (from !== undefined && to !== undefined) range = { from, to }
  }
  const filters = sanitizeFilters(value.filters)
  const search = nullableString(value.search, 500)
  return {
    contextVersion: 1,
    pathname,
    domain,
    projectId: projectId ?? null,
    ...(selectedProjectId !== undefined ? { selectedProjectId } : {}),
    ...(value.selectedEntity !== undefined ? { selectedEntity } : {}),
    ...(view !== undefined ? { view } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(weekStart !== undefined ? { weekStart } : {}),
    ...(range !== undefined ? { range } : {}),
    ...(filters ? { filters } : {}),
    ...(search !== undefined ? { search } : {}),
    timezone: CHAT_TIMEZONE,
  }
}

function sanitizeConversationState(value: unknown): ConversationStateV1 | null | 'unsupported' {
  if (!isRecord(value)) return null
  if (value.version !== 1) return 'unsupported'
  const entities: ConversationEntityV1[] = []
  if (Array.isArray(value.lastEntities)) {
    for (const raw of value.lastEntities.slice(0, MAX_LAST_ENTITIES)) {
      const entity = sanitizeEntity(raw)
      if (!entity || !isRecord(raw)) continue
      const ref = clippedString(raw.ref, 80)?.trim()
      const title = clippedString(raw.title, 300)?.trim()
      const projectId = raw.projectId === null ? null : clippedString(raw.projectId, MAX_ID)?.trim()
      if (!ref || !title || projectId === undefined || projectId === '') continue
      entities.push({ ...entity, ref, title, projectId: projectId ?? null })
    }
  }
  const lastDomains = Array.isArray(value.lastDomains)
    ? [...new Set(value.lastDomains.filter((d): d is BotDomain => DOMAINS.has(d as BotDomain)))].slice(0, 6)
    : []
  return { version: 1, lastEntities: entities, lastDomains }
}

function sanitizeHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  const history: ChatMessage[] = []
  // 슬라이스 전에 스캔 창을 캡해 초대형 배열의 O(n) 순회를 차단한다(리뷰 M-5).
  // 뒤쪽 항목이 최신이므로 유효 항목이 섞여 있어도 MAX_HISTORY를 채우기에 충분하다.
  for (const raw of value.slice(-MAX_HISTORY * 4)) {
    if (!isRecord(raw) || (raw.role !== 'user' && raw.role !== 'assistant') || typeof raw.content !== 'string') continue
    history.push({ role: raw.role, content: raw.content.slice(0, MAX_HISTORY_CONTENT) })
  }
  return history.slice(-MAX_HISTORY)
}

export function sanitizeChatRequestV2(raw: unknown): ChatRequestValidationResult {
  if (!isRecord(raw)) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: '잘못된 요청입니다.', status: 400 } }
  }
  const message = typeof raw.message === 'string' ? raw.message.trim() : ''
  if (!message || message.length > MAX_MESSAGE) {
    return {
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: !message ? '질문을 입력하세요.' : '질문이 너무 깁니다.',
        status: 400,
      },
    }
  }
  const projectId = raw.projectId === null || raw.projectId === undefined
    ? null
    : clippedString(raw.projectId, MAX_ID)?.trim()
  if (projectId === undefined || projectId === '') {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: 'projectId 형식이 잘못되었습니다.', status: 400 } }
  }
  const pageContext = raw.pageContext === undefined ? undefined : sanitizePageContext(raw.pageContext)
  const conversationState = raw.conversationState === undefined
    ? undefined
    : sanitizeConversationState(raw.conversationState)
  if (pageContext === 'unsupported' || conversationState === 'unsupported') {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_CONTEXT_VERSION', message: '지원하지 않는 문맥 버전입니다.', status: 400 },
    }
  }
  if (pageContext === null || conversationState === null) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: '문맥 형식이 잘못되었습니다.', status: 400 } }
  }
  return {
    ok: true,
    value: {
      projectId: projectId ?? null,
      message,
      history: sanitizeHistory(raw.history),
      ...(pageContext ? { pageContext } : {}),
      ...(conversationState ? { conversationState } : {}),
    },
  }
}

/** One JSON object per line. Keeping framing here makes route and tests share the exact wire contract. */
export function encodeChatStreamEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`)
}
