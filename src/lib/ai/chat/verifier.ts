import { BOT_ENTITY_TYPES, type BotDomain, type BotSource } from './protocol'
import { sourceIdsForRecord, type EvidencePack } from './evidence'

/**
 * 설계 §11.3 예약 API — Phase 3 합성 강화 전까지 운영 경로에 연결되지 않는다(제거 금지, 리뷰 L-8).
 * 정본 검증기는 verifySynthesizedAnswer다.
 */
export interface GroundedClaim {
  text: string
  kind: 'count' | 'percent' | 'date' | 'time' | 'duration' | 'ordinal'
  value: string | number
  unit?: string
  sourceFactIds: string[]
}

export interface SourceVerificationScope {
  allowedProjectIds: readonly string[]
}

export interface SourceVerificationResult {
  sources: BotSource[]
  warnings: string[]
}

// satisfies로 모든 BotDomain 키를 강제한다(리뷰 M-1). unknown은 내부 경로가 없으므로
// unknown 도메인 출처는 href 검증에서 항상 탈락한다.
const DOMAIN_PATH = {
  projects: () => ['/projects'],
  dashboard: projectId => projectId ? [`/p/${projectId}/dashboard`] : [],
  wbs: projectId => projectId ? [`/p/${projectId}/wbs`, `/p/${projectId}/gantt`] : [],
  kanban: projectId => projectId ? [`/p/${projectId}/kanban`] : [],
  members: projectId => projectId ? [`/p/${projectId}/members`] : [],
  attendance: projectId => projectId ? [`/p/${projectId}/attendance`] : [],
  announcements: projectId => projectId ? [`/p/${projectId}/announcements`] : [],
  meetings: projectId => projectId ? [`/p/${projectId}/meetings`, '/meetings'] : ['/meetings'],
  weekly: projectId => projectId ? [`/p/${projectId}/weekly`] : [],
  minutes: () => ['/minutes'],
  settings: projectId => projectId ? [`/p/${projectId}/settings`] : [],
  unknown: () => [],
} satisfies Record<BotDomain, (projectId: string | null) => string[]>

// 엔티티 어휘의 단일 원천(protocol)에서 파생 — 유니온과 검증 Set의 드리프트를 차단한다(리뷰 M-1).
const SOURCE_ENTITY_TYPES = new Set<string>(BOT_ENTITY_TYPES)

function isInternalHref(source: BotSource): boolean {
  if (!source.href.startsWith('/') || source.href.startsWith('//') || /[\\\u0000-\u001f]/.test(source.href)) return false
  let url: URL
  try {
    url = new URL(source.href, 'https://dflow.invalid')
  } catch {
    return false
  }
  if (url.origin !== 'https://dflow.invalid') return false
  const roots = DOMAIN_PATH[source.domain]?.(source.projectId) ?? []
  if (!roots.some(root => url.pathname === root || url.pathname.startsWith(`${root}/`))) return false

  if (source.projectId) {
    const projectMatch = /^\/p\/([^/]+)\//.exec(url.pathname)
    if (projectMatch) {
      try {
        if (decodeURIComponent(projectMatch[1]) !== source.projectId) return false
      } catch {
        return false
      }
    }
  }
  if (source.domain === 'wbs' && source.entityType === 'wbs_item') {
    if (url.pathname.endsWith('/wbs') && url.searchParams.get('focus') !== source.entityId) return false
  }
  if (source.domain === 'minutes' && source.entityType === 'minute') {
    if (url.pathname !== `/minutes/${encodeURIComponent(source.entityId)}`) return false
  }
  return true
}

