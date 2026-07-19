import type { BotEntityType } from '@/lib/ai/chat/protocol'
import { isValidKnowledgeTimestamp } from './freshness'
import type { IndexSourceSummary } from './consistency'
import type { SupabaseKnowledgeClient } from './pgvector'
import type { IndexMutation, IndexMutationSummary, KnowledgeIndexResult } from './types'

/** 백필/정합성 검사가 지원하는 색인 도메인 5종 — 콘텐츠 로더(content.ts)와 1:1. */
export const INDEX_BACKFILL_DOMAINS = ['wbs', 'weekly', 'meetings', 'announcements', 'minutes'] as const
export type IndexBackfillDomain = (typeof INDEX_BACKFILL_DOMAINS)[number]

export const INDEX_BACKFILL_ENTITY_TYPE: Record<IndexBackfillDomain, BotEntityType> = {
  wbs: 'wbs_item',
  weekly: 'weekly_report',
  meetings: 'meeting',
  announcements: 'announcement',
  minutes: 'minute',
}

export const INDEX_BACKFILL_BATCH = 200
const MAX_LIST_ROWS = 5_000

export type IndexSourceListResult =
  | { ok: true; data: IndexSourceSummary[] }
  | { ok: false; errorCode: string; retryable: boolean }

/** projectId undefined = 전체 프로젝트. 반환 요약의 projectId는 실제 원본 소속이다. */
export type IndexSourceLister = (
  domain: IndexBackfillDomain,
  projectId?: string,
) => Promise<IndexSourceListResult>

export interface IndexBackfillSummary {
  planned: number
  enqueued: number
  batches: number
  dryRun: boolean
  listErrorCode: string | null
  enqueueErrorCode: string | null
}

/**
 * 도메인·프로젝트별 엔티티 열거 → 배치 enqueue(순수 오케스트레이션 — 열거/큐는 주입).
 * dryRun이면 enqueue 없이 계획 수만 계산한다. 초기 백필·관리자 복구 전용(설계 §10.4).
 */
export async function runIndexBackfill(deps: {
  domain: IndexBackfillDomain
  projectId?: string
  list: IndexSourceLister
  enqueue: (mutations: readonly IndexMutation[]) => Promise<KnowledgeIndexResult<IndexMutationSummary>>
  dryRun?: boolean
  batchSize?: number
}): Promise<IndexBackfillSummary> {
  const batchSize = Math.max(1, Math.min(Math.floor(deps.batchSize ?? INDEX_BACKFILL_BATCH), INDEX_BACKFILL_BATCH))
  const listed = await deps.list(deps.domain, deps.projectId)
  if (!listed.ok) {
    return { planned: 0, enqueued: 0, batches: 0, dryRun: Boolean(deps.dryRun), listErrorCode: listed.errorCode, enqueueErrorCode: null }
  }

  const mutations: IndexMutation[] = listed.data.map(source => ({
    operation: 'upsert',
    projectId: source.projectId,
    domain: source.domain,
    entityType: source.entityType,
    entityId: source.entityId,
    payload: { reason: 'backfill' },
  }))

  if (deps.dryRun) {
    return {
      planned: mutations.length,
      enqueued: 0,
      batches: Math.ceil(mutations.length / batchSize),
      dryRun: true,
      listErrorCode: null,
      enqueueErrorCode: null,
    }
  }

  let enqueued = 0
  let batches = 0
  for (let start = 0; start < mutations.length; start += batchSize) {
    const batch = mutations.slice(start, start + batchSize)
    const result = await deps.enqueue(batch)
    // 배치 실패 시 이후 배치를 중단한다 — 부분 성공 수만 정직하게 보고.
    if (!result.ok) {
      return { planned: mutations.length, enqueued, batches, dryRun: false, listErrorCode: null, enqueueErrorCode: result.error.code }
    }
    enqueued += result.data.affected ?? batch.length
    batches += 1
  }
  return { planned: mutations.length, enqueued, batches, dryRun: false, listErrorCode: null, enqueueErrorCode: null }
}

type Row = Record<string, unknown>

function safeTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 64 && isValidKnowledgeTimestamp(value) ? value : null
}

function nestedProjectId(value: unknown): string | null {
  const nested = Array.isArray(value) ? value[0] : value
  if (!nested || typeof nested !== 'object') return null
  const projectId = (nested as Row).project_id
  return typeof projectId === 'string' ? projectId : null
}

interface SourceTableSpec {
  table: string
  columns: string
  projectColumn: string | null
}

const SOURCE_TABLES: Record<IndexBackfillDomain, SourceTableSpec> = {
  wbs: { table: 'wbs_items', columns: 'id, project_id, updated_at', projectColumn: 'project_id' },
  weekly: { table: 'weekly_reports', columns: 'id, project_id, updated_at', projectColumn: 'project_id' },
  meetings: { table: 'meetings', columns: 'id, project_id, updated_at', projectColumn: 'project_id' },
  announcements: {
    table: 'announcements',
    columns: 'id, project_id, updated_at, created_at',
    projectColumn: 'project_id',
  },
  // 회의록은 meetings 역참조로만 프로젝트가 정해진다(미연결이면 global=null).
  minutes: { table: 'minutes', columns: 'id, updated_at, created_at, meetings(project_id)', projectColumn: null },
}

/**
 * Supabase 원본 열거 어댑터 — 백필과 정합성 검사가 같은 소스 요약을 공유한다.
 * id·시각 메타데이터만 읽는다(본문·개인 정보 없음).
 */
export function createSupabaseIndexSourceLister(client: SupabaseKnowledgeClient): IndexSourceLister {
  return async (domain, projectId) => {
    const spec = SOURCE_TABLES[domain]
    if (!spec) return { ok: false, errorCode: 'INDEX_BACKFILL_DOMAIN_INVALID', retryable: false }

    let query = client.from(spec.table).select(spec.columns)
    if (projectId && spec.projectColumn) query = query.eq(spec.projectColumn, projectId)
    const { data, error } = await query.limit(MAX_LIST_ROWS)
    if (error) return { ok: false, errorCode: 'INDEX_BACKFILL_READ_FAILED', retryable: true }
    if (!Array.isArray(data)) return { ok: false, errorCode: 'INDEX_BACKFILL_READ_FAILED', retryable: false }

    const summaries: IndexSourceSummary[] = []
    for (const value of data) {
      if (!value || typeof value !== 'object' || typeof (value as Row).id !== 'string') {
        return { ok: false, errorCode: 'INDEX_BACKFILL_ROW_INVALID', retryable: false }
      }
      const row = value as Row
      const rowProjectId = spec.projectColumn
        ? (typeof row.project_id === 'string' ? row.project_id : null)
        : nestedProjectId(row.meetings)
      // 프로젝트 필터가 조인 경유(minutes)면 여기서 후처리로 걸러낸다.
      if (projectId && rowProjectId !== projectId) continue
      summaries.push({
        projectId: rowProjectId,
        domain,
        entityType: INDEX_BACKFILL_ENTITY_TYPE[domain],
        entityId: row.id as string,
        updatedAt: safeTimestamp(row.updated_at) ?? safeTimestamp(row.created_at),
        contentHash: null,
      })
    }
    return { ok: true, data: summaries }
  }
}
