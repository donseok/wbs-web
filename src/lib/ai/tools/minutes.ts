import { minuteHref } from '@/lib/ai/chat/deep-links'
import type { TeamCode } from '@/lib/domain/types'
import type {
  MinuteFileMetadataRecord,
  MinuteRepositoryRecord,
  MinutesRepository,
} from '@/lib/repositories/types'
import {
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
  validDateRange,
} from './common'
import type { BotSource, ReadOnlyBotTool, ToolExecutionResult } from './types'

const MINUTES_CAPABILITY = 'minutes:read' as const
const MINUTE_TEAMS: readonly string[] = ['PMO', 'ERP', 'MES', '가공']
/** query·기간이 모두 없을 때 전 기간 무제한 조회를 막는 기본 조회 기간(일). */
const DEFAULT_SEARCH_WINDOW_DAYS = 90
const BODY_MD_CAP = 4_000
const MAX_INSIGHTS = 12
const MAX_FILES = 20

export interface MinuteToolRecord {
  id: string
  minuteDate: string
  teamCode: TeamCode
  title: string
  meetingId: string | null
  meetingProjectId: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string | null
}

/** 표시 키 충돌 방지: 'kind'는 WBS 담당 역할 라벨('역할')이 선점해 insightKind로 노출한다. */
export interface MinuteInsightToolRecord {
  insightKind: string
  label: string
  blockIndex: number
}

export interface MinuteDetailToolRecord extends MinuteToolRecord {
  bodyMd: string
  insights: MinuteInsightToolRecord[]
  files: MinuteFileMetadataRecord[]
}

