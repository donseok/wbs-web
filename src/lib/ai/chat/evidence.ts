import type { BotSource } from './protocol'
import type { ToolResult } from '@/lib/ai/tools/types'

export type EvidencePrimitive = string | number | boolean | null

/** 공용 ToolResult 계약의 별칭 — 구조 복제로 두 계약이 갈라지는 드리프트를 막는다(리뷰 L-2). */
export type EvidenceToolResult<T = unknown> = ToolResult<T>

export interface SuccessfulToolEvidence<T = unknown> {
  callId: string
  tool: string
  result: EvidenceToolResult<T>
}

export interface EvidenceFact {
  id: string
  tool: string
  key: string
  value: EvidencePrimitive
  sourceIds: string[]
}

export interface EvidenceRecord {
  id: string
  tool: string
  value: unknown
  sourceIds: string[]
}

export interface EvidencePack {
  facts: EvidenceFact[]
  records: EvidenceRecord[]
  sources: BotSource[]
  asOf: string
  truncated: boolean
  warnings: string[]
  tools: string[]
  partialTools: string[]
}

export interface EvidencePromptView {
  payload: Record<string, unknown>
  truncated: boolean
}

export interface EvidencePromptLimits {
  maxRecords?: number
  maxChars?: number
  maxStringChars?: number
}

const DEFAULT_PROMPT_RECORDS = 50
// Leave headroom inside a 100k evidence budget for failedTools and framing JSON.
const DEFAULT_PROMPT_CHARS = 96_000
const DEFAULT_PROMPT_STRING_CHARS = 4_000

function sourceIdentity(source: BotSource): string {
  const qualifier = source.qualifier
    ? `${source.qualifier.occurrenceDate ?? ''}|${source.qualifier.anchor ?? ''}`
    : ''
  return [source.domain, source.entityType, source.entityId, source.projectId ?? '', qualifier].join('|')
}

function validAsOf(value: string): boolean {
  return value.length <= 64 && Number.isFinite(Date.parse(value))
}

export const RECORD_ENTITY_REFERENCE_KEYS = [
  'id',
  'entityId',
  'seriesId',
  'meetingId',
  'itemId',
  'reportId',
  'rowId',
  'predecessorId',
  'successorId',
] as const

function recordEntityReferences(value: Record<string, unknown>): string[] {
  return [...new Set(RECORD_ENTITY_REFERENCE_KEYS.flatMap(key => {
    const reference = value[key]
    return typeof reference === 'string' && reference ? [reference] : []
  }))]
}

function normalizeLabel(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLocaleLowerCase('ko-KR')
    : ''
}

/**
 * Binds a record to its own entity sources instead of every source returned by the tool call.
 * Aggregate facts intentionally keep the call-wide binding because they summarize the full result set.
 * 팩 생성과 verifier가 공유하는 record→출처 결속의 단일 구현이다(리뷰 M-2) — 키 목록·occurrenceDate
 * 규칙이 여기서만 정의된다.
 */
export function sourceIdsForRecord(
  tool: string,
  value: unknown,
  candidateIds: readonly string[],
  sourceById: ReadonlyMap<string, BotSource>,
): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [...candidateIds]
  const record = value as Record<string, unknown>
  const entityRefs = recordEntityReferences(record)
  const occurrenceDate = normalizeLabel(record.occurrenceDate)

  if (entityRefs.length) {
    const matched = candidateIds.filter(id => {
      const source = sourceById.get(id)
      if (!source || !entityRefs.includes(source.entityId)) return false
      const sourceOccurrence = normalizeLabel(source.qualifier?.occurrenceDate)
      return !occurrenceDate || !sourceOccurrence || sourceOccurrence === occurrenceDate
    })
    if (matched.length) return [...new Set(matched)]
  }

  // Comparison records aggregate multiple physical weekly rows and therefore do not carry row ids.
  // Their section/module pair is the stable semantic key used by the weekly tool itself.
  if (tool === 'compare_weekly_sheets') {
    const section = normalizeLabel(record.section)
    const moduleName = normalizeLabel(record.module)
    if (section || moduleName) {
      const matched = candidateIds.filter(id => {
        const source = sourceById.get(id)
        if (!source || source.entityType !== 'weekly_row') return false
        const title = normalizeLabel(source.title)
        return (!section || title.includes(section)) && (!moduleName || title.includes(moduleName))
      })
      if (matched.length) return [...new Set(matched)]
    }
  }

  return [...candidateIds]
}

/**
 * Normalizes tool-local source IDs into response-global S1..Sn IDs. Facts bind to the full tool
 * result while records bind to their own entity sources when the record contract permits it.
 * Duplicate entities share one source.
 */
