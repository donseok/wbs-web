import 'server-only'

import { generateAnswer } from '@/lib/ai/llm'
import { hasLLM } from '@/lib/ai/provider'
import { buildWikiCatalogText } from '@/lib/ai/wiki-catalog'
import { loadWikiSaturation, type WikiSaturationSnapshot } from '@/lib/ai/wiki-saturation'
import { createAdminClient } from '@/lib/supabase/admin'
import { serviceRoleConfigured } from '@/lib/supabase/env'
import { activeTeamCodesSync } from '@/lib/teams/master'
import {
  fnv1a64, isMarkableBlock, splitMinuteBlocks, type MinuteBlock,
} from '@/lib/minutes/blocks'
import {
  WIKI_SEMANTIC_RELATIONS,
  buildWikiKnowledgeKey,
  canAutoApplyWikiChange,
  classifyWikiChange,
  matchWikiTopicAlias,
  normalizeWikiKnowledgeKey,
  normalizeWikiStatement as normalizeDomainWikiStatement,
  normalizeWikiTitle,
  resolveWikiTopicTitle,
  wikiFacetPart,
  wikiSaturationKey,
  wikiStatementHash,
  type WikiSemanticRelation,
} from '@/lib/domain/wiki'

/**
 * 위키 **자동 반영 전역 중단 스위치** (2026-08-05, 사용자 지시).
 *
 * 회의록 저장·외부 API 업로드·크론 워커가 모두 이 파일의 진입점을 거쳐 위키를 자동으로
 * 고쳐 쓴다. 그 자동 쓰기에 위험이 있다고 판단해 **일단 전부 멈춘다.**
 *
 * 기본값이 '꺼짐'인 이유: env 를 못 읽는 환경(로컬·프리뷰·새 배포)에서 조용히 다시 도는
 * 것보다 조용히 멈춰 있는 편이 안전하다. 되살릴 때는 **명시적으로**
 * `WIKI_SERVICE_ENABLED=true` 를 넣는다.
 *
 * 코드는 지우지 않는다 — 스위치만 내린 상태이며 조회(위키 페이지·봇 검색)는 그대로 동작한다.
 * 막는 것은 **자동 쓰기**뿐이다.
 */
export function wikiServiceEnabled(): boolean {
  return process.env.WIKI_SERVICE_ENABLED === 'true'
}