function isSafeSource(source: unknown, allowed: Set<string>): source is BotSource {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return false
  const candidate = source as Partial<BotSource>
  if (typeof candidate.id !== 'string' || !candidate.id) return false
  if (typeof candidate.entityId !== 'string' || !candidate.entityId) return false
  if (typeof candidate.title !== 'string' || !candidate.title.trim() || candidate.title.length > 500) return false
  if (typeof candidate.href !== 'string') return false
  if (typeof candidate.domain !== 'string'
    || !Object.prototype.hasOwnProperty.call(DOMAIN_PATH, candidate.domain)) return false
  if (typeof candidate.entityType !== 'string' || !SOURCE_ENTITY_TYPES.has(candidate.entityType)) return false
  if (candidate.projectId !== null && typeof candidate.projectId !== 'string') return false
  if (candidate.updatedAt !== null && typeof candidate.updatedAt !== 'string') return false
  if (candidate.excerpt !== undefined && typeof candidate.excerpt !== 'string') return false
  const qualifier = candidate.qualifier
  if (qualifier !== undefined && (typeof qualifier !== 'object' || qualifier === null || Array.isArray(qualifier))) {
    return false
  }
  const typed = candidate as BotSource
  if (typed.projectId !== null && !allowed.has(typed.projectId)) return false
  if (typed.updatedAt !== null && !Number.isFinite(Date.parse(typed.updatedAt))) return false
  if (typed.qualifier?.occurrenceDate !== undefined && !validIsoDate(typed.qualifier.occurrenceDate)) return false
  if (typed.qualifier?.anchor !== undefined
    && (typeof typed.qualifier.anchor !== 'string' || typed.qualifier.anchor.length > 256)) return false
  return isInternalHref(typed)
}

function sourceLabel(source: unknown): string {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return '(unknown)'
  const id = (source as Record<string, unknown>).id
  return typeof id === 'string' && id ? id : '(unknown)'
}

function sourceIdentity(source: BotSource): string {
  return JSON.stringify([
    source.domain,
    source.entityType,
    source.entityId,
    source.projectId,
    source.qualifier?.occurrenceDate ?? null,
    source.qualifier?.anchor ?? null,
  ])
}

/** Drops forged/external/cross-scope sources before they can reach the model or client. */
export function verifyBotSources(
  sources: readonly BotSource[],
  scope: SourceVerificationScope,
): SourceVerificationResult {
  const allowed = new Set(scope.allowedProjectIds)
  const safe: BotSource[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    if (!isSafeSource(source, allowed)) {
      warnings.push(`출처 '${sourceLabel(source)}' 검증 실패`)
      continue
    }
    // Recurring meeting occurrences and anchored document blocks are distinct navigable evidence.
    const key = sourceIdentity(source)
    if (seen.has(key)) continue
    seen.add(key)
    safe.push({
      ...source,
      title: source.title.trim(),
      ...(source.excerpt ? { excerpt: source.excerpt.slice(0, 1_000) } : {}),
    })
  }
  return { sources: safe, warnings }
}

function normalized(value: string | number | boolean): string {
  return String(value).trim().toLowerCase().replace(/,/g, '')
}

function groundedFactMatches(claim: GroundedClaim, value: string | number | boolean): boolean {
  if (normalized(value) === normalized(claim.value)) return true
  if (typeof value !== 'string') return false

  const suffix = claim.unit ?? (claim.kind === 'percent' ? '%' : '')
  if (!suffix) return false
  const expected = extractClaims(`${claim.value}${suffix}`)[0]
  return !!expected && extractClaims(value).some(candidate => sameClaim(candidate, expected))
}

/**
 * 설계 §11.3 예약 API — Phase 3 합성 강화 전까지 운영 경로에 연결되지 않는다(제거 금지, 리뷰 L-8).
 * 정본 검증기는 verifySynthesizedAnswer다.
 */
export function verifyGroundedClaims(claims: readonly GroundedClaim[], pack: EvidencePack): {
  valid: GroundedClaim[]
  invalid: GroundedClaim[]
} {
  const facts = new Map(pack.facts.map(f => [f.id, f]))
  const valid: GroundedClaim[] = []
  const invalid: GroundedClaim[] = []
  for (const claim of claims) {
    const bound = claim.sourceFactIds.map(id => facts.get(id)).filter(Boolean)
    const grounded = bound.length === claim.sourceFactIds.length && bound.length > 0 && bound.every(f =>
      !!f && f.value !== null && groundedFactMatches(claim, f.value),
    )
    ;(grounded ? valid : invalid).push(claim)
  }
  return { valid, invalid }
}

export interface AnswerVerificationResult {
  ok: boolean
  text: string
  warnings: string[]
}

