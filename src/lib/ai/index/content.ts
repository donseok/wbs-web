import { chunkMarkdown } from '@/lib/ai/chunk'
import { embedDocuments } from '@/lib/ai/embeddings'
import { embedConfig } from '@/lib/ai/provider'
import { fnv1a64 } from '@/lib/minutes/blocks'
import { isRetryableReadError, nestedOne } from '@/lib/repositories/supabase/common'
import { isValidKnowledgeTimestamp } from './freshness'
import type { SupabaseKnowledgeClient } from './pgvector'
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  type ClaimedIndexJob,
  type IndexContentLoader,
  type IndexContentLoadResult,
  type IndexContentSnapshot,
  type KnowledgeDocumentInput,
} from './types'

export const CURRENT_INDEX_VERSION = 1
export const INDEX_CHUNKER_VERSION = 'md1500-v1'

// 초대형 본문이 한 엔티티에서 청크 수백 개를 만들면 upsert 배치 상한(200)을 넘는다.
// 상한 초과분은 색인에서 잘라낸다(검색 실패보다 부분 색인이 낫다).
const MAX_CONTENT_CHARS = 120_000
const CHUNK_MAX = 1_500

type Row = Record<string, unknown>

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function safeDate(value: unknown): string | null {
  const raw = str(value)
  if (!raw) return null
  const date = raw.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function safeTimestamp(value: unknown): string | null {
  const raw = str(value)
  return raw && raw.length <= 64 && isValidKnowledgeTimestamp(raw) ? raw : null
}

function readError(errorCode: string, error: unknown): IndexContentLoadResult {
  return { ok: false, errorCode, retryable: isRetryableReadError(error) }
}

/** 조회 행의 프로젝트가 작업의 프로젝트와 다르면 내용 노출 전에 실패로 끊는다(fail-closed). */
function scopeMismatch(): IndexContentLoadResult {
  return { ok: false, errorCode: 'INDEX_CONTENT_SCOPE_MISMATCH', retryable: false }
}

function joinLines(lines: Array<string | null>): string {
  return lines.filter((line): line is string => Boolean(line && line.trim())).join('\n')
}

async function toSnapshot(input: {
  job: ClaimedIndexJob
  title: string
  text: string
  href: string
  team: string | null
  occurredOn: string | null
  sourceUpdatedAt: string | null
}): Promise<IndexContentSnapshot> {
  const text = input.text.slice(0, MAX_CONTENT_CHARS)
  const chunks = chunkMarkdown(text, CHUNK_MAX)
  // 임베딩 키가 없거나 일부 항목이 실패하면 embedding null — 키워드 검색 폴백은 유지된다(§14).
  const vectors = chunks.length ? await embedDocuments(chunks, 'RETRIEVAL_DOCUMENT') : []
  const contentHash = fnv1a64(text)
  const model = embedConfig().model
  const documents: KnowledgeDocumentInput[] = chunks.map((content, chunkNo) => ({
    projectId: input.job.projectId,
    domain: input.job.domain,
    entityType: input.job.entityType,
    entityId: input.job.entityId,
    chunkNo,
    indexVersion: CURRENT_INDEX_VERSION,
    title: input.title.trim().slice(0, 500),
    content,
    contentHash,
    href: input.href,
    team: input.team,
    occurredOn: input.occurredOn,
    updatedAt: input.sourceUpdatedAt,
    embeddingModel: model,
    embeddingDimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
    chunkerVersion: INDEX_CHUNKER_VERSION,
    embedding: vectors?.[chunkNo] ?? null,
  }))
  return { documents, sourceUpdatedAt: input.sourceUpdatedAt }
}

function primaryOwnerTeam(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const row = value as Row
    const team = nestedOne(row.teams as { code?: unknown } | { code?: unknown }[] | null)
    if (row.kind === 'primary' && typeof team?.code === 'string') return team.code
  }
  return null
}

function ownerLine(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null
  const teams = raw.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const row = value as Row
    const team = nestedOne(row.teams as { code?: unknown } | { code?: unknown }[] | null)
    return typeof team?.code === 'string' ? [team.code] : []
  })
  return teams.length ? `담당팀: ${[...new Set(teams)].join(', ')}` : null
}