/** 중단 상태에서 진입점이 불렸을 때의 로그 — 조용히 사라지면 나중에 원인을 못 찾는다. */
function logWikiSuspended(entry: string): void {
  console.info(`[wiki] 중단 상태로 건너뜀: ${entry} (되살리려면 WIKI_SERVICE_ENABLED=true)`)
}

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
  /**
   * LLM이 준 세부 속성 키. 최종 knowledge_key는 별칭으로 합쳐진 정본 주제를 확정한 뒤
   * 반영 시점에 조립한다 — 추출 시점의 주제 표기로 굳히면 같은 주제로 합쳐도 키가 갈린다.
   */
  facet: string
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
  '6. semanticRelation은 원문 문장 자체에 재확인/보완/변경/철회/반박/해소가 명시된 경우에만 쓰고, 그 외에는 null이다.',
  '7. decisionState는 decision에만 proposed|tentative|confirmed|reversed 중 하나, 그 외 null.',
  '8. ownerTeam/ownerName은 "OO팀이", "OO 담당", "OO이 진행" 처럼 수행 주체가 원문에 있으면 반드시 채운다.',
  '   dueDate/effectiveDate도 "8월 말까지", "9/1부터" 처럼 시점이 명시되면 YYYY-MM-DD로 채운다.',
  '   회의일 기준으로 연도를 보정하되, 원문에 없는 날짜를 지어내지는 마라. 없으면 null.',
  '9. 한 문장에 "기존 결정을 철회하고 새 대안을 확정"이 함께 있으면, 철회 항목과 새 확정 항목을 각각 분리해 출력한다.',
  '10. 최대 30개. JSON 외 텍스트를 출력하지 마라.',
  '11. 입력에 [기존 프로젝트 지식]이 있으면, 같은 대상을 말하는 항목은 거기 적힌 topic과',
  '    knowledgeKey를 글자 하나까지 그대로 복사한다. 새 이름을 지으면 같은 지식이 갈라져',
  '    변경 이력이 끊긴다. 정말 새로운 대상일 때만 새 topic/knowledgeKey를 만든다.',
  '12. topic은 회의를 넘어 지속되는 "대상"이다 — 시스템·프로세스·인터페이스·데이터·정책·용어.',
  '    그날 안건지의 목차("향후 추진 계획", "기타 사항", "논의 사항", "진행 상황", "후속 조치",',
  '    "결정 사항", "안건", "주요 내용")를 topic으로 쓰지 마라. 그런 문단 아래의 내용이라도',
  '    그 문장이 실제로 다루는 대상(예: "MES 경량화", "야드 관리 시스템", "통관 확인 절차")을',
  '    topic으로 삼는다. 목차를 topic으로 쓰면 서로 무관한 지식이 한 주제에 쌓여 쓸모가 없어진다.',
  '13. [기존 프로젝트 지식]의 문장을 이번 회의록에서 나온 것처럼 출력하지 마라. 그 목록은',
  '    topic/knowledgeKey를 맞추라고 주는 참고자료일 뿐이며, statement와 evidence는 반드시',
  '    이번 회의록 블록에서만 가져온다. 이번 회의에서 다시 언급되지 않은 지식은 출력하지 않는다.',
  '14. [포화 주제]에 적힌 주제는 이미 커서 새 대상을 더 받지 않는다.',
  '    - 그 주제의 "기존대상" 목록에 있는 kind/knowledgeKey 조합이면 그 topic과',
  '      knowledgeKey를 그대로 쓴다(kind까지 그대로). 같은 대상의 이력을 끊지 않기 위해서다.',
  '    - 목록에 없는 새 대상이면 그 topic을 쓰지 말고, 이 회의록이 실제로 다루는 대상으로',
  '      새 topic을 지어라. 예: "데이터 관리"가 아니라 "MES 메뉴 열람 권한", "공헌이익 산출 항목".',
  '    - 새 topic도 규칙 12를 따른다 — 그날 안건지의 목차는 topic이 될 수 없다.',
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
    // same/unrelated는 채택하지 않는다. 잘못된 same은 실제 변경을 재확인으로 덮고,
    // 잘못된 unrelated는 같은 key의 다른 문장을 충돌 대신 새 현재값으로 만든다.
    // 동일 문장은 statement hash가, 다른 key는 결정형 분류기가 각각 안전하게 처리한다.
    case 'same':
    case 'unrelated':
    default:
      return null
  }
}

function looksLikeExtractedItem(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Row
  return typeof row.kind === 'string' && typeof row.statement === 'string'
}

/**
 * 잘린 JSON에서 완결된 항목 객체만 건져낸다.
 *
 * maxOutputTokens(4096, thinking 토큰 합산)에 걸려 응답이 중간에서 끊기면 JSON.parse가
 * 통째로 실패한다. 그러면 그 회의록은 지식 0건이 되고, 재구축 중이면 MINUTE_JOB_NOT_DONE으로
 * 프로젝트 큐 전체가 그 회의록에서 멈춘다(2026-07-27 실측). 끊기기 전까지 나온 객체들은
 * 아래 결정형 검증(근거 블록·열거값·날짜)을 그대로 통과하므로 버릴 이유가 없다.
 */
function salvageExtractedObjects(raw: string): unknown[] {
  const salvaged: unknown[] = []
  const starts: number[] = []
  let inString = false
  let escaped = false
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; continue }
    if (char === '{') { starts.push(index); continue }
    if (char === '}' && starts.length > 0) {
      const start = starts.pop() as number
      try {
        const value: unknown = JSON.parse(raw.slice(start, index + 1))
        if (looksLikeExtractedItem(value)) salvaged.push(value)
      } catch {
        // 완결되지 않은 조각은 조용히 버린다 — 여기서의 실패는 정상 경로다.
      }
    }
  }
  return salvaged
}

