// Wiki 도구 — "그거 어떻게 하기로 했죠?"에 회의록 전문 대신 정리된 결론으로 답하기 위한 경로.
// 회의록 원문 검색(search_minutes)은 문장을 찾아주지만 어느 것이 현재 유효한 결론인지 모른다.
// Wiki는 그 판정이 끝난 지식이므로, 봇이 먼저 여기를 보고 근거 회의록으로 링크한다.
import { minuteHref, wikiHref, wikiTopicHref } from '@/lib/ai/chat/deep-links'
import { WIKI_ITEM_KINDS } from '@/lib/domain/wiki'
import {
  isActiveWikiDecision,
  isConflictedWikiItem,
  isOpenWikiItem,
} from '@/lib/domain/wikiView'
import type { WikiKnowledgeRecord, WikiRepository } from '@/lib/repositories/types'
import {
  checkProjectAccess,
  invalidArgument,
  isRecord,
  readLimit,
  readOptionalString,
  readRequiredString,
  repositoryFailure,
} from './common'
import type {
  BotSource,
  ReadOnlyBotTool,
  ToolExecutionContext,
} from './types'

const WIKI_CAPABILITY = 'wiki:read' as const
const DEFAULT_LIMIT = 12
const KINDS = new Set<string>(WIKI_ITEM_KINDS)

export interface WikiToolRecord {
  id: string
  topicId: string
  topicTitle: string
  kind: string
  statement: string
  /** 현재 유효/열림/상충 — 봇이 "확정된 내용"과 "논의 중"을 섞어 말하지 않게 한다. */
  status: 'current' | 'open' | 'in_discussion' | 'conflicted'
  ownerTeam: string | null
  dueDate: string | null
  observedAt: string | null
  evidenceExcerpt: string | null
  sourceMinuteIds: string[]
}

/** 표시 상태 판정은 lib/domain/wikiView 정본을 그대로 쓴다 — 화면과 봇이 달리 세면 안 된다. */
function statusOf(record: WikiKnowledgeRecord): WikiToolRecord['status'] {
  const view = { ...record, updatedAt: record.updatedAt, sources: [] as never[] }
  if (isConflictedWikiItem(view)) return 'conflicted'
  if (record.kind === 'decision') return isActiveWikiDecision(view) ? 'current' : 'in_discussion'
  if (isOpenWikiItem(view)) return 'open'
  return record.certainty === 'tentative' ? 'in_discussion' : 'current'
}

function toToolRecord(record: WikiKnowledgeRecord): WikiToolRecord {
  return {
    id: record.id,
    topicId: record.topicId,
    topicTitle: record.topicTitle,
    kind: record.kind,
    statement: record.statement,
    status: statusOf(record),
    ownerTeam: record.ownerTeam,
    dueDate: record.dueDate,
    observedAt: record.observedAt,
    evidenceExcerpt: record.evidenceExcerpt,
    sourceMinuteIds: record.sourceMinuteIds,
  }
}

/**
 * 출처는 Wiki 항목 자체와 근거 회의록을 모두 남긴다.
 * Wiki만 남기면 "AI가 정리한 문장"의 원문 확인 경로가 끊기고,
 * 회의록만 남기면 사용자가 현재 결론이 아니라 과거 발언으로 되돌아간다.
 */
function sourcesFor(projectId: string, records: WikiKnowledgeRecord[]): BotSource[] {
  const sources: BotSource[] = []
  const seen = new Set<string>()
  for (const record of records) {
    const wikiId = `wiki:${record.id}`
    if (!seen.has(wikiId)) {
      seen.add(wikiId)
      sources.push({
        id: wikiId,
        domain: 'wiki',
        entityType: 'wiki_item',
        entityId: record.id,
        projectId,
        title: record.topicTitle || record.statement.slice(0, 60),
        href: wikiTopicHref(projectId, record.topicId),
        updatedAt: record.updatedAt,
      })
    }
    for (const minuteId of record.sourceMinuteIds.slice(0, 2)) {
      const key = `minute:${minuteId}`
      if (seen.has(key)) continue
      seen.add(key)
      sources.push({
        id: key,
        domain: 'minutes',
        entityType: 'minute',
        entityId: minuteId,
        projectId,
        title: record.topicTitle || '회의록 원문',
        href: minuteHref(minuteId),
        updatedAt: record.updatedAt,
      })
    }
  }
  return sources
}

function countFacts(records: WikiToolRecord[]): Record<string, number> {
  return {
    current: records.filter((record) => record.status === 'current').length,
    open: records.filter((record) => record.status === 'open').length,
    inDiscussion: records.filter((record) => record.status === 'in_discussion').length,
    conflicted: records.filter((record) => record.status === 'conflicted').length,
  }
}