async function loadWbsItem(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  const { data, error } = await client.from('wbs_items')
    .select('id, project_id, code, name, biz, deliverable, planned_start, planned_end, actual_pct, updated_at, item_owners(kind, teams(code))')
    .eq('id', job.entityId)
    .maybeSingle()
  if (error) return readError('WBS_ITEMS_READ_FAILED', error)
  if (!data) return { ok: true, data: null }
  const row = data as Row
  if (row.project_id !== job.projectId || row.id !== job.entityId) return scopeMismatch()

  const code = str(row.code) ?? ''
  const name = str(row.name) ?? ''
  const pct = typeof row.actual_pct === 'number' && Number.isFinite(row.actual_pct)
    ? Math.round(row.actual_pct)
    : null
  const plannedStart = safeDate(row.planned_start)
  const plannedEnd = safeDate(row.planned_end)
  const text = joinLines([
    `# WBS ${code} ${name}`.trim(),
    str(row.biz) ? `구분: ${str(row.biz)}` : null,
    str(row.deliverable) ? `산출물: ${str(row.deliverable)}` : null,
    plannedStart || plannedEnd ? `계획 기간: ${plannedStart ?? '미정'} ~ ${plannedEnd ?? '미정'}` : null,
    pct !== null ? `진행률: ${pct}%` : null,
    ownerLine(row.item_owners),
  ])
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: `${code} ${name}`.trim(),
      text,
      href: `/p/${encodeURIComponent(job.projectId ?? '')}/wbs?focus=${encodeURIComponent(job.entityId)}`,
      team: primaryOwnerTeam(row.item_owners),
      occurredOn: plannedEnd ?? plannedStart,
      sourceUpdatedAt: safeTimestamp(row.updated_at),
    }),
  }
}

async function loadWeeklyReport(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  const reportResult = await client.from('weekly_reports')
    .select('id, project_id, week_start, title, updated_at')
    .eq('id', job.entityId)
    .maybeSingle()
  if (reportResult.error) return readError('WEEKLY_REPORT_READ_FAILED', reportResult.error)
  if (!reportResult.data) return { ok: true, data: null }
  const report = reportResult.data as Row
  if (report.project_id !== job.projectId) return scopeMismatch()

  const rowsResult = await client.from('weekly_report_rows')
    .select('section, module, sort_order, this_content, this_issue, next_content, next_issue, updated_at')
    .eq('report_id', job.entityId)
    .order('sort_order')
  if (rowsResult.error) return readError('WEEKLY_ROWS_READ_FAILED', rowsResult.error)
  const rows = (Array.isArray(rowsResult.data) ? rowsResult.data : []) as Row[]

  const weekStart = safeDate(report.week_start)
  const lines: Array<string | null> = [`# 주간업무 ${weekStart ?? ''}`.trim()]
  let latest = safeTimestamp(report.updated_at)
  for (const row of rows) {
    const cells = [
      ['금주 업무', str(row.this_content)],
      ['금주 이슈', str(row.this_issue)],
      ['차주 업무', str(row.next_content)],
      ['차주 이슈', str(row.next_issue)],
    ].filter((cell): cell is [string, string] => Boolean(cell[1] && cell[1].trim()))
    if (!cells.length) continue
    lines.push(`## ${str(row.section) ?? ''}`.trim())
    for (const [label, value] of cells) lines.push(`${label}: ${value.trim()}`)
    const rowUpdated = safeTimestamp(row.updated_at)
    // 멀티셀 편집은 행 단위로 갱신되므로 최신 시각은 보고서·행 전체의 max가 원본 시각이다.
    if (rowUpdated && (!latest || Date.parse(rowUpdated) > Date.parse(latest))) latest = rowUpdated
  }
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: `주간업무 ${weekStart ?? ''}`.trim(),
      text: joinLines(lines),
      href: `/p/${encodeURIComponent(job.projectId ?? '')}/weekly?week=${encodeURIComponent(weekStart ?? '')}`,
      team: null,
      occurredOn: weekStart,
      sourceUpdatedAt: latest,
    }),
  }
}

