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

/**
 * 회의 진행상의 묶음 제목. 지속되는 대상이 아니라 그날 안건지의 목차라서 주제가 될 수 없다.
 *
 * 이걸 막지 않으면 카탈로그가 흡인체를 만든다: 한 회의에서 "향후 추진 계획"이 주제로 한 번
 * 생기면 이후 모든 회의의 LLM이 카탈로그에서 그 이름을 보고 온갖 지식을 거기에 몰아넣는다
 * (2026-07-27 실측: 재구축 직후 156건 중 67건이 "향후 추진 계획" 한 주제에 쌓임).
 *
 * 부분 문자열이 아니라 제목 전체가 목차형일 때만 걸러야 한다 — "야드 관리 개선 사항"은
 * 실재하는 대상이고 "개선 사항"만 목차다.
 */
const AGENDA_TOPIC_PATTERNS = [
  /^(?:향후)?(?:추진)?(?:계획|일정)$/,
  /^(?:기타|안건|논의|협의|검토|공유|보고|요청|참고|특이|개선|이슈|결정|합의|조치|확인)(?:사항|안건|내용)?$/,
  /^(?:회의)?(?:안건|내용|결과|요약|목적|개요)$/,
  /^(?:액션아이템|actionitems?|후속조치|차기회의|진행상황|진행현황|주요내용|주요논의|기타논의|논의사항정리)$/,
  /^(?:general|misc|other|others|etc|todo|nextsteps?|followups?)$/,
]

export function isAgendaStyleWikiTopic(title: string): boolean {
  const compact = normalizeWikiTitle(title).replace(/\s+/g, '')
  if (!compact) return true
  return AGENDA_TOPIC_PATTERNS.some((pattern) => pattern.test(compact))
}

/**
 * 목차형 제목이 오면 그 지식이 실제로 다루는 대상(facet)을 주제로 삼는다.
 * facet도 목차형이면 원래 제목을 그대로 둔다 — 문장에서 억지로 주제를 만들면
 * 매 회의 다른 주제가 생겨 파편화가 되돌아온다.
 */
export function resolveWikiTopicTitle(rawTopic: string, facet: string | null | undefined): string {
  if (!isAgendaStyleWikiTopic(rawTopic)) return rawTopic
  const candidate = (facet ?? '').trim()
  if (candidate && !isAgendaStyleWikiTopic(candidate)) return candidate
  return rawTopic
}

/**
 * 정규화된 주제 제목의 비교용 토큰. 한국어는 형태소 분석 없이 어절 단위로 본다.
 * 조사가 붙은 어절은 다른 토큰이 되므로 매칭이 느슨해지지 않는다.
 */
export function wikiTopicTokens(normalizedTitle: string): string[] {
  return normalizedTitle
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean)
}

/** Sørensen-Dice 계수(0~1). 토큰 집합 기준이라 어절 순서에 영향받지 않는다. */
export function wikiTopicSimilarity(a: string, b: string): number {
  const left = new Set(wikiTopicTokens(a))
  const right = new Set(wikiTopicTokens(b))
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

const TOPIC_ALIAS_MIN_SIMILARITY = 0.6
const TOPIC_ALIAS_MIN_SHARED_TOKENS = 2

export interface WikiTopicCandidate {
  id: string
  normalizedTitle: string
  /** 사람이 병합하며 흡수한 옛 제목들. 자동 매칭이 못 잇는 쌍을 사람이 이어준 결과다. */
  aliases?: string[]
}

/**
 * 같은 대상을 가리키는 기존 주제를 찾는다. LLM이 회의마다 제목을 새로 지어
 * 지식이 1주제 1항목으로 파편화되는 것을 막는 마지막 안전망이다.
 *
 * 의미 판단은 프롬프트의 기존 주제 카탈로그가 담당하고, 여기서는 문자열만 본다.
 * 잘못 합치면 서로 다른 지식이 한 knowledge_key에서 충돌하므로 보수적으로:
 * - 짧은 쪽(2어절 이상)이 긴 쪽에 완전히 포함되거나
 * - Dice 0.6 이상이면서 공유 어절이 2개 이상일 때만 같은 주제로 본다.
 * 후보가 여럿이면 유사도가 가장 높은 하나만 고른다(동점은 제목 순으로 결정적 선택).
 */
export function matchWikiTopicAlias(
  candidates: WikiTopicCandidate[],
  normalizedTitle: string,
): WikiTopicCandidate | null {
  const incoming = wikiTopicTokens(normalizedTitle)
  if (incoming.length === 0) return null
  const incomingSet = new Set(incoming)

  let best: { candidate: WikiTopicCandidate; score: number } | null = null
  for (const candidate of candidates) {
    if (candidate.normalizedTitle === normalizedTitle) {
      return candidate
    }
    // 사람이 병합으로 남긴 별칭은 문자열 유사도보다 강한 신호다. 이걸 안 보면 병합할 때마다
    // 다음 회의가 옛 제목으로 주제를 되살려 사람이 같은 병합을 영원히 반복하게 된다.
    if (candidate.aliases?.some((alias) => normalizeWikiTitle(alias) === normalizedTitle)) {
      return candidate
    }
    const tokens = wikiTopicTokens(candidate.normalizedTitle)
    if (tokens.length === 0) continue
    const tokenSet = new Set(tokens)
    let shared = 0
    for (const token of incomingSet) if (tokenSet.has(token)) shared += 1
    if (shared < TOPIC_ALIAS_MIN_SHARED_TOKENS) continue

    const shorterSize = Math.min(incomingSet.size, tokenSet.size)
    const contained = shared === shorterSize && shorterSize >= TOPIC_ALIAS_MIN_SHARED_TOKENS
    const score = (2 * shared) / (incomingSet.size + tokenSet.size)
    if (!contained && score < TOPIC_ALIAS_MIN_SIMILARITY) continue

    const effective = contained ? Math.max(score, TOPIC_ALIAS_MIN_SIMILARITY) : score
    if (
      !best
      || effective > best.score
      || (effective === best.score && candidate.normalizedTitle < best.candidate.normalizedTitle)
    ) {
      best = { candidate, score: effective }
    }
  }
  return best?.candidate ?? null
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
