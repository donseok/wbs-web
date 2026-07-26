import 'server-only'

import { generateAnswer } from '@/lib/ai/llm'
import { hasLLM } from '@/lib/ai/provider'
import { createAdminClient } from '@/lib/supabase/admin'
import { activeTeamCodesSync } from '@/lib/teams/master'
import {
  fnv1a64, isMarkableBlock, splitMinuteBlocks, type MinuteBlock,
} from '@/lib/minutes/blocks'
import {
  WIKI_SEMANTIC_RELATIONS,
  buildWikiKnowledgeKey,
  canAutoApplyWikiChange,
  classifyWikiChange,
  normalizeWikiKnowledgeKey,
  normalizeWikiStatement as normalizeDomainWikiStatement,
  normalizeWikiTitle,
  wikiStatementHash,
  type WikiSemanticRelation,
} from '@/lib/domain/wiki'

const ITEM_KINDS = [
  'decision', 'fact', 'action', 'question', 'risk', 'constraint', 'rationale',
] as const
const TOPIC_TYPES = [
  'process', 'system', 'interface', 'data', 'policy', 'glossary', 'general',
] as const
const DECISION_STATES = ['proposed', 'tentative', 'confirmed', 'reversed'] as const
const SOURCE_RELATIONS = ['supports', 'contradicts', 'resolves'] as const

type WikiItemKind = typeof ITEM_KINDS[number]
type WikiTopicType = typeof TOPIC_TYPES[number]
type WikiDecisionState = typeof DECISION_STATES[number]
type WikiSourceRelation = typeof SOURCE_RELATIONS[number]
type WikiCertainty = 'explicit' | 'tentative'

export interface ExtractedWikiItem {
  kind: WikiItemKind
  topic: string
  topicType: WikiTopicType
  statement: string
  knowledgeKey: string
  certainty: WikiCertainty
  decisionState: WikiDecisionState | null
  relation: WikiSourceRelation
  semanticRelation: WikiSemanticRelation | null
  evidenceIndexes: number[]
  ownerTeam: string | null
  ownerName: string | null
  dueDate: string | null
  effectiveDate: string | null
}

export interface WikiProcessSummary {
  created: number
  changed: number
  reaffirmed: number
  conflicted: number
}

type Row = Record<string, unknown>

const ITEMS_CAP = 40
const STATEMENT_CAP = 1000
const TOPIC_CAP = 120
const KEY_CAP = 160
const BLOCK_TEXT_CAP = 1200
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TENTATIVE_RE =
  /(?:검토|논의|고려|제안|예정|가능성|잠정|보류|협의|추후|할\s*수\s*있|필요할\s*수|might|may|consider|propos|tentative|TBD)/i
const EXPLICIT_RE =
  /(?:확정|결정|합의|승인|하기로|로\s*한다|완료|철회|취소|변경한다|confirmed|decided|agreed|completed|cancelled|reversed)/i
const CONTRADICTION_RE =
  /(?:아니|철회|취소|폐기|대신|변경|반대|불가|중단|not|cancel|withdraw|instead|reverse|conflict)/i
const CONFIRM_RE =
  /(?:재확인|그대로\s*유지|유지하기로|변경\s*(?:없|하지\s*않)|다시\s*확인|reconfirm|remain|unchanged)/i
const REFINE_RE =
  /(?:추가로|추가한다|보완|구체화|상세화|범위를\s*넓|refin|clarif|elaborat|in addition)/i
const SUPERSEDE_RE =
  /(?:대신|로\s*변경|으로\s*변경|전환|교체|부터는|기존.+변경|supersed|replace|switch|instead)/i
const REVERSE_RE =
  /(?:철회|취소|폐기|무효|번복|withdraw|cancel|revers|revoke)/i
const RESOLVE_RE =
  /(?:완료|해결|해소|종료|조치\s*완료|닫기로|completed|resolved|closed|fixed)/i

const EXTRACTION_SYSTEM = [
  '너는 프로젝트 회의록에서 "근거가 추적되는 현재 지식"만 추출하는 분석기다.',
  '입력은 [블록번호] 원문 목록이다. 반드시 원문에 명시된 내용만 사용하고 추론하거나 보완하지 마라.',
  '',
  'kind:',
  '- decision: 명시적으로 확정/합의/철회된 결정',
  '- fact: 현재 상태나 사실로 명시된 내용',
  '- action: 담당자가 수행해야 하거나 완료했다고 명시된 일',
  '- question: 아직 답이 정해지지 않은 질문/논의점',
  '- risk: 우려, 장애, 차질 가능성',
  '- constraint: 반드시 지켜야 하는 제약/정책/조건',
  '- rationale: 결정의 이유로 명시된 내용',
  '',
  '규칙:',
  '1. 검토/제안/예정/가능/잠정/보류는 certainty="tentative"이며 현재 확정 지식을 바꾸지 않는다.',
  '2. 확정/결정/합의/완료처럼 문장에 명시된 경우만 certainty="explicit"이다.',
  '3. 같은 의미의 지식을 후속 회의에서도 찾을 수 있도록 knowledgeKey를 짧고 안정적인 명사구로 작성한다.',
  '4. evidence는 해당 내용을 직접 뒷받침하는 블록번호 배열이며 최소 1개다.',
  '5. 기존 내용을 철회/반박하면 relation="contradicts", 액션·리스크가 해소/완료되면 relation="resolves", 그 외 supports.',
  '6. 기존 Wiki 항목은 입력에 없으므로 semanticRelation은 원문 문장 자체에 재확인/보완/변경/철회/반박/해소가 명시된 경우에만 해당 관계를 쓰고, 그 외에는 null이다.',
  '7. decisionState는 decision에만 proposed|tentative|confirmed|reversed 중 하나, 그 외 null.',
  '8. owner/due/effective는 원문에 명시된 경우만 채우고 아니면 null.',
  '9. 한 문장에 "기존 결정을 철회하고 새 대안을 확정"이 함께 있으면, 철회 항목과 새 확정 항목을 각각 분리해 출력한다.',
  '10. 최대 30개. JSON 외 텍스트를 출력하지 마라.',
  '',
  '출력 형식:',
  '{"items":[{"kind":"decision","topic":"인터페이스 연계","topicType":"interface",',
  '"statement":"ERP와 MES 연계는 REST API를 사용하기로 확정했다.",',
  '"knowledgeKey":"ERP-MES 연계 방식","certainty":"explicit","decisionState":"confirmed",',
  '"relation":"supports","semanticRelation":null,"evidence":[12],"ownerTeam":"ERP","ownerName":null,',
  '"dueDate":null,"effectiveDate":null}]}',
].join('\n')