/**
 * LLM 응답을 관용적으로 파싱하되, 근거 블록·열거값·길이·날짜를 결정형으로 다시 검증한다.
 * 코드펜스/설명 문구가 붙어도 첫 객체 또는 배열만 해석하고, 응답이 잘렸으면 완결된 항목만 건진다.
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
    }
  } catch {
    // 아래 salvage로 넘어간다.
  }

  const strict = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Row).items)
      ? (parsed as Row).items as unknown[]
      : null

  // 엄격 파싱이 성공했으면 빈 배열도 그대로 존중한다 — "이 회의록에 남길 지식이 없다"는
  // 정상 응답이며, 이걸 실패로 바꾸면 멀쩡한 회의록이 재시도를 소진하고 dead_letter로 간다.
  let candidates: unknown[]
  if (strict) {
    candidates = strict
  } else {
    const salvaged = salvageExtractedObjects(raw)
    if (salvaged.length === 0) return null
    candidates = salvaged
  }

  const teams = new Set<string>(activeTeamCodesSync())
  const seen = new Set<string>()
  const items: ExtractedWikiItem[] = []
  for (const candidate of candidates) {
    if (items.length >= ITEMS_CAP) break
    if (typeof candidate !== 'object' || candidate === null) continue
    const item = candidate as Row
    const kind = oneOf(item.kind, ITEM_KINDS)
    const rawTopic = nullableText(item.topic, TOPIC_CAP)
    const topicType = oneOf(item.topicType, TOPIC_TYPES) ?? 'general'
    const rawStatement = nullableText(item.statement, STATEMENT_CAP)
    if (!kind || !rawTopic || !rawStatement) continue
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
    // 프롬프트 규칙 12를 어기고 목차형 제목이 와도 흡인체 주제가 만들어지지 않게 코드가 되돌린다.
    const topic = resolveWikiTopicTitle(rawTopic, facet).slice(0, TOPIC_CAP)
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
      facet,
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

/** 반영에 쓰는 정본 주제. knowledge_key는 이 normalizedTitle로 조립해야 키가 갈리지 않는다. */
interface ResolvedWikiTopic {
  id: string
  normalizedTitle: string
}

const TOPIC_ALIAS_SCAN_LIMIT = 500

