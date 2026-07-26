// 회의록 기반 Wiki 도메인 — I/O 없는 정규화·분류 규칙의 단일 정본.
// LLM은 semantic relation 후보를 제시할 뿐이며, 실제 change_type과 자동 반영 가능 여부는
// 아래 결정적 함수가 시간·고정·명시성 규칙을 적용해 판정한다.

export const WIKI_TOPIC_TYPES = [
  'process', 'system', 'interface', 'data', 'policy', 'glossary', 'general',
] as const
export type WikiTopicType = (typeof WIKI_TOPIC_TYPES)[number]

export const WIKI_ITEM_KINDS = [
  'decision', 'fact', 'action', 'question', 'risk', 'constraint', 'rationale',
] as const
export type WikiItemKind = (typeof WIKI_ITEM_KINDS)[number]

export const WIKI_LIFECYCLE_STATES = [
  'active', 'open', 'resolved', 'superseded', 'conflicted', 'archived',
] as const
export type WikiLifecycleState = (typeof WIKI_LIFECYCLE_STATES)[number]

export const WIKI_CERTAINTIES = ['explicit', 'tentative'] as const
export type WikiCertainty = (typeof WIKI_CERTAINTIES)[number]

export const WIKI_DECISION_STATES = ['proposed', 'tentative', 'confirmed', 'reversed'] as const
export type WikiDecisionState = (typeof WIKI_DECISION_STATES)[number]

export const WIKI_ORIGINS = ['ai', 'manual'] as const
export type WikiOrigin = (typeof WIKI_ORIGINS)[number]

export const WIKI_SOURCE_RELATIONS = ['supports', 'contradicts', 'resolves'] as const
export type WikiSourceRelation = (typeof WIKI_SOURCE_RELATIONS)[number]

export const WIKI_RELATION_TYPES = [
  'confirms', 'supersedes', 'contradicts', 'implements', 'blocks', 'depends_on',
] as const
export type WikiRelationType = (typeof WIKI_RELATION_TYPES)[number]

export const WIKI_CHANGE_TYPES = [
  'new', 'reaffirm', 'refine', 'supersede', 'reverse', 'conflict', 'resolve', 'retract',
] as const
export type WikiChangeType = (typeof WIKI_CHANGE_TYPES)[number]

export const WIKI_PROCESSING_STATUSES = ['pending', 'running', 'done', 'dead_letter'] as const
export type WikiProcessingStatus = (typeof WIKI_PROCESSING_STATUSES)[number]

/** LLM 비교 결과를 앱의 제한된 change_type으로 매핑하기 위한 입력 어휘. */
export const WIKI_SEMANTIC_RELATIONS = [
  'same', 'confirms', 'refines', 'supersedes', 'reverses',
  'contradicts', 'resolves', 'unrelated',
] as const
export type WikiSemanticRelation = (typeof WIKI_SEMANTIC_RELATIONS)[number]

export interface WikiComparableItem {
  statement: string
  /** 정규화된 동일 속성 키. 같은 key의 다른 값은 명시적 관계가 없으면 충돌이다. */
  knowledgeKey: string
  certainty: WikiCertainty
  observedAt: string | null
  validFrom: string | null
  autoUpdateLocked: boolean
}

export interface WikiIncomingItem {
  statement: string
  knowledgeKey: string
  certainty: WikiCertainty
  observedAt: string | null
  validFrom: string | null
}

const DASHES_RE = /[‐‑‒–—―]/g
const EDGE_PUNCTUATION_RE = /[.!?。！？]+$/u

function normalizeUnicodeAndSpace(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/**
 * 토픽 유니크 키용 정규화.
 * 대시 변형과 구분자 주변 공백, 영문 대소문자만 수렴시키며 의미 있는 일반 공백은 보존한다.
 */
export function normalizeWikiTitle(value: string): string {
  return normalizeUnicodeAndSpace(value)
    .replace(DASHES_RE, '-')
    .replace(/\s*([/·:-])\s*/g, '$1')
    .toLowerCase()
}

/**
 * statement_hash 입력용 정규화. 문장 끝 마침표와 표기 대소문자 차이로 불필요한 새 항목이
 * 생기지 않게 하되, 문장 내부의 부정·수치·날짜·기호는 제거하지 않는다.
 */
export function normalizeWikiStatement(value: string): string {
  return normalizeUnicodeAndSpace(value)
    .replace(DASHES_RE, '-')
    .replace(EDGE_PUNCTUATION_RE, '')
    .trim()
    .toLowerCase()
}

/** LLM/사용자 facet을 URL과 복합키에 안전한 결정적 토큰으로 정규화한다. */
export function normalizeWikiKnowledgeKey(value: string): string {
  return normalizeUnicodeAndSpace(value)
    .replace(DASHES_RE, '-')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
}

/** 프로젝트 내 topic/kind/facet 조합의 안정 knowledge_key. 빈 facet은 kind 자체를 쓴다. */
export function buildWikiKnowledgeKey(
  normalizedTopic: string,
  kind: WikiItemKind,
  facet?: string | null,
): string {
  const topicPart = normalizeWikiKnowledgeKey(normalizedTopic)
  const facetPart = normalizeWikiKnowledgeKey(facet ?? '') || kind
  return `${topicPart}:${kind}:${facetPart}`
}

// src/lib/minutes/blocks.ts와 같은 UTF-16 code-unit FNV-1a 64bit.
const FNV_OFFSET = BigInt('0xcbf29ce484222325')
const FNV_PRIME = BigInt('0x100000001b3')

/** 정규화된 statement의 16자리 안정 해시. 원문 body_hash가 아니라 지식 중복 판정용이다. */
export function wikiStatementHash(statement: string): string {
  const normalized = normalizeWikiStatement(statement)
  let hash = FNV_OFFSET
  for (let index = 0; index < normalized.length; index += 1) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(normalized.charCodeAt(index))) * FNV_PRIME)
  }
  return hash.toString(16).padStart(16, '0')
}

