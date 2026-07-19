import type { AnnouncementCategory } from '@/lib/domain/types'
import type {
  AnnouncementRepository,
  AnnouncementRepositoryRecord,
} from '@/lib/repositories/types'
import { announcementHref } from '@/lib/ai/chat/deep-links'
import {
  MAX_RESULT_LIMIT,
  checkProjectAccess,
  invalidArgument,
  isIsoDate,
  isRecord,
  readLimit,
  readOptionalString,
  readRequiredString,
  repositoryFailure,
  repositoryScopeViolation,
  shortExcerpt,
  todayInSeoul,
} from './common'
import type {
  BotSource,
  ReadOnlyBotTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from './types'

const ANNOUNCEMENTS_CAPABILITY = 'announcements:read' as const
const ANNOUNCEMENT_CATEGORIES = new Set<AnnouncementCategory>(['general', 'important', 'event'])

export interface AnnouncementToolRecord {
  id: string
  projectId: string
  title: string
  category: AnnouncementCategory
  isPinned: boolean
  publishFrom: string | null
  publishTo: string | null
  createdAt: string
  updatedAt: string | null
  /** body 전문은 계약에서 제외 — 최대 300자 발췌만 노출한다. */
  bodyExcerpt: string | null
}

function readCategory(value: unknown): AnnouncementCategory | null | undefined {
  const category = readOptionalString(value, 30)
  if (category === undefined) return undefined
  return category !== null && ANNOUNCEMENT_CATEGORIES.has(category as AnnouncementCategory)
    ? (category as AnnouncementCategory)
    : null
}

function readOptionalBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) return undefined
  return typeof value === 'boolean' ? value : null
}

function readOptionalIsoDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined
  return isIsoDate(value) ? value : null
}

/** publish_from/to가 null이면 항상 게시 중으로 본다(공지 화면 로직과 동일). */
function isActiveOn(record: AnnouncementRepositoryRecord, date: string): boolean {
  return (!record.publishFrom || record.publishFrom <= date)
    && (!record.publishTo || record.publishTo >= date)
}

/** 검색 매치 지점 주변만 잘라 발췌한다. 본문에 매치가 없으면(제목 매치) 앞부분 발췌. */
function matchExcerpt(body: string, query: string): string | null {
  const index = body.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return shortExcerpt(body) ?? null
  const start = Math.max(0, index - 80)
  const prefix = start > 0 ? '…' : ''
  return shortExcerpt(`${prefix}${body.slice(start, start + 400)}`) ?? null
}

function finishAnnouncements(
  context: ToolExecutionContext,
  projectId: string,
  matched: AnnouncementRepositoryRecord[],
  limit: number,
  activeDate: string,
  scanTruncated: boolean,
  excerptOf: (record: AnnouncementRepositoryRecord) => string | null,
): ToolExecutionResult<AnnouncementToolRecord> {
  const selected = matched.slice(0, limit)
  const records: AnnouncementToolRecord[] = selected.map(record => ({
    id: record.id,
    projectId: record.projectId,
    title: record.title,
    category: record.category,
    isPinned: record.isPinned,
    publishFrom: record.publishFrom,
    publishTo: record.publishTo,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    bodyExcerpt: excerptOf(record),
  }))
  const sources: BotSource[] = selected.map(record => ({
    id: `announcement:${record.id}`,
    domain: 'announcements',
    entityType: 'announcement',
    entityId: record.id,
    projectId,
    title: record.title,
    href: announcementHref(projectId, record.id),
    updatedAt: record.updatedAt,
  }))
  const warnings: string[] = []
  if (scanTruncated) {
    warnings.push(`공지가 많아 최근 ${MAX_RESULT_LIMIT}건 범위에서만 조회했습니다.`)
  }
  if (matched.length > records.length) {
    warnings.push(`공지 ${matched.length}건 중 ${records.length}건만 반환했습니다.`)
  }
  const truncated = scanTruncated || matched.length > records.length
  return {
    ok: true,
    result: {
      status: truncated ? 'partial' : 'ok',
      facts: {
        totalMatched: matched.length,
        returned: records.length,
        pinnedCount: matched.filter(record => record.isPinned).length,
        activeCount: matched.filter(record => isActiveOn(record, activeDate)).length,
      },
      records,
      sources,
      asOf: context.now,
      truncated,
      warnings,
    },
  }
}

export function createListAnnouncementsTool(
  repository: AnnouncementRepository,
): ReadOnlyBotTool<AnnouncementToolRecord> {
  return {
    name: 'list_announcements',
    requiredCapability: ANNOUNCEMENTS_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const limit = readLimit(args.limit)
      if (!projectId || limit === null) return invalidArgument()
      const category = readCategory(args.category)
      if (category === null) return invalidArgument('알 수 없는 공지 분류입니다.')
      const pinnedOnly = readOptionalBoolean(args.pinnedOnly)
      if (pinnedOnly === null) return invalidArgument('pinnedOnly는 불리언이어야 합니다.')
      const activeOn = readOptionalIsoDate(args.activeOn)
      if (activeOn === null) return invalidArgument('activeOn 날짜 형식이 올바르지 않습니다.')
      const denied = checkProjectAccess(context, projectId, ANNOUNCEMENTS_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.listAnnouncements(projectId, MAX_RESULT_LIMIT)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      const { records: fetched, truncated: scanTruncated } = repoResult.data
      if (fetched.some(record => record.projectId !== projectId)) {
        return repositoryScopeViolation()
      }

      const matched = fetched.filter(record => {
        if (pinnedOnly && !record.isPinned) return false
        if (category && record.category !== category) return false
        if (activeOn && !isActiveOn(record, activeOn)) return false
        return true
      })
      return finishAnnouncements(
        context, projectId, matched, limit,
        activeOn ?? todayInSeoul(context.now), scanTruncated,
        record => shortExcerpt(record.body) ?? null,
      )
    },
  }
}

export function createSearchAnnouncementsTool(
  repository: AnnouncementRepository,
): ReadOnlyBotTool<AnnouncementToolRecord> {
  return {
    name: 'search_announcements',
    requiredCapability: ANNOUNCEMENTS_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const limit = readLimit(args.limit)
      if (!projectId || limit === null) return invalidArgument()
      const query = readRequiredString(args.query, 200)
      if (!query) return invalidArgument('검색어는 1~200자여야 합니다.')
      const category = readCategory(args.category)
      if (category === null) return invalidArgument('알 수 없는 공지 분류입니다.')
      const denied = checkProjectAccess(context, projectId, ANNOUNCEMENTS_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.listAnnouncements(projectId, MAX_RESULT_LIMIT)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      const { records: fetched, truncated: scanTruncated } = repoResult.data
      if (fetched.some(record => record.projectId !== projectId)) {
        return repositoryScopeViolation()
      }

      const needle = query.toLowerCase()
      const matched = fetched.filter(record => {
        if (category && record.category !== category) return false
        return record.title.toLowerCase().includes(needle)
          || record.body.toLowerCase().includes(needle)
      })
      return finishAnnouncements(
        context, projectId, matched, limit,
        todayInSeoul(context.now), scanTruncated,
        record => matchExcerpt(record.body, query),
      )
    },
  }
}