async function ensureTopic(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  item: ExtractedWikiItem,
  snapshot: WikiSaturationSnapshot,
): Promise<ResolvedWikiTopic> {
  const normalized = normalizeWikiTopic(item.topic)
  const { data: existing, error: readError } = await admin.from('wiki_topics')
    .select('id, normalized_title')
    .eq('project_id', projectId)
    .eq('normalized_title', normalized)
    .maybeSingle()
  if (readError) throw new Error(`TOPIC_READ:${readError.code ?? 'UNKNOWN'}`)
  if (existing) {
    // 완전일치는 포화 여부와 무관하게 흡수한다. (project_id, normalized_title)이 유니크라
    // 완전일치는 곧 같은 주제이고, 이력을 지키는 쪽이 옳다.
    return { id: existing.id as string, normalizedTitle: existing.normalized_title as string }
  }

  // 코드 구제(§7.5 예외·§7.6) — 완전일치 다음, 별칭보다 먼저다. 같은 (kind, facet)이
  // 포화 주제에 '단독으로' 살아 있으면(keyOwner는 단독 소유 키만 담는다,
  // wiki-saturation.ts) 그 항목은 같은 대상이므로 이력이 별칭 추측을 이긴다.
  //
  // 순서 근거 둘: (1) 완전일치보다 뒤 — facet은 주제 안에서만 유일하므로, LLM이 기존
  // 주제를 정확히 지목했는데 facet 전역 일치가 먼저 발동하면 무관한 포화 주제로 항목이
  // 납치된다(1차 리뷰에서 실행 확인). (2) 별칭보다 앞 — 변형 제목이 다른 비포화 주제와
  // containment로 매칭되면 구제가 도달 불능이 되어, 포화 주제가 단독 소유한 대상의 현재
  // 지식이 두 주제에 이중으로 살게 된다(2차 리뷰에서 실행 확인). 프롬프트만으로는 어느
  // 쪽도 보장할 수 없다 — 포화 facet 중 프롬프트에 실리는 것은 주제당 12개뿐이다.
  if (snapshot.complete) {
    const owner = snapshot.keyOwner.get(
      wikiSaturationKey(item.kind, wikiFacetPart(item.kind, item.facet)),
    )
    if (owner) return { id: owner.id, normalizedTitle: owner.normalizedTitle }
  }

  // 정확히 같은 제목이 없을 때만 별칭을 본다. LLM이 회의마다 제목을 조금씩 다르게 지어도
  // 같은 대상이면 기존 주제에 붙어야 재확인·구체화·충돌 판정이 작동한다.
  //
  // 단 포화 주제는 후보에서 뺀다. matchWikiTopicAlias의 containment 분기
  // (shared === shorterSize && shorterSize >= 2)는 유사도 검사와 한정어 거부 가드를
  // 모두 우회하므로, '데이터 관리 기준'·'스케줄 관리 화면'처럼 한정어만 덧붙인 이름이
  // 흡인체로 되돌아간다(2026-07-30 실행으로 확인). 함수 자체는 고치지 않는다 —
  // f1482c5와 tests/domain/wiki.test.ts가 그대로 통과해야 한다.
  const { data: candidateRows, error: candidateError } = await admin.from('wiki_topics')
    .select('id, normalized_title, aliases')
    .eq('project_id', projectId)
    .limit(TOPIC_ALIAS_SCAN_LIMIT)
  if (candidateError) throw new Error(`TOPIC_SCAN:${candidateError.code ?? 'UNKNOWN'}`)
  const candidates = (candidateRows ?? [])
    .map((row) => ({
      id: row.id as string,
      normalizedTitle: row.normalized_title as string,
      aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    }))
    .filter((c) => !(
      snapshot.complete && snapshot.saturatedNormalizedTitles.has(c.normalizedTitle)
    ))
  const alias = matchWikiTopicAlias(candidates, normalized)
  if (alias) return alias

  const now = new Date().toISOString()
  const { data, error } = await admin.from('wiki_topics').insert({
    project_id: projectId,
    title: item.topic,
    normalized_title: normalized,
    type: item.topicType,
    owner_team: item.ownerTeam,
    last_changed_at: now,
  }).select('id, normalized_title').single()
  if (!error && data) {
    return { id: data.id as string, normalizedTitle: data.normalized_title as string }
  }
  if (error?.code === '23505') {
    const { data: raced } = await admin.from('wiki_topics')
      .select('id, normalized_title')
      .eq('project_id', projectId)
      .eq('normalized_title', normalized)
      .single()
    if (raced) {
      return { id: raced.id as string, normalizedTitle: raced.normalized_title as string }
    }
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
    saturation: WikiSaturationSnapshot
  },
): Promise<keyof WikiProcessSummary> {
  const topic = await ensureTopic(admin, args.projectId, args.item, args.saturation)
  const topicId = topic.id
  // 별칭으로 기존 주제에 합쳐졌으면 정본 주제 표기로 knowledge_key를 다시 만든다.
  // 추출 당시 표기로 굳히면 같은 주제인데 키가 달라 매번 새 항목이 생긴다.
  const item: ExtractedWikiItem = {
    ...args.item,
    knowledgeKey: buildWikiKnowledgeKey(
      topic.normalizedTitle,
      args.item.kind,
      args.item.facet,
    ).slice(0, KEY_CAP),
  }
  const statementHash = wikiStatementHash(item.statement)
  const semanticRelation: WikiSemanticRelation | null =
    item.kind === 'decision' && item.decisionState === 'reversed'
      ? 'reverses'
      : item.semanticRelation
        ?? (item.relation === 'contradicts'
          ? 'contradicts'
          : item.relation === 'resolves' ? 'resolves' : null)
  const incoming = {
    statement: item.statement,
    knowledgeKey: item.knowledgeKey,
    certainty: item.certainty,
    observedAt: args.observedAt,
    validFrom: item.effectiveDate ? `${item.effectiveDate}T00:00:00.000Z` : null,
  }
  const sources = item.evidenceIndexes.map((index) => {
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
    item,
    statementHash,
    sources,
  })

  // 40001은 advisory lock 안에서 current가 달라졌다는 뜻이다. 같은 stale payload를
  // 재전송하지 않고 current 읽기와 결정형 분류부터 최대 세 번 다시 수행한다.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await findCurrentItem(admin, args.projectId, topicId, item)
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
      p_kind: item.kind,
      p_statement: item.statement,
      p_statement_hash: statementHash,
      p_knowledge_key: item.knowledgeKey,
      p_certainty: item.certainty,
      p_decision_state: item.decisionState,
      p_source_relation: item.relation,
      p_requested_change: change,
      p_can_auto_apply: canAutoApply,
      p_observed_at: args.observedAt,
      p_valid_from: incoming.validFrom,
      p_owner_team: item.ownerTeam,
      p_owner_name: item.ownerName,
      p_due_date: item.dueDate,
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
      // 22023 하나에 12개 raise 가 몰려 있어 code 만으로는 원인을 특정할 수 없다.
      // last_error 컬럼은 짧게 유지하되 진단용 원문은 반드시 로그로 남긴다(표시 = 로깅).
      console.error(
        '[wiki] apply RPC 실패:',
        error.code ?? 'UNKNOWN',
        error.message ?? '',
        (error as { details?: string }).details ?? '',
        (error as { hint?: string }).hint ?? '',
      )
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

/**
 * 프롬프트에 붙일 기존 프로젝트 지식 카탈로그.
 *
 * 이게 없으면 LLM은 매 회의마다 주제와 knowledgeKey를 새로 지어내고, 같은 key가 한 번도
 * 겹치지 않아 재확인·구체화·대체·충돌 판정이 전혀 발동하지 않는다(= 회의별 추출 목록).
 * 실패해도 추출 자체는 계속한다 — 카탈로그는 품질 보조이지 필수 입력이 아니다.
 *
 * 조립 규칙은 wiki-catalog.ts가 정본이다(순수 함수라 목 없이 테스트된다).
 */
export function loadWikiCatalog(
  bodyMd: string,
  snapshot: WikiSaturationSnapshot,
): string {
  const { text, warnings } = buildWikiCatalogText({
    topics: snapshot.topics,
    items: snapshot.items,
    bodyMd,
    gatingEnabled: snapshot.complete,
  })
  for (const warning of warnings) console.warn(warning)
  return text
}

async function extractItems(
  bodyMd: string,
  title: string,
  minuteDate: string,
  catalog: string,
): Promise<{
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
    content: `회의록 제목: ${title}\n회의일: ${minuteDate}\n${catalog}\n[이번 회의록 원문]\n${source}`,
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
  if (!wikiServiceEnabled()) { logWikiSuspended('enqueueMinuteWikiProcessing'); return null }
  if (!args.projectId) return null
  if (!serviceRoleConfigured()) return null
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
  if (!wikiServiceEnabled()) { logWikiSuspended('processMinuteWikiJob'); return null }
  if (!serviceRoleConfigured()) return null
  const admin = createAdminClient()
  const workerId = `inline-${process.pid}-${crypto.randomUUID()}`
  // project rebuild가 job을 DB 시각으로 즉시 예약하므로 due 판정도 DB 시각으로 해야 한다.
  // 별도 SELECT 없이 pending → running을 원자 선점해 clock skew와 이중 선점을 함께 막는다.
  const { data: claimedJob, error: claimError } = await admin
    .rpc('claim_wiki_processing_job', {
      p_job_id: jobId,
      p_locked_by: workerId,
      // 0067 — lease 가 만료된 running job 도 회수한다. 워커가 죽으면 회수자가 없어
      // 그 회의록의 위키 반영이 영구히 멈춘다(재적재는 status 를 유지한 채 플래그만 켠다).
      // 프로젝트 rebuild claim(0046)과 같은 15분.
      p_lease_seconds: 15 * 60,
    })
    .maybeSingle()
  if (claimError) {
    console.error('[wiki] 처리 작업 선점 실패:', claimError.message)
    return null
  }
  if (!claimedJob) return null
  const job = claimedJob as unknown as Row

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

    const saturation = await loadWikiSaturation(admin, job.project_id as string)
    const { blocks, items } = await extractItems(
      bodyMd,
      title,
      minuteDate,
      loadWikiCatalog(bodyMd, saturation),
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
        saturation,
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
  if (!wikiServiceEnabled()) {
    logWikiSuspended('processWikiProjectRebuildStep')
    return { attempted: false, completed: false, finished: false }
  }
  if (!serviceRoleConfigured()) {
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
  if (!wikiServiceEnabled()) { logWikiSuspended('runWikiWorkerOnce'); return { attempted: 0, completed: 0 } }
  if (!serviceRoleConfigured()) {
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
  if (!wikiServiceEnabled()) { logWikiSuspended('enqueueAndProcessMinuteWiki'); return }
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
  if (!wikiServiceEnabled()) { logWikiSuspended('rebuildProjectWikiFromActiveMinutes'); return }
  if (!projectId) return
  void excludeMinuteId
  for (let step = 0; step < 5; step += 1) {
    const result = await processWikiProjectRebuildStep(projectId)
    if (!result.attempted || result.finished) break
    // minute job이 아직 running/backoff라면 다음 step은 due가 아니므로 즉시 양보한다.
    if (!result.completed) break
  }
}