export function buildEvidencePack(
  executions: SuccessfulToolEvidence[],
  fallbackAsOf = new Date().toISOString(),
): EvidencePack {
  const sources: BotSource[] = []
  const sourceIndex = new Map<string, number>()
  const sourceIdsByCall = new Map<string, string[]>()

  for (const execution of executions) {
    const callSourceIds: string[] = []
    for (const source of execution.result.sources) {
      const key = sourceIdentity(source)
      let idx = sourceIndex.get(key)
      if (idx === undefined) {
        idx = sources.length
        sourceIndex.set(key, idx)
        sources.push({ ...source, id: `S${idx + 1}` })
      } else {
        // A later tool may have a fresher title/excerpt for the same entity.
        sources[idx] = { ...sources[idx], ...source, id: `S${idx + 1}` }
      }
      callSourceIds.push(`S${idx + 1}`)
    }
    sourceIdsByCall.set(execution.callId, [...new Set(callSourceIds)])
  }

  const facts: EvidenceFact[] = []
  const records: EvidenceRecord[] = []
  const sourceById = new Map(sources.map(source => [source.id, source]))
  for (const execution of executions) {
    const sourceIds = sourceIdsByCall.get(execution.callId) ?? []
    for (const [key, value] of Object.entries(execution.result.facts)) {
      facts.push({ id: `F${facts.length + 1}`, tool: execution.tool, key, value, sourceIds })
    }
    for (const value of execution.result.records) {
      records.push({
        id: `R${records.length + 1}`,
        tool: execution.tool,
        value,
        sourceIds: sourceIdsForRecord(execution.tool, value, sourceIds, sourceById),
      })
    }
  }

  const timestamps = executions.map(x => x.result.asOf).filter(validAsOf).sort()
  const warnings = [...new Set(executions.flatMap(x => x.result.warnings).filter(Boolean))]
  const tools = [...new Set(executions.map(x => x.tool))]
  const partialTools = [...new Set(executions.filter(x => x.result.status === 'partial').map(x => x.tool))]
  return {
    facts,
    records,
    sources,
    asOf: timestamps.at(-1) ?? fallbackAsOf,
    truncated: executions.some(x => x.result.truncated),
    warnings,
    tools,
    partialTools,
  }
}

interface BoundedJsonResult {
  value: unknown
  used: number
  truncated: boolean
}

/** Builds valid JSON while enforcing a hard approximate serialized-character budget. */
function boundedJson(value: unknown, budget: number, maxStringChars: number, depth = 0): BoundedJsonResult {
  if (budget <= 0 || depth > 10) return { value: null, used: 4, truncated: true }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    const serialized = JSON.stringify(value)
    return serialized.length <= budget
      ? { value, used: serialized.length, truncated: false }
      : { value: null, used: 4, truncated: true }
  }
  if (typeof value === 'string') {
    let clipped = value.slice(0, maxStringChars)
    let serialized = JSON.stringify(clipped)
    while (serialized.length > budget && clipped.length) {
      clipped = clipped.slice(0, Math.max(0, clipped.length - Math.max(1, serialized.length - budget)))
      serialized = JSON.stringify(clipped)
    }
    if (serialized.length > budget) return { value: '', used: 2, truncated: true }
    return { value: clipped, used: serialized.length, truncated: clipped.length !== value.length }
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    let used = 2
    let truncated = false
    for (const item of value) {
      const separator = out.length ? 1 : 0
      if (used + separator >= budget) { truncated = true; break }
      const child = boundedJson(item, budget - used - separator, maxStringChars, depth + 1)
      if (used + separator + child.used > budget) { truncated = true; break }
      out.push(child.value)
      used += separator + child.used
      truncated ||= child.truncated
    }
    if (out.length < value.length) truncated = true
    return { value: out, used, truncated }
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    let used = 2
    let truncated = false
    const entries = Object.entries(value as Record<string, unknown>)
    for (const [key, item] of entries) {
      const keySize = JSON.stringify(key).length + 1
      const separator = Object.keys(out).length ? 1 : 0
      if (used + separator + keySize >= budget) { truncated = true; break }
      const child = boundedJson(item, budget - used - separator - keySize, maxStringChars, depth + 1)
      if (used + separator + keySize + child.used > budget) { truncated = true; break }
      out[key] = child.value
      used += separator + keySize + child.used
      truncated ||= child.truncated
    }
    if (Object.keys(out).length < entries.length) truncated = true
    return { value: out, used, truncated }
  }
  return { value: null, used: 4, truncated: true }
}

/** Bounded prompt representation; raw repository objects never bypass count or character limits. */
export function buildEvidencePrompt(
  pack: EvidencePack,
  limits: EvidencePromptLimits = {},
): EvidencePromptView {
  const maxRecords = limits.maxRecords ?? DEFAULT_PROMPT_RECORDS
  const maxChars = limits.maxChars ?? DEFAULT_PROMPT_CHARS
  const maxStringChars = limits.maxStringChars ?? DEFAULT_PROMPT_STRING_CHARS
  const records = pack.records.slice(0, maxRecords)
  const referencedSourceIds = new Set([
    ...pack.facts.flatMap(fact => fact.sourceIds),
    ...records.flatMap(record => record.sourceIds),
  ])
  const countTruncated = records.length < pack.records.length
  const raw = {
    asOf: pack.asOf,
    truncated: pack.truncated || countTruncated,
    warnings: pack.warnings,
    sources: pack.sources
      .filter(source => !referencedSourceIds.size || referencedSourceIds.has(source.id))
      .map(({ id, domain, entityType, entityId, projectId, title, updatedAt, excerpt }) => ({
        id, domain, entityType, entityId, projectId, title, updatedAt, ...(excerpt ? { excerpt } : {}),
      })),
    facts: pack.facts,
    records,
  }
  const bounded = boundedJson(raw, Math.max(1_000, maxChars), Math.max(100, maxStringChars))
  const payload = bounded.value as Record<string, unknown>
  const truncated = pack.truncated || countTruncated || bounded.truncated
  payload.truncated = truncated
  return { payload, truncated }
}

export function isEvidenceToolResult(value: unknown): value is EvidenceToolResult {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.status !== 'ok' && v.status !== 'partial') return false
  if (typeof v.facts !== 'object' || v.facts === null || Array.isArray(v.facts)) return false
  if (!Array.isArray(v.records) || !Array.isArray(v.sources) || !Array.isArray(v.warnings)) return false
  if (typeof v.asOf !== 'string' || typeof v.truncated !== 'boolean') return false
  return Object.values(v.facts).every(x => x === null || ['string', 'number', 'boolean'].includes(typeof x))
}