function oneOf<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T[number]
    : null
}

function nullableText(value: unknown, cap = 120): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, cap) : null
}

export function normalizeWikiTopic(value: string): string {
  return normalizeWikiTitle(value).slice(0, TOPIC_CAP)
}

export function normalizeKnowledgeKey(value: string): string {
  return normalizeWikiKnowledgeKey(value).slice(0, KEY_CAP)
}

export function normalizeWikiStatement(value: string): string {
  return normalizeDomainWikiStatement(value)
}

/** 표시 문장은 원문 표기(REST API, 제품명, 종결부호)를 보존하고 해시 계산만 별도 정규화한다. */
function normalizeWikiDisplayStatement(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, STATEMENT_CAP)
}

function guardedCertainty(
  requested: WikiCertainty,
  evidence: MinuteBlock[],
  kind: WikiItemKind,
): WikiCertainty {
  if (requested === 'tentative') return requested
  const source = evidence.map(block => block.text).join(' ')
  if (TENTATIVE_RE.test(source) && !EXPLICIT_RE.test(source)) return 'tentative'
  // 결정은 단순 서술을 LLM이 과대 해석하지 못하게, 원문에 확정/합의/철회 표지가
  // 실제로 있을 때만 현재 지식 후보로 승격한다.
  if (kind === 'decision' && !EXPLICIT_RE.test(source)) return 'tentative'
  return 'explicit'
}

function guardedSemanticRelation(
  requested: WikiSemanticRelation | null,
  evidenceText: string,
): WikiSemanticRelation | null {
  switch (requested) {
    case 'confirms': return CONFIRM_RE.test(evidenceText) ? requested : null
    case 'refines': return REFINE_RE.test(evidenceText) ? requested : null
    case 'supersedes': return SUPERSEDE_RE.test(evidenceText) ? requested : null
    case 'reverses': return REVERSE_RE.test(evidenceText) ? requested : null
    case 'contradicts': return CONTRADICTION_RE.test(evidenceText) ? requested : null
    case 'resolves': return RESOLVE_RE.test(evidenceText) ? requested : null
    // 기존 항목을 프롬프트로 주지 않기 때문에 same/unrelated는 모델이 판정할 수 없다.
    // 동일 문장은 statement hash가, 다른 key는 결정형 분류기가 각각 처리한다.
    case 'same':
    case 'unrelated':
    default:
      return null
  }
}

/**
 * LLM 응답을 관용적으로 파싱하되, 근거 블록·열거값·길이·날짜를 결정형으로 다시 검증한다.
 * 코드펜스/설명 문구가 붙어도 첫 객체 또는 배열만 해석한다.
 */