async function loadMeeting(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  // 참석자·작성자 계정 정보는 개인 식별 위험이 있어 색인 본문에서 제외한다.
  const { data, error } = await client.from('meetings')
    .select('id, project_id, title, meeting_date, start_time, end_time, location, category, body, updated_at')
    .eq('id', job.entityId)
    .maybeSingle()
  if (error) return readError('MEETING_DETAIL_READ_FAILED', error)
  if (!data) return { ok: true, data: null }
  const row = data as Row
  if (row.project_id !== job.projectId) return scopeMismatch()

  const meetingDate = safeDate(row.meeting_date)
  const time = [str(row.start_time), str(row.end_time)].filter(Boolean).join('~')
  const text = joinLines([
    `# 회의 ${str(row.title) ?? ''}`.trim(),
    meetingDate ? `일시: ${meetingDate}${time ? ` ${time}` : ''}` : null,
    str(row.location) ? `장소: ${str(row.location)}` : null,
    str(row.category) ? `분류: ${str(row.category)}` : null,
    str(row.body),
  ])
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: str(row.title) ?? '회의',
      text,
      href: `/p/${encodeURIComponent(job.projectId ?? '')}/meetings?focus=${encodeURIComponent(job.entityId)}`,
      team: null,
      occurredOn: meetingDate,
      sourceUpdatedAt: safeTimestamp(row.updated_at),
    }),
  }
}

async function loadAnnouncement(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  const { data, error } = await client.from('announcements')
    .select('id, project_id, title, body, category, publish_from, publish_to, created_at, updated_at')
    .eq('id', job.entityId)
    .maybeSingle()
  if (error) return readError('ANNOUNCEMENTS_READ_FAILED', error)
  if (!data) return { ok: true, data: null }
  const row = data as Row
  if (row.project_id !== job.projectId) return scopeMismatch()

  const publishFrom = safeDate(row.publish_from)
  const publishTo = safeDate(row.publish_to)
  const text = joinLines([
    `# 공지 ${str(row.title) ?? ''}`.trim(),
    str(row.category) ? `분류: ${str(row.category)}` : null,
    publishFrom || publishTo ? `게시 기간: ${publishFrom ?? '즉시'} ~ ${publishTo ?? '상시'}` : null,
    str(row.body),
  ])
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: str(row.title) ?? '공지',
      text,
      href: `/p/${encodeURIComponent(job.projectId ?? '')}/announcements?focus=${encodeURIComponent(job.entityId)}`,
      team: null,
      occurredOn: publishFrom ?? safeDate(row.created_at),
      sourceUpdatedAt: safeTimestamp(row.updated_at) ?? safeTimestamp(row.created_at),
    }),
  }
}

async function loadMinute(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  // created_by(계정)·created_by_name(실명)·file_path(Storage 경로)는 select 자체에서 제외한다.
  const { data, error } = await client.from('minutes')
    .select('id, minute_date, team_code, title, body_md, created_at, updated_at, meetings(project_id)')
    .eq('id', job.entityId)
    .maybeSingle()
  if (error) return readError('MINUTE_DETAIL_READ_FAILED', error)
  if (!data) return { ok: true, data: null }
  const row = data as Row
  const meeting = nestedOne(row.meetings as { project_id?: unknown } | { project_id?: unknown }[] | null)
  const meetingProjectId = typeof meeting?.project_id === 'string' ? meeting.project_id : null
  if (meetingProjectId !== job.projectId) return scopeMismatch()

  const minuteDate = safeDate(row.minute_date)
  const text = joinLines([
    `# 회의록 ${str(row.title) ?? ''}`.trim(),
    minuteDate ? `일자: ${minuteDate}` : null,
    str(row.team_code) ? `팀: ${str(row.team_code)}` : null,
    str(row.body_md),
  ])
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: str(row.title) ?? '회의록',
      text,
      href: `/minutes/${encodeURIComponent(job.entityId)}`,
      team: str(row.team_code),
      occurredOn: minuteDate,
      sourceUpdatedAt: safeTimestamp(row.updated_at) ?? safeTimestamp(row.created_at),
    }),
  }
}

/**
 * service-role 클라이언트 주입형 콘텐츠 로더 팩토리. 지원 엔티티 5종만 처리하며,
 * 미지원 유형은 삭제로 오인하지 않도록 명시적 실패를 반환한다(재시도 무의미 → dead-letter행).
 */
export function createSupabaseIndexContentLoader(client: SupabaseKnowledgeClient): IndexContentLoader {
  return async job => {
    switch (job.entityType) {
      case 'wbs_item': return loadWbsItem(client, job)
      case 'weekly_report': return loadWeeklyReport(client, job)
      case 'meeting': return loadMeeting(client, job)
      case 'announcement': return loadAnnouncement(client, job)
      case 'minute': return loadMinute(client, job)
      default: return { ok: false, errorCode: 'INDEX_CONTENT_UNSUPPORTED', retryable: false }
    }
  }
}