const CITATION_RE = /\[(S\d+)]/g
const NUMBER_PATTERN = '[-+]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?'
// `\b` does not form a boundary after Korean units. The ASCII-only lookahead still permits particles
// such as "3건의", "2일간", and "7월 19일에" while avoiding suffixes such as "%point".
const UNIT_NUMBER_RE = new RegExp(
  `(?<![\\d.,])(${NUMBER_PATTERN})\\s*(%p|%|건|명|개|회|시간|분|일)(?![A-Za-z0-9])`,
  'gi',
)
const ISO_DATE_RE = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g
const KOREAN_DATE_RE = /(?<!\d)\d{1,2}월\s*\d{1,2}일(?![A-Za-z0-9])/g
const TIME_RE = /(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d(?!\d)/g

type DetectedClaim = {
  kind: 'unit' | 'date' | 'time'
  raw: string
  start: number
  end: number
  number?: number
  unit?: string
  isoDate?: string
  monthDay?: string
  time?: string
}

type EvidenceLeaf = {
  key: string
  tool: string
  value: string | number | boolean
  sourceIds: string[]
  /** string leaf의 주장 추출 캐시 — claim×leaf 쌍마다 재파싱하지 않는다(리뷰 M-8). */
  claims: DetectedClaim[]
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function validMonthDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false
  const date = new Date(Date.UTC(2000, month - 1, day))
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function monthDay(month: number, day: number): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function overlaps(candidate: { start: number; end: number }, accepted: readonly DetectedClaim[]): boolean {
  return accepted.some(value => candidate.start < value.end && value.start < candidate.end)
}

function extractClaims(text: string): DetectedClaim[] {
  const claims: DetectedClaim[] = []

  for (const match of text.matchAll(ISO_DATE_RE)) {
    if (match.index === undefined || !validIsoDate(match[0])) continue
    const [, month, day] = match[0].split('-').map(Number)
    claims.push({
      kind: 'date', raw: match[0], start: match.index, end: match.index + match[0].length,
      isoDate: match[0], monthDay: monthDay(month, day),
    })
  }
  for (const match of text.matchAll(KOREAN_DATE_RE)) {
    if (match.index === undefined) continue
    const parts = /^(\d{1,2})월\s*(\d{1,2})일/.exec(match[0])
    if (!parts || !validMonthDay(Number(parts[1]), Number(parts[2]))) continue
    const candidate: DetectedClaim = {
      kind: 'date', raw: match[0], start: match.index, end: match.index + match[0].length,
      monthDay: monthDay(Number(parts[1]), Number(parts[2])),
    }
    if (!overlaps(candidate, claims)) claims.push(candidate)
  }
  for (const match of text.matchAll(TIME_RE)) {
    if (match.index === undefined) continue
    const [hour, minute] = match[0].split(':').map(Number)
    const candidate: DetectedClaim = {
      kind: 'time', raw: match[0], start: match.index, end: match.index + match[0].length,
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    }
    if (!overlaps(candidate, claims)) claims.push(candidate)
  }
  for (const match of text.matchAll(UNIT_NUMBER_RE)) {
    if (match.index === undefined) continue
    const numeric = Number(match[1].replace(/,/g, ''))
    if (!Number.isFinite(numeric)) continue
    const candidate: DetectedClaim = {
      kind: 'unit', raw: match[0], start: match.index, end: match.index + match[0].length,
      number: numeric, unit: match[2].toLowerCase(),
    }
    // "7월 19일" is one date claim, not a separate 19-day duration claim.
    if (!overlaps(candidate, claims)) claims.push(candidate)
  }
  return claims.sort((left, right) => left.start - right.start)
}

function sameClaim(left: DetectedClaim, right: DetectedClaim): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'unit') return left.number === right.number && left.unit === right.unit
  if (left.kind === 'time') return left.time === right.time
  // A yearless Korean date can be grounded by an ISO date with the same month/day. An ISO claim
  // still requires the exact year and cannot be grounded by a yearless value.
  return right.isoDate ? left.isoDate === right.isoDate : left.monthDay === right.monthDay
}