function temporalValue(item: Pick<WikiComparableItem, 'observedAt' | 'validFrom'>): number | null {
  // 명시된 효력일이 있으면 회의/업로드 시각보다 우선한다. 예: 7/20 회의에서
  // "8/1부터 전환"한 지식은 7/25에 관찰된 즉시 효력 지식보다 뒤에 놓여야 한다.
  for (const raw of [item.validFrom, item.observedAt]) {
    if (!raw) continue
    const value = Date.parse(raw)
    if (Number.isFinite(value)) return value
  }
  return null
}

/**
 * 시간 순서: -1=incoming이 과거, 0=동시/둘 다 미상, 1=incoming이 최신.
 * 한쪽만 시점이 있으면 명시 시점이 있는 항목을 더 신뢰할 수 있는 최신 입력으로 취급한다.
 */
export function compareWikiTemporalOrder(
  existing: Pick<WikiComparableItem, 'observedAt' | 'validFrom'>,
  incoming: Pick<WikiIncomingItem, 'observedAt' | 'validFrom'>,
): -1 | 0 | 1 {
  const previous = temporalValue(existing)
  const next = temporalValue(incoming)
  if (previous === null && next === null) return 0
  if (previous === null) return 1
  if (next === null) return -1
  if (next < previous) return -1
  if (next > previous) return 1
  return 0
}

/**
 * 기존 지식 + LLM의 제한된 의미 관계를 change event 값으로 분류한다.
 * 관계가 불명확한 같은 knowledge_key의 다른 문장은 안전하게 conflict로 내리고,
 * 다른 key는 독립적인 new 항목으로 취급한다.
 */
export function classifyWikiChange(
  existing: WikiComparableItem | null,
  incoming: WikiIncomingItem,
  semanticRelation?: WikiSemanticRelation | null,
): WikiChangeType {
  if (!existing) return 'new'

  if (
    wikiStatementHash(existing.statement) === wikiStatementHash(incoming.statement)
    || semanticRelation === 'same'
    || semanticRelation === 'confirms'
  ) return 'reaffirm'

  switch (semanticRelation) {
    case 'refines': return 'refine'
    case 'supersedes': return 'supersede'
    case 'reverses': return 'reverse'
    case 'contradicts': return 'conflict'
    case 'resolves': return 'resolve'
    case 'unrelated': return 'new'
    default:
      return normalizeWikiKnowledgeKey(existing.knowledgeKey)
        === normalizeWikiKnowledgeKey(incoming.knowledgeKey)
        ? 'conflict'
        : 'new'
  }
}

/**
 * 결재 없는 자동 반영의 안전 게이트.
 * - new/reaffirm은 현재값을 파괴하지 않으므로 허용
 * - conflict는 절대 자동 해결하지 않음
 * - 고정 항목은 재확인 근거만 추가 가능
 * - refine/supersede/reverse/resolve는 명시적이고 기존보다 과거가 아닐 때만 허용
 */
export function canAutoApplyWikiChange(
  change: WikiChangeType,
  existing: WikiComparableItem | null,
  incoming: WikiIncomingItem,
): boolean {
  if (change === 'conflict') return false
  if (change === 'new') return true
  if (!existing) return false
  if (change === 'reaffirm') return true
  if (existing.autoUpdateLocked) return false
  if (incoming.certainty !== 'explicit') return false
  return compareWikiTemporalOrder(existing, incoming) >= 0
}

/** 새 항목의 기본 상태. 실행·질문·리스크는 open, 나머지는 active로 시작한다. */
export function initialWikiLifecycleState(kind: WikiItemKind): WikiLifecycleState {
  return kind === 'action' || kind === 'question' || kind === 'risk' ? 'open' : 'active'
}

/** change 적용 시 기존 항목이 가져야 할 상태(새 항목 상태가 아님). */
export function previousWikiLifecycleAfterChange(
  current: WikiLifecycleState,
  change: WikiChangeType,
): WikiLifecycleState {
  if (change === 'supersede' || change === 'reverse') return 'superseded'
  if (change === 'resolve') return 'resolved'
  if (change === 'retract') return 'archived'
  if (change === 'conflict') return 'conflicted'
  return current
}