function toToolRecord(record: MinuteRepositoryRecord): MinuteToolRecord {
  return {
    id: record.id,
    minuteDate: record.minuteDate,
    teamCode: record.teamCode,
    title: record.title,
    meetingId: record.meetingId,
    meetingProjectId: record.meetingProjectId,
    createdByName: record.createdByName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function minuteSource(record: MinuteToolRecord, excerpt?: string): BotSource {
  return {
    id: `minute:${record.id}`,
    domain: 'minutes',
    entityType: 'minute',
    entityId: record.id,
    projectId: record.meetingProjectId,
    title: record.title,
    href: minuteHref(record.id),
    updatedAt: record.updatedAt,
    ...(excerpt ? { excerpt } : {}),
  }
}

function accessDenied(message: string): ToolExecutionResult<never> {
  return { ok: false, error: { code: 'ACCESS_DENIED', message, retryable: false } }
}

function seoulDateMinusDays(now: string, days: number): string {
  const base = new Date(`${todayInSeoul(now)}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() - days)
  return base.toISOString().slice(0, 10)
}

export function createSearchMinutesTool(
  repository: MinutesRepository,
): ReadOnlyBotTool<MinuteToolRecord> {
  return {
    name: 'search_minutes',
    requiredCapability: MINUTES_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const query = readOptionalString(args.query, 200)
      const team = readOptionalString(args.team, 30)
      const projectId = readOptionalString(args.projectId)
      const from = args.from === undefined || args.from === null
        ? undefined
        : isIsoDate(args.from) ? args.from : null
      const to = args.to === undefined || args.to === null
        ? undefined
        : isIsoDate(args.to) ? args.to : null
      const limit = readLimit(args.limit)
      if (
        query === null || team === null || projectId === null
        || from === null || to === null || limit === null
      ) return invalidArgument()
      if (team && !MINUTE_TEAMS.includes(team)) return invalidArgument('알 수 없는 담당팀입니다.')
      if ((from === undefined) !== (to === undefined)) {
        return invalidArgument('회의록 조회 기간은 from·to를 함께 지정해야 합니다.')
      }
      if (from && to && !validDateRange(from, to)) {
        return invalidArgument('회의록 조회 기간이 올바르지 않습니다.')
      }

      if (projectId) {
        const denied = checkProjectAccess(context, projectId, MINUTES_CAPABILITY)
        if (denied) return denied
      } else if (!context.userId || !context.capabilities.includes(MINUTES_CAPABILITY)) {
        // 전역 검색은 현행 보관함과 동일하게 프로젝트 스코프 없이 허용하되 capability는 항상 요구한다.
        return accessDenied('회의록을 조회할 권한이 없습니다.')
      }

      const defaultRangeApplied = !query && from === undefined
      const rangeFrom = from
        ?? (defaultRangeApplied ? seoulDateMinusDays(context.now, DEFAULT_SEARCH_WINDOW_DAYS) : null)
      const rangeTo = to ?? (defaultRangeApplied ? todayInSeoul(context.now) : null)

      const repoResult = await repository.searchMinutes({
        query: query ?? null,
        team: (team as TeamCode | undefined) ?? null,
        projectId: projectId ?? null,
        from: rangeFrom,
        to: rangeTo,
        limit,
      })
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (projectId && repoResult.data.records.some(record => record.meetingProjectId !== projectId)) {
        return repositoryScopeViolation()
      }

      const records = repoResult.data.records.map(toToolRecord)
      const truncated = repoResult.data.truncated
      const warnings: string[] = []
      if (projectId) {
        warnings.push('프로젝트 필터는 회의에 연결된 회의록만 포함합니다 — 회의 미연결 회의록은 제외됩니다.')
      }
      if (truncated) warnings.push(`조건에 맞는 회의록이 더 있어 ${records.length}건까지만 반환했습니다.`)
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            totalMatched: records.length,
            returned: records.length,
            rangeFrom,
            rangeTo,
            defaultRangeApplied,
          },
          records,
          sources: records.map(record => minuteSource(record)),
          asOf: context.now,
          truncated,
          warnings,
        },
      }
    },
  }
}

export function createGetMinuteDetailTool(
  repository: MinutesRepository,
): ReadOnlyBotTool<MinuteDetailToolRecord> {
  return {
    name: 'get_minute_detail',
    requiredCapability: MINUTES_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const minuteId = readRequiredString(args.minuteId)
      if (!minuteId) return invalidArgument()
      if (!context.userId || !context.capabilities.includes(MINUTES_CAPABILITY)) {
        return accessDenied('회의록을 조회할 권한이 없습니다.')
      }

      const repoResult = await repository.getMinuteDetail(minuteId)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!repoResult.data) {
        return {
          ok: true,
          result: {
            status: 'ok', facts: { minuteFound: false, returned: 0 },
            records: [], sources: [], asOf: context.now, truncated: false, warnings: [],
          },
        }
      }
      const { minute, insights, files } = repoResult.data
      if (minute.id !== minuteId) return repositoryScopeViolation()
      // 프로젝트에 연결된 회의록은 허용 목록 밖이면 fail-closed. null은 전역 회의록으로 허용한다.
      if (minute.meetingProjectId !== null && !context.allowedProjectIds.includes(minute.meetingProjectId)) {
        return accessDenied('요청한 프로젝트 데이터에 접근할 수 없습니다.')
      }

      const bodyTruncated = minute.bodyMd.length > BODY_MD_CAP
      const bodyMd = bodyTruncated ? minute.bodyMd.slice(0, BODY_MD_CAP) : minute.bodyMd
      const limitedInsights = insights.slice(0, MAX_INSIGHTS)
      const limitedFiles = files.slice(0, MAX_FILES)
      const record: MinuteDetailToolRecord = {
        ...toToolRecord(minute),
        bodyMd,
        insights: limitedInsights.map(insight => ({
          insightKind: insight.kind,
          label: insight.label,
          blockIndex: insight.blockIndex,
        })),
        files: limitedFiles.map(file => ({
          fileName: file.fileName,
          size: file.size,
          mime: file.mime,
          createdAt: file.createdAt,
        })),
      }

      const warnings: string[] = []
      if (bodyTruncated) warnings.push(`회의록 본문이 길어 앞 ${BODY_MD_CAP.toLocaleString('ko-KR')}자까지만 반환했습니다.`)
      if (insights.length > limitedInsights.length) {
        warnings.push(`인사이트 ${insights.length}건 중 ${limitedInsights.length}건만 반환했습니다.`)
      }
      if (files.length > limitedFiles.length) {
        warnings.push(`파일 ${files.length}건 중 ${limitedFiles.length}건만 반환했습니다.`)
      }
      const truncated = warnings.length > 0
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            minuteFound: true,
            returned: 1,
            insightCount: insights.length,
            fileCount: files.length,
            bodyTruncated,
          },
          records: [record],
          sources: [minuteSource(record, shortExcerpt(bodyMd))],
          asOf: context.now,
          truncated,
          warnings,
        },
      }
    },
  }
}