function ignoredEvidenceKey(key: string): boolean {
  const value = key.toLowerCase().replace(/[^a-z0-9가-힣]/g, '')
  return value === 'id'
    || value.endsWith('id')
    || value.endsWith('ids')
    || value.includes('uuid')
    || value.endsWith('code')
    || value === 'sortorder'
    || value === 'level'
    || value === 'size'
}

function collectEvidenceLeaves(pack: EvidencePack): EvidenceLeaf[] {
  const leaves: EvidenceLeaf[] = []
  const push = (key: string, tool: string, value: unknown, sourceIds: readonly string[]) => {
    if (value === null || !['string', 'number', 'boolean'].includes(typeof value)) return
    if (ignoredEvidenceKey(key)) return
    leaves.push({
      key,
      tool,
      value: value as string | number | boolean,
      sourceIds: [...sourceIds],
      claims: typeof value === 'string' ? extractClaims(value) : [],
    })
  }

  const sourceById = new Map(pack.sources.map(source => [source.id, source]))
  for (const fact of pack.facts) push(fact.key, fact.tool, fact.value, fact.sourceIds)
  for (const record of pack.records) {
    // 팩 생성기와 동일한 결속 규칙을 재사용한다(리뷰 M-2). 이미 좁혀진 팩에는 멱등이다.
    const sourceIds = sourceIdsForRecord(record.tool, record.value, record.sourceIds, sourceById)
    const seen = new WeakSet<object>()
    let visited = 0
    const visit = (value: unknown, path: string[], depth: number) => {
      if (visited >= 10_000 || depth > 8) return
      visited++
      if (value === null || typeof value !== 'object') {
        const key = [...path].reverse().find(part => !/^\d+$/.test(part)) ?? ''
        push(key, record.tool, value, sourceIds)
        return
      }
      if (seen.has(value)) return
      seen.add(value)
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, [...path, String(index)], depth + 1))
      } else {
        Object.entries(value as Record<string, unknown>)
          .forEach(([key, item]) => visit(item, [...path, key], depth + 1))
      }
    }
    visit(record.value, [], 0)
  }
  return leaves
}

function unitsForNumericKey(key: string, tool: string): Set<string> {
  const value = key.toLowerCase().replace(/[^a-z0-9가-힣]/g, '')
  const units = new Set<string>()
  if (/(?:pct|percent|percentage|progress|achievement|ratio|rate|진척률|달성률)/.test(value)) {
    units.add('%')
    if (/(?:point|delta|pp)/.test(value)) units.add('%p')
  }
  if (/(?:minutes?|mins?|분)$/.test(value)) units.add('분')
  if (/(?:hours?|hrs?|시간)$/.test(value)) units.add('시간')
  if (/(?:days?|일수)$/.test(value)) units.add('일')
  if (/(?:attendee|member|participant|person|people|인원).*count|(?:attendee|member|participant)count/.test(value)) {
    units.add('명')
  } else if (/(?:count|total|matched|returned|rows?|items?|leave|trip|remote|today|upcoming\d*d)$/.test(value)) {
    units.add('건')
    units.add('개')
    if (tool.includes('attendance')) units.add('명')
    if (tool.includes('meeting')) units.add('회')
  }
  return units
}

function plainNumber(value: string | number | boolean): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(value.trim())) return null
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function leafSupportsClaim(leaf: EvidenceLeaf, claim: DetectedClaim): boolean {
  if (leaf.claims.some(value => sameClaim(value, claim))) return true
  if (claim.kind !== 'unit') return false
  const value = plainNumber(leaf.value)
  return value !== null && value === claim.number && !!claim.unit
    && unitsForNumericKey(leaf.key, leaf.tool).has(claim.unit)
}

function isSentenceBoundary(text: string, index: number): boolean {
  const char = text[index]
  if (char === '\n' || /[!?;。！？；]/.test(char)) return true
  if (char !== '.') return false
  return !(index > 0 && index + 1 < text.length && /\d/.test(text[index - 1]) && /\d/.test(text[index + 1]))
}