export function createSearchWikiTool(
  repository: WikiRepository,
): ReadOnlyBotTool<WikiToolRecord> {
  return {
    name: 'search_wiki',
    requiredCapability: WIKI_CAPABILITY,
    async execute(args: unknown, context: ToolExecutionContext) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      if (!projectId) return invalidArgument('projectId가 필요합니다.')
      const denied = checkProjectAccess(context, projectId, WIKI_CAPABILITY)
      if (denied) return denied

      const query = readOptionalString(args.query, 200)
      if (query === null) return invalidArgument('query 형식이 올바르지 않습니다.')
      const kind = readOptionalString(args.kind, 30)
      if (kind === null) return invalidArgument('kind 형식이 올바르지 않습니다.')
      if (kind !== undefined && !KINDS.has(kind)) {
        return invalidArgument('kind는 결정·사실·액션·질문·리스크·제약·근거 중 하나여야 합니다.')
      }
      const limit = readLimit(args.limit) ?? DEFAULT_LIMIT

      const result = await repository.searchWikiKnowledge({
        projectId,
        query: query ?? null,
        kind: kind ?? null,
        limit,
      })
      if (!result.ok) return repositoryFailure(result)

      const records = result.data.items.map(toToolRecord)
      const warnings: string[] = []
      if (result.data.scanTruncated) {
        warnings.push('지식이 많아 최근 변경분 범위에서만 검색했습니다.')
      }
      if (records.length === 0) {
        warnings.push('조건에 맞는 Wiki 지식이 없습니다. 회의록 원문 검색이 필요할 수 있습니다.')
      }
      return {
        ok: true,
        result: {
          status: result.data.scanTruncated ? 'partial' : 'ok',
          facts: { projectId, matched: records.length, ...countFacts(records) },
          records,
          sources: sourcesFor(projectId, result.data.items),
          asOf: context.now,
          truncated: result.data.scanTruncated,
          warnings,
        },
      }
    },
  }
}

export function createGetWikiTopicTool(
  repository: WikiRepository,
): ReadOnlyBotTool<WikiToolRecord> {
  return {
    name: 'get_wiki_topic',
    requiredCapability: WIKI_CAPABILITY,
    async execute(args: unknown, context: ToolExecutionContext) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      if (!projectId) return invalidArgument('projectId가 필요합니다.')
      const denied = checkProjectAccess(context, projectId, WIKI_CAPABILITY)
      if (denied) return denied

      const topicId = readOptionalString(args.topicId, 60)
      if (topicId === null) return invalidArgument('topicId 형식이 올바르지 않습니다.')
      const title = readOptionalString(args.title, 200)
      if (title === null) return invalidArgument('title 형식이 올바르지 않습니다.')
      if (!topicId && !title) return invalidArgument('topicId 또는 title 중 하나가 필요합니다.')

      const result = await repository.getWikiTopic({
        projectId,
        topicId: topicId ?? null,
        titleQuery: title ?? null,
      })
      if (!result.ok) return repositoryFailure(result)

      if (!result.data) {
        return {
          ok: true,
          result: {
            status: 'ok',
            facts: { projectId, found: false, matched: 0 },
            records: [],
            sources: [{
              id: `wiki:${projectId}`,
              domain: 'wiki',
              entityType: 'wiki_topic',
              entityId: projectId,
              projectId,
              title: '프로젝트 Wiki',
              href: wikiHref(projectId),
              updatedAt: null,
            }],
            asOf: context.now,
            truncated: false,
            warnings: ['해당 주제를 Wiki에서 찾지 못했습니다.'],
          },
        }
      }

      const records = result.data.items.map(toToolRecord)
      return {
        ok: true,
        result: {
          status: 'ok',
          facts: {
            projectId,
            found: true,
            topicId: result.data.topic.id,
            topicTitle: result.data.topic.title,
            ownerTeam: result.data.topic.ownerTeam,
            matched: records.length,
            ...countFacts(records),
          },
          records,
          sources: sourcesFor(projectId, result.data.items).length > 0
            ? sourcesFor(projectId, result.data.items)
            : [{
              id: `wiki:${result.data.topic.id}`,
              domain: 'wiki',
              entityType: 'wiki_topic',
              entityId: result.data.topic.id,
              projectId,
              title: result.data.topic.title,
              href: wikiTopicHref(projectId, result.data.topic.id),
              updatedAt: result.data.topic.lastChangedAt,
            }],
          asOf: context.now,
          truncated: false,
          warnings: [],
        },
      }
    },
  }
}