export function parseExtractedWikiItems(
  raw: string,
  blocks: MinuteBlock[],
): ExtractedWikiItem[] | null {
  const objectStart = raw.indexOf('{')
  const objectEnd = raw.lastIndexOf('}')
  const arrayStart = raw.indexOf('[')
  const arrayEnd = raw.lastIndexOf(']')
  let parsed: unknown
  try {
    if (objectStart >= 0 && objectEnd > objectStart) {
      parsed = JSON.parse(raw.slice(objectStart, objectEnd + 1))
    } else if (arrayStart >= 0 && arrayEnd > arrayStart) {
      parsed = JSON.parse(raw.slice(arrayStart, arrayEnd + 1))
    } else {
      return null
    }
  } catch {
    return null
  }

  const candidates = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Row).items)
      ? (parsed as Row).items as unknown[]
      : null
  if (!candidates) return null

  const teams = new Set<string>(activeTeamCodesSync())
  const seen = new Set<string>()
  const items: ExtractedWikiItem[] = []
  for (const candidate of candidates) {
    if (items.length >= ITEMS_CAP) break
    if (typeof candidate !== 'object' || candidate === null) continue
    const item = candidate as Row
    const kind = oneOf(item.kind, ITEM_KINDS)
    const topic = nullableText(item.topic, TOPIC_CAP)
    const topicType = oneOf(item.topicType, TOPIC_TYPES) ?? 'general'
    const rawStatement = nullableText(item.statement, STATEMENT_CAP)
    if (!kind || !topic || !rawStatement) continue
    const statement = normalizeWikiDisplayStatement(rawStatement)
    if (!statement) continue

    const rawEvidence = Array.isArray(item.evidence)
      ? item.evidence
      : Array.isArray(item.evidenceIndexes) ? item.evidenceIndexes : []
    const evidenceIndexes = Array.from(new Set(rawEvidence.filter(
      (index): index is number =>
        typeof index === 'number' && Number.isInteger(index)
        && !!blocks[index] && isMarkableBlock(blocks[index]),
    ))).slice(0, 8)
    if (evidenceIndexes.length === 0) continue
    const evidence = evidenceIndexes.map(index => blocks[index])

    const requestedCertainty = item.certainty === 'explicit' ? 'explicit' : 'tentative'
    const certainty = guardedCertainty(requestedCertainty, evidence, kind)
    let decisionState = kind === 'decision' ? oneOf(item.decisionState, DECISION_STATES) : null
    if (kind === 'decision') {
      const decisionEvidence = evidence.map(block => block.text).join(' ')
      if (decisionState === 'reversed' && !REVERSE_RE.test(decisionEvidence)) {
        decisionState = certainty === 'explicit' ? 'confirmed' : 'tentative'
      }
      if (certainty === 'tentative' && decisionState === 'confirmed') decisionState = 'tentative'
      decisionState ??= certainty === 'explicit' ? 'confirmed' : 'tentative'
    }

    let relation = oneOf(item.relation, SOURCE_RELATIONS) ?? 'supports'
    const evidenceText = evidence.map(block => block.text).join(' ')
    if (relation === 'contradicts' && !CONTRADICTION_RE.test(evidenceText)) relation = 'supports'
    if (relation === 'resolves' && !RESOLVE_RE.test(evidenceText)) relation = 'supports'

    const facet = nullableText(item.knowledgeKey, KEY_CAP) ?? statement.slice(0, 80)
    const knowledgeKey = buildWikiKnowledgeKey(normalizeWikiTopic(topic), kind, facet).slice(0, KEY_CAP)
    if (!knowledgeKey) continue
    const dedupeKey = `${kind}:${normalizeWikiTopic(topic)}:${knowledgeKey}:${wikiStatementHash(statement)}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const ownerTeamRaw = nullableText(item.ownerTeam, 40)
    const dueDateRaw = nullableText(item.dueDate, 10)
    const effectiveDateRaw = nullableText(item.effectiveDate, 10)
    items.push({
      kind,
      topic,
      topicType,
      statement,
      knowledgeKey,
      certainty,
      decisionState,
      relation,
      semanticRelation: guardedSemanticRelation(
        oneOf(item.semanticRelation, WIKI_SEMANTIC_RELATIONS),
        evidenceText,
      ),
      evidenceIndexes,
      ownerTeam: ownerTeamRaw && teams.has(ownerTeamRaw) ? ownerTeamRaw : null,
      ownerName: nullableText(item.ownerName, 100),
      dueDate: dueDateRaw && DATE_RE.test(dueDateRaw) ? dueDateRaw : null,
      effectiveDate: effectiveDateRaw && DATE_RE.test(effectiveDateRaw) ? effectiveDateRaw : null,
    })
  }
  return items
}

async function ensureTopic(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  item: ExtractedWikiItem,
): Promise<string> {
  const normalized = normalizeWikiTopic(item.topic)
  const { data: existing, error: readError } = await admin.from('wiki_topics')
    .select('id')
    .eq('project_id', projectId)
    .eq('normalized_title', normalized)
    .maybeSingle()
  if (readError) throw new Error(`TOPIC_READ:${readError.code ?? 'UNKNOWN'}`)
  if (existing) return existing.id as string

  const now = new Date().toISOString()
  const { data, error } = await admin.from('wiki_topics').insert({
    project_id: projectId,
    title: item.topic,
    normalized_title: normalized,
    type: item.topicType,
    owner_team: item.ownerTeam,
    last_changed_at: now,
  }).select('id').single()
  if (!error && data) return data.id as string
  if (error?.code === '23505') {
    const { data: raced } = await admin.from('wiki_topics')
      .select('id')
      .eq('project_id', projectId)
      .eq('normalized_title', normalized)
      .single()
    if (raced) return raced.id as string
  }
  throw new Error(`TOPIC_INSERT:${error?.code ?? 'UNKNOWN'}`)
}

async function findCurrentItem(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  topicId: string,
  item: ExtractedWikiItem,
): Promise<Row | null> {
  const { data, error } = await admin.from('wiki_items')
    .select('id, project_id, topic_id, kind, statement, statement_hash, knowledge_key, lifecycle_state, certainty, decision_state, owner_team, due_date, observed_at, valid_from, origin, auto_update_locked, created_at, updated_at')
    .eq('project_id', projectId)
    .eq('topic_id', topicId)
    .eq('kind', item.kind)
    .eq('knowledge_key', item.knowledgeKey)
    .in('lifecycle_state', ['active', 'open', 'conflicted'])
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`ITEM_READ:${error.code ?? 'UNKNOWN'}`)
  return data as Row | null
}

const WIKI_APPLY_OUTCOMES = ['created', 'changed', 'reaffirmed', 'conflicted'] as const

type WikiApplyOutcome = typeof WIKI_APPLY_OUTCOMES[number]

interface WikiApplyError {
  code?: string
  message?: string
  details?: string
}

function isWikiCurrentRace(error: WikiApplyError | null): boolean {
  return error?.code === '40001'
    || error?.message?.includes('WIKI_CURRENT_RACE') === true
    || error?.details?.includes('WIKI_CURRENT_RACE') === true
}

function isStaleMinuteVersion(error: WikiApplyError | null): boolean {
  return error?.message?.includes('WIKI_STALE_MINUTE_VERSION') === true
    || error?.details?.includes('WIKI_STALE_MINUTE_VERSION') === true
}

function isWikiJobLeaseLost(error: WikiApplyError | null): boolean {
  return error?.message?.includes('WIKI_JOB_LEASE_LOST') === true
    || error?.details?.includes('WIKI_JOB_LEASE_LOST') === true
}

function isWikiApplyOutcome(value: unknown): value is WikiApplyOutcome {
  return typeof value === 'string'
    && (WIKI_APPLY_OUTCOMES as readonly string[]).includes(value)
}

function wikiApplyIdempotencyKey(args: {
  projectId: string
  minuteVersionId: string
  applyGeneration: number
  item: ExtractedWikiItem
  statementHash: string
  sources: Array<{ block_index: number; block_hash: string }>
}): string {
  const sourceFingerprint = args.sources
    .map(source => `${source.block_index}:${source.block_hash}`)
    .sort()
  return JSON.stringify([
    'wiki-apply-v1',
    args.projectId,
    args.minuteVersionId,
    args.applyGeneration,
    args.item.kind,
    args.item.knowledgeKey,
    args.statementHash,
    args.item.relation,
    sourceFingerprint,
  ])
}

export async function applyExtractedItem(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    projectId: string
    jobId: number
    jobLockedBy: string
    minuteId: string
    minuteVersionId: string
    minuteVersionNo: number
    applyGeneration: number
    observedAt: string
    bodyHash: string
    blocks: MinuteBlock[]
    item: ExtractedWikiItem
  },
): Promise<keyof WikiProcessSummary> {
  const topicId = await ensureTopic(admin, args.projectId, args.item)
  const statementHash = wikiStatementHash(args.item.statement)
  const semanticRelation: WikiSemanticRelation | null =
    args.item.kind === 'decision' && args.item.decisionState === 'reversed'
      ? 'reverses'
      : args.item.semanticRelation
        ?? (args.item.relation === 'contradicts'
          ? 'contradicts'
          : args.item.relation === 'resolves' ? 'resolves' : null)
  const incoming = {
    statement: args.item.statement,
    knowledgeKey: args.item.knowledgeKey,
    certainty: args.item.certainty,
    observedAt: args.observedAt,
    validFrom: args.item.effectiveDate ? `${args.item.effectiveDate}T00:00:00.000Z` : null,
  }
  const sources = args.item.evidenceIndexes.map((index) => {
    const block = args.blocks[index]
    if (!block) throw new Error('WIKI_SOURCE_BLOCK_MISSING')
    return {
      block_index: block.index,
      block_hash: block.hash,
      evidence_excerpt: block.text.slice(0, 1000),
    }
  })
  const idempotencyKey = wikiApplyIdempotencyKey({
    projectId: args.projectId,
    minuteVersionId: args.minuteVersionId,
    applyGeneration: args.applyGeneration,
    item: args.item,
    statementHash,
    sources,
  })

  // 40001은 advisory lock 안에서 current가 달라졌다는 뜻이다. 같은 stale payload를
  // 재전송하지 않고 current 읽기와 결정형 분류부터 최대 세 번 다시 수행한다.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await findCurrentItem(admin, args.projectId, topicId, args.item)
    const comparable = current ? {
      statement: current.statement as string,
      knowledgeKey: current.knowledge_key as string,
      certainty: current.certainty as WikiCertainty,
      observedAt: (current.observed_at as string | null) ?? null,
      validFrom: (current.valid_from as string | null) ?? null,
      autoUpdateLocked:
        current.auto_update_locked === true || current.origin === 'manual',
    } : null
    const change = classifyWikiChange(comparable, incoming, semanticRelation)
    const canAutoApply = canAutoApplyWikiChange(change, comparable, incoming)

    const { data, error } = await admin.rpc('apply_wiki_extracted_item_atomic', {
      p_project_id: args.projectId,
      p_topic_id: topicId,
      p_wiki_job_id: args.jobId,
      p_job_locked_by: args.jobLockedBy,
      p_apply_generation: args.applyGeneration,
      p_minute_id: args.minuteId,
      p_minute_version_id: args.minuteVersionId,
      p_minute_version_no: args.minuteVersionNo,
      p_body_hash: args.bodyHash,
      p_kind: args.item.kind,
      p_statement: args.item.statement,
      p_statement_hash: statementHash,
      p_knowledge_key: args.item.knowledgeKey,
      p_certainty: args.item.certainty,
      p_decision_state: args.item.decisionState,
      p_source_relation: args.item.relation,
      p_requested_change: change,
      p_can_auto_apply: canAutoApply,
      p_observed_at: args.observedAt,
      p_valid_from: incoming.validFrom,
      p_owner_team: args.item.ownerTeam,
      p_owner_name: args.item.ownerName,
      p_due_date: args.item.dueDate,
      p_sources: sources,
      p_expected_current_id: current ? current.id as string : null,
      p_expected_current_hash: current ? current.statement_hash as string : null,
      p_expected_current_updated_at: current ? current.updated_at as string : null,
      p_idempotency_key: idempotencyKey,
    }).single()

    if (error) {
      if (isWikiJobLeaseLost(error as WikiApplyError)) {
        throw new Error('WIKI_JOB_LEASE_LOST')
      }
      if (isStaleMinuteVersion(error as WikiApplyError)) {
        throw new Error('WIKI_STALE_MINUTE_VERSION')
      }
      if (isWikiCurrentRace(error as WikiApplyError) && attempt < 2) continue
      if (isWikiCurrentRace(error as WikiApplyError)) {
        throw new Error('WIKI_APPLY_RACE_RETRY_EXHAUSTED')
      }
      throw new Error(`WIKI_ATOMIC_APPLY:${error.code ?? 'UNKNOWN'}`)
    }
    const result = data as { outcome?: unknown } | null
    if (!result || !isWikiApplyOutcome(result.outcome)) {
      throw new Error('WIKI_ATOMIC_APPLY_RESULT_INVALID')
    }
    return result.outcome
  }

  throw new Error('WIKI_APPLY_RACE_RETRY_EXHAUSTED')
}

async function extractItems(bodyMd: string, title: string, minuteDate: string): Promise<{
  blocks: MinuteBlock[]
  items: ExtractedWikiItem[]
}> {
  if (!hasLLM()) throw new Error('LLM_UNAVAILABLE')
  const blocks = splitMinuteBlocks(bodyMd)
  const markable = blocks.filter(isMarkableBlock)
  if (markable.length === 0) return { blocks, items: [] }
  const source = markable
    .map(block => `[${block.index}] ${block.text.slice(0, BLOCK_TEXT_CAP)}`)
    .join('\n')
  const raw = await generateAnswer(EXTRACTION_SYSTEM, [{
    role: 'user',
    content: `회의록 제목: ${title}\n회의일: ${minuteDate}\n\n${source}`,
  }])
  if (raw === null) throw new Error('LLM_GENERATION_FAILED')
  const items = parseExtractedWikiItems(raw, blocks)
  if (items === null) throw new Error('LLM_OUTPUT_INVALID')
  return { blocks, items }
}

function safeJobError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'UNKNOWN'
  const code = message.split(':', 1)[0].replace(/[^A-Z0-9_]/gi, '_').toUpperCase()
  return code.slice(0, 80) || 'UNKNOWN'
}

function minuteObservedAt(occurrenceDate: string, minuteCreatedAt: string): string {
  const parsed = new Date(minuteCreatedAt)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate) || Number.isNaN(parsed.getTime())) {
    return minuteCreatedAt
  }
  return `${occurrenceDate}T${parsed.toISOString().slice(11)}`
}

function wikiApplyGeneration(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return 0
  const value = (payload as Row).applyGeneration
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : 0
}

export async function enqueueMinuteWikiProcessing(args: {
  projectId: string | null
  minuteId: string
  minuteVersionId: string | null
  bodyMd: string
  force?: boolean
}): Promise<number | null> {
  if (!args.projectId) return null
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return null
  const admin = createAdminClient()
  const { data: minute, error: minuteError } = await admin.from('minutes')
    .select('id, title, minute_date, meeting_occurrence_date, project_id, archived_at, created_at')
    .eq('id', args.minuteId)
    .maybeSingle()
  if (minuteError || !minute) {
    console.error('[wiki] 작업 대상 회의록 조회 실패:', minuteError?.message ?? 'not found')
    return null
  }
  if (minute.archived_at || minute.project_id !== args.projectId) {
    console.error('[wiki] 보관됐거나 프로젝트가 다른 회의록의 작업 등록을 거부했습니다.')
    return null
  }

  const versionQuery = admin.from('minute_versions')
    .select('id, version_no, body_hash, body_md, created_at')
    .eq('minute_id', args.minuteId)
  const { data: version, error: versionError } = args.minuteVersionId
    ? await versionQuery.eq('id', args.minuteVersionId).maybeSingle()
    : await versionQuery.order('version_no', { ascending: false }).limit(1).maybeSingle()
  if (versionError || !version) {
    console.error('[wiki] 불변 회의록 버전 조회 실패:', versionError?.message ?? 'not found')
    return null
  }
  const minuteVersionId = version.id as string
  const bodyHash = version.body_hash as string
  if (
    bodyHash !== fnv1a64(version.body_md as string)
    || bodyHash !== fnv1a64(args.bodyMd)
  ) {
    console.error('[wiki] 작업 등록 본문과 불변 버전의 해시가 일치하지 않습니다.')
    return null
  }
  const now = new Date().toISOString()
  const findExisting = () => admin.from('wiki_processing_jobs')
    .select('id, status, payload, apply_generation, rerun_requested')
    .eq('project_id', args.projectId as string)
    .eq('minute_version_id', minuteVersionId)
    .maybeSingle()
  const { data: existing, error: existingError } = await findExisting()
  if (existingError) {
    console.error('[wiki] 기존 처리 작업 조회 실패:', existingError.message)
    return null
  }
  if (existing) {
    // force/재시도 상태 전이는 DB row lock 안에서 worker finish와 직렬화한다.
    // running force는 현재 lease를 건드리지 않고 다음 generation rerun만 예약한다.
    if (args.force === true || existing.status === 'dead_letter') {
      const { data: requested, error: requestError } = await admin
        .rpc('request_wiki_processing_job_run', {
          p_job_id: existing.id as number,
          p_force: args.force === true,
          p_payload: {
            minute: {
              projectId: args.projectId,
              title: minute.title,
              minuteDate: minute.minute_date,
              meetingOccurrenceDate: minute.meeting_occurrence_date,
              createdAt: minute.created_at,
            },
            version: {
              id: minuteVersionId,
              versionNo: version.version_no,
              createdAt: version.created_at,
            },
          },
        })
        .single()
      if (requestError || !requested) {
        console.error('[wiki] 처리 작업 재등록 실패:', requestError?.message ?? 'no row')
        return null
      }
      return (requested as { job_id: number }).job_id
    }
    return existing.id as number
  }

  const { data, error } = await admin.from('wiki_processing_jobs').insert({
    project_id: args.projectId,
    minute_id: args.minuteId,
    minute_version_id: minuteVersionId,
    body_hash: bodyHash,
    status: 'pending',
    attempts: 0,
    run_after: now,
    locked_at: null,
    locked_by: null,
    last_error: null,
    prompt_version: 'wiki-v1',
    apply_generation: 0,
    rerun_requested: false,
    payload: {
      applyGeneration: 0,
      minute: {
        projectId: args.projectId,
        title: minute.title,
        minuteDate: minute.minute_date,
        meetingOccurrenceDate: minute.meeting_occurrence_date,
        createdAt: minute.created_at,
      },
      version: {
        id: minuteVersionId,
        versionNo: version.version_no,
        createdAt: version.created_at,
      },
    },
    updated_at: now,
  }).select('id').single()
  if (error?.code === '23505') {
    const { data: raced, error: racedError } = await findExisting()
    if (!racedError && raced) return raced.id as number
  }
  if (error || !data) {
    console.error('[wiki] 처리 작업 등록 실패:', error?.message ?? 'no row')
    return null
  }
  return data.id as number
}

async function failJob(
  admin: ReturnType<typeof createAdminClient>,
  job: Row,
  error: unknown,
): Promise<void> {
  const attempts = (job.attempts as number | undefined) ?? 1
  const backoffMinutes = Math.min(60, 2 ** Math.min(attempts, 6))
  const { error: updateError } = await admin.rpc('finish_wiki_processing_job', {
    p_job_id: job.id as number,
    p_locked_by: job.locked_by as string,
    p_succeeded: false,
    p_payload: {},
    p_last_error: safeJobError(error),
    p_retry_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
  }).single()
  if (updateError) console.error('[wiki] 처리 작업 실패 상태 기록 실패:', updateError.message)
}

async function completeJob(
  admin: ReturnType<typeof createAdminClient>,
  job: Row,
  payload: Row,
): Promise<void> {
  const { error } = await admin.rpc('finish_wiki_processing_job', {
    p_job_id: job.id as number,
    p_locked_by: job.locked_by as string,
    p_succeeded: true,
    p_payload: payload,
    p_last_error: null,
    p_retry_at: null,
  }).single()
  if (error) throw new Error(`JOB_COMPLETE:${error.code ?? 'UNKNOWN'}`)
}

export async function processMinuteWikiJob(jobId: number): Promise<WikiProcessSummary | null> {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return null
  const admin = createAdminClient()
  const workerId = `inline-${process.pid}-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const { data: queued, error: queuedError } = await admin.from('wiki_processing_jobs')
    .select('attempts, max_attempts')
    .eq('id', jobId)
    .eq('status', 'pending')
    .lte('run_after', now)
    .maybeSingle()
  if (queuedError || !queued) {
    if (queuedError) console.error('[wiki] 처리 작업 선점 준비 실패:', queuedError.message)
    return null
  }
  const nextAttempt = ((queued.attempts as number | undefined) ?? 0) + 1
  const { data: job, error: claimError } = await admin.from('wiki_processing_jobs').update({
    status: 'running',
    attempts: nextAttempt,
    locked_at: now,
    locked_by: workerId,
    rerun_requested: false,
    updated_at: now,
  }).eq('id', jobId)
    .eq('status', 'pending')
    .lte('run_after', now)
    .select('*')
    .maybeSingle()
  if (claimError) {
    console.error('[wiki] 처리 작업 선점 실패:', claimError.message)
    return null
  }
  if (!job) return null

  try {
    const minuteVersionId = job.minute_version_id as string | null
    if (!minuteVersionId) throw new Error('VERSION_REQUIRED')
    const [{ data: minute, error: minuteError }, versionResult, latestVersionResult] = await Promise.all([
      admin.from('minutes')
        .select('id, title, minute_date, meeting_occurrence_date, project_id, archived_at, created_at')
        .eq('id', job.minute_id as string)
        .single(),
      admin.from('minute_versions')
        .select('id, version_no, body_md, body_hash, created_at')
        .eq('id', minuteVersionId)
        .eq('minute_id', job.minute_id as string)
        .maybeSingle(),
      admin.from('minute_versions')
        .select('version_no, body_hash')
        .eq('minute_id', job.minute_id as string)
        .order('version_no', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (minuteError || !minute) throw new Error(`MINUTE_READ:${minuteError?.code ?? 'NOT_FOUND'}`)
    if (versionResult.error) throw new Error(`VERSION_READ:${versionResult.error.code ?? 'UNKNOWN'}`)
    if (latestVersionResult.error) {
      throw new Error(`VERSION_LATEST:${latestVersionResult.error.code ?? 'UNKNOWN'}`)
    }
    const version = versionResult.data
    if (!version) throw new Error('VERSION_NOT_FOUND')
    const bodyMd = version.body_md as string
    const bodyHash = fnv1a64(bodyMd)
    if (bodyHash !== job.body_hash || bodyHash !== version.body_hash) {
      throw new Error('BODY_HASH_MISMATCH')
    }

    const payload = (
      typeof job.payload === 'object' && job.payload !== null && !Array.isArray(job.payload)
        ? job.payload
      : {}
    ) as Row
    const applyGeneration =
      typeof job.apply_generation === 'number'
      && Number.isSafeInteger(job.apply_generation)
      && job.apply_generation >= 0
        ? job.apply_generation
        : wikiApplyGeneration(payload)
    const minuteSnapshot = (
      typeof payload.minute === 'object' && payload.minute !== null && !Array.isArray(payload.minute)
        ? payload.minute
        : {}
    ) as Row
    const snapshotProjectId = minuteSnapshot.projectId as string | undefined
    if (snapshotProjectId && snapshotProjectId !== job.project_id) {
      throw new Error('JOB_PROJECT_SNAPSHOT_MISMATCH')
    }

    // 프로젝트 이동/보관 뒤 깨어난 job과, 더 최신 본문 버전이 이미 생긴 뒤 재시도되는
    // 과거 job은 지식을 다시 살리지 않고 정상 종료한다. 최신 버전만 현재 지식에 반영한다.
    const latestVersionNo =
      (latestVersionResult.data?.version_no as number | undefined)
      ?? (version.version_no as number)
    const latestBodyHash =
      (latestVersionResult.data?.body_hash as string | undefined) ?? bodyHash
    // 파일 연결처럼 immutable version만 늘고 본문 hash가 같으면 기존 version 근거를
    // 그대로 반영해도 의미가 같다. 내용이 달라진 최신 version만 stale로 건너뛴다.
    const staleVersion =
      (version.version_no as number) < latestVersionNo
      && latestBodyHash !== bodyHash
    if (minute.archived_at || minute.project_id !== job.project_id || staleVersion) {
      const skippedSummary: WikiProcessSummary = {
        created: 0, changed: 0, reaffirmed: 0, conflicted: 0,
      }
      await completeJob(admin, job as Row, {
        summary: skippedSummary,
        skipped: staleVersion ? 'SUPERSEDED_MINUTE_VERSION' : 'STALE_MINUTE_SCOPE',
      })
      return skippedSummary
    }

    const title = (minuteSnapshot.title as string | undefined) ?? minute.title as string
    const minuteDate = (
      minuteSnapshot.meetingOccurrenceDate
      ?? minute.meeting_occurrence_date
      ?? minuteSnapshot.minuteDate
      ?? minute.minute_date
    ) as string
    const observedAt = minuteObservedAt(
      minuteDate,
      (minuteSnapshot.createdAt as string | undefined)
        ?? (minute.created_at as string | undefined)
        ?? (version.created_at as string),
    )

    const { blocks, items } = await extractItems(
      bodyMd,
      title,
      minuteDate,
    )
    // LLM 호출 중 프로젝트 이동/보관이 발생할 수 있으므로 변경 직전에 scope를 다시 확인한다.
    const { data: scope, error: scopeError } = await admin.from('minutes')
      .select('project_id, archived_at')
      .eq('id', job.minute_id as string)
      .single()
    if (
      scopeError
      || !scope
      || scope.archived_at
      || scope.project_id !== job.project_id
    ) throw new Error('MINUTE_SCOPE_CHANGED')

    const summary: WikiProcessSummary = { created: 0, changed: 0, reaffirmed: 0, conflicted: 0 }
    for (const item of items) {
      const result = await applyExtractedItem(admin, {
        projectId: job.project_id as string,
        jobId: job.id as number,
        jobLockedBy: job.locked_by as string,
        minuteId: job.minute_id as string,
        minuteVersionId,
        minuteVersionNo: version.version_no as number,
        applyGeneration,
        observedAt,
        bodyHash,
        blocks,
        item,
      })
      summary[result] += 1
    }

    await completeJob(admin, job as Row, { summary })
    return summary
  } catch (error) {
    if (error instanceof Error && error.message === 'WIKI_STALE_MINUTE_VERSION') {
      const skippedSummary: WikiProcessSummary = {
        created: 0, changed: 0, reaffirmed: 0, conflicted: 0,
      }
      try {
        await completeJob(admin, job as Row, {
          summary: skippedSummary,
          skipped: 'SUPERSEDED_MINUTE_VERSION',
        })
        return skippedSummary
      } catch (completeError) {
        console.error(
          '[wiki] stale version 완료 상태 기록 실패:',
          completeError instanceof Error ? completeError.message : 'UNKNOWN',
        )
      }
    }
    console.error('[wiki] 회의록 자동 반영 실패:', safeJobError(error))
    await failJob(admin, job as Row, error)
    return null
  }
}

interface WikiProjectRebuildStepResult {
  attempted: boolean
  completed: boolean
  finished: boolean
}

/**
 * 프로젝트 rebuild cursor의 다음 회의록 한 건만 처리한다. claim RPC가 minute job의
 * force generation을 step에 결박하므로, 처리 후 project finish 응답이 유실돼도 같은
 * generation을 재사용하고 cursor만 안전하게 다시 커밋할 수 있다.
 */
export async function processWikiProjectRebuildStep(
  projectId: string | null = null,
): Promise<WikiProjectRebuildStepResult> {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return { attempted: false, completed: false, finished: false }
  }
  const admin = createAdminClient()
  const workerId = `project-rebuild-${process.pid}-${crypto.randomUUID()}`
  const { data: claimRaw, error: claimError } = await admin
    .rpc('claim_wiki_project_rebuild_step', {
      p_project_id: projectId,
      p_locked_by: workerId,
      p_lease_seconds: 15 * 60,
    })
    .maybeSingle()
  if (claimError) {
    throw new Error(`PROJECT_REBUILD_CLAIM:${claimError.code ?? 'UNKNOWN'}`)
  }
  if (!claimRaw) return { attempted: false, completed: false, finished: false }

  const claim = claimRaw as unknown as {
    claimed_project_id: string
    wiki_job_id: number | null
    finished: boolean
  }
  if (claim.finished) {
    return { attempted: true, completed: true, finished: true }
  }
  if (!claim.claimed_project_id || claim.wiki_job_id === null) {
    throw new Error('PROJECT_REBUILD_CLAIM_INVALID')
  }

  let processError = 'MINUTE_JOB_NOT_DONE'
  try {
    if (await processMinuteWikiJob(claim.wiki_job_id)) processError = ''
  } catch (error) {
    processError = safeJobError(error)
  }

  const { data: finishedRaw, error: finishError } = await admin
    .rpc('finish_wiki_project_rebuild_step', {
      p_project_id: claim.claimed_project_id,
      p_locked_by: workerId,
      p_last_error: processError,
      p_retry_at: new Date(Date.now() + 15_000).toISOString(),
    })
    .single()
  if (finishError || !finishedRaw) {
    if (
      finishError?.code === '40001'
      || finishError?.message?.includes('WIKI_PROJECT_REBUILD_LEASE_LOST')
    ) {
      return { attempted: true, completed: false, finished: false }
    }
    throw new Error(`PROJECT_REBUILD_FINISH:${finishError?.code ?? 'UNKNOWN'}`)
  }
  const finished = finishedRaw as unknown as {
    rebuild_status: string
    cursor_advanced: boolean
  }
  return {
    attempted: true,
    completed: finished.cursor_advanced === true,
    finished: finished.rebuild_status === 'done',
  }
}

/** 예약 워커/운영 재시도용. 한 번에 소량만 처리해 함수 실행시간을 제한한다. */
export async function runWikiWorkerOnce(limit = 5): Promise<{
  attempted: number
  completed: number
}> {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return { attempted: 0, completed: 0 }
  }
  const admin = createAdminClient()
  const now = new Date().toISOString()
  // 정상적인 LLM 왕복을 오래된 lease로 오인하지 않도록 15분을 둔다. 각 claim은 고유
  // locked_by 토큰을 사용하므로 회수 전 worker가 늦게 끝나도 새 lease 상태를 덮지 못한다.
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString()
  const { data: staleJobs, error: staleError } = await admin.from('wiki_processing_jobs')
    .select('id, attempts, max_attempts, locked_at, locked_by')
    .eq('status', 'running')
    .lt('locked_at', staleBefore)
    .limit(20)
  if (staleError) throw new Error(`JOB_RECLAIM_LIST:${staleError.code ?? 'UNKNOWN'}`)
  for (const stale of staleJobs ?? []) {
    const { error: reclaimError } = await admin.rpc('finish_wiki_processing_job', {
      p_job_id: stale.id as number,
      p_locked_by: stale.locked_by as string,
      p_succeeded: false,
      p_payload: {},
      p_last_error: 'LEASE_EXPIRED',
      p_retry_at: now,
    }).single()
    if (
      reclaimError
      && reclaimError.code !== '40001'
      && !reclaimError.message?.includes('WIKI_JOB_LEASE_LOST')
    ) throw new Error(`JOB_RECLAIM:${reclaimError.code ?? 'UNKNOWN'}`)
  }

  const boundedLimit = Math.max(1, Math.min(limit, 20))
  let attempted = 0
  let completed = 0
  // 철회 복구가 일반 단건 ingest보다 우선이다. 한 step이 한 LLM 호출 이하라 실행시간은
  // bounded하고, SQL keyset cursor가 500건을 넘는 프로젝트도 다음 cron에서 이어간다.
  while (attempted < boundedLimit) {
    const projectStep = await processWikiProjectRebuildStep()
    if (!projectStep.attempted) break
    attempted += 1
    if (projectStep.completed) completed += 1
  }

  const remaining = boundedLimit - attempted
  if (remaining === 0) return { attempted, completed }

  const { data, error } = await admin.from('wiki_processing_jobs')
    .select('id')
    .eq('status', 'pending')
    .lte('run_after', now)
    .order('run_after', { ascending: true })
    .limit(remaining)
  if (error) throw new Error(`JOB_LIST:${error.code ?? 'UNKNOWN'}`)
  for (const row of data ?? []) {
    if (await processMinuteWikiJob(row.id as number)) completed += 1
  }
  return { attempted: attempted + (data?.length ?? 0), completed }
}

export async function enqueueAndProcessMinuteWiki(args: {
  projectId: string | null
  minuteId: string
  minuteVersionId: string | null
  bodyMd: string
  force?: boolean
}): Promise<void> {
  const jobId = await enqueueMinuteWikiProcessing(args)
  if (jobId !== null) await processMinuteWikiJob(jobId)
}

/**
 * DB 트랜잭션이 이미 남긴 durable project rebuild를 요청 경로에서 소량 즉시 진행한다.
 * 정확성은 after()의 생존 여부가 아니라 SQL queue/keyset cursor가 보장한다.
 * 두 번째 인자는 기존 호출부 호환용이며 현재 scope는 DB가 커밋 뒤 직접 판정한다.
 */
export async function rebuildProjectWikiFromActiveMinutes(
  projectId: string | null,
  excludeMinuteId: string | null = null,
): Promise<void> {
  if (!projectId) return
  void excludeMinuteId
  for (let step = 0; step < 5; step += 1) {
    const result = await processWikiProjectRebuildStep(projectId)
    if (!result.attempted || result.finished) break
    // minute job이 아직 running/backoff라면 다음 step은 due가 아니므로 즉시 양보한다.
    if (!result.completed) break
  }
}