function citationsForClaim(text: string, claim: DetectedClaim): Set<string> {
  let from = 0
  for (let index = claim.start - 1; index >= 0; index--) {
    if (isSentenceBoundary(text, index)) {
      from = index + 1
      break
    }
  }

  let to = text.length
  for (let index = claim.end; index < text.length; index++) {
    if (!isSentenceBoundary(text, index)) continue
    to = index + 1
    if (text[index] !== '\n') {
      // Also accept the conventional "문장입니다. [S1]" placement.
      let cursor = to
      while (cursor < text.length && /[ \t]/.test(text[cursor])) cursor++
      while (true) {
        const citation = /^\[S\d+]/.exec(text.slice(cursor))
        if (!citation) break
        cursor += citation[0].length
        while (cursor < text.length && /[ \t]/.test(text[cursor])) cursor++
      }
      to = cursor
    }
    break
  }
  const segment = text.slice(from, to)
  const matches = [...segment.matchAll(CITATION_RE)].flatMap(match => {
    if (match.index === undefined) return []
    return [{ id: match[1], start: match.index, end: match.index + match[0].length }]
  })
  if (matches.length <= 1) return new Set(matches.map(match => match.id))

  const groups: Array<{ ids: string[]; start: number; end: number }> = []
  for (const match of matches) {
    const previous = groups.at(-1)
    if (previous && segment.slice(previous.end, match.start).trim() === '') {
      previous.ids.push(match.id)
      previous.end = match.end
    } else {
      groups.push({ ids: [match.id], start: match.start, end: match.end })
    }
  }
  if (groups.length === 1) return new Set(groups[0].ids)

  const claimStart = claim.start - from
  const claimEnd = claim.end - from
  const distance = (group: { start: number; end: number }): number => {
    if (group.end <= claimStart) return claimStart - group.end
    if (group.start >= claimEnd) return group.start - claimEnd
    return 0
  }
  const nearest = [...groups].sort((left, right) => {
    const byDistance = distance(left) - distance(right)
    if (byDistance) return byDistance
    // A trailing citation is the conventional binding when distances tie.
    return Number(right.start >= claimEnd) - Number(left.start >= claimEnd)
  })[0]
  return new Set(nearest.ids)
}

/**
 * Conservative post-generation gate. Invalid citations, unsupported numeric/date claims, raw links, or
 * an uncited factual answer fail the whole synthesis so the orchestrator can use a deterministic rendering.
 */
export function verifySynthesizedAnswer(text: string, pack: EvidencePack): AnswerVerificationResult {
  const trimmed = text.trim()
  const warnings: string[] = []
  if (!trimmed || trimmed.length > 12_000) return { ok: false, text: '', warnings: ['합성 답변 길이 검증 실패'] }
  if (/https?:\/\/|www\.|\]\(/i.test(trimmed)) {
    return { ok: false, text: '', warnings: ['합성 답변에 허용되지 않은 링크가 포함됨'] }
  }

  const knownSources = new Set(pack.sources.map(s => s.id))
  const citations = [...trimmed.matchAll(CITATION_RE)].map(m => m[1])
  const unknown = citations.filter(id => !knownSources.has(id))
  if (unknown.length) return { ok: false, text: '', warnings: [`존재하지 않는 출처 인용: ${[...new Set(unknown)].join(', ')}`] }
  if (pack.sources.length > 0 && citations.length === 0) {
    return { ok: false, text: '', warnings: ['근거가 있는 답변에 출처 인용이 없음'] }
  }

  const leaves = collectEvidenceLeaves(pack)
  const claims = extractClaims(trimmed)
  for (const claim of claims) {
    const supporting = leaves.filter(leaf => leafSupportsClaim(leaf, claim))
    if (!supporting.length) {
      warnings.push(`근거에 없는 수치·날짜 주장: ${claim.raw}`)
      continue
    }
    if (!pack.sources.length) continue

    const claimCitations = citationsForClaim(trimmed, claim)
    if (!claimCitations.size) {
      warnings.push(`수치·날짜 주장에 근거 출처 인용이 없음: ${claim.raw}`)
      continue
    }
    if (!supporting.some(leaf => leaf.sourceIds.some(id => claimCitations.has(id)))) {
      warnings.push(`인용 출처가 수치·날짜 주장을 뒷받침하지 않음: ${claim.raw}`)
    }
  }
  return warnings.length ? { ok: false, text: '', warnings } : { ok: true, text: trimmed, warnings: [] }
}
