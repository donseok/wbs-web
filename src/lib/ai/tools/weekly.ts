import { weeklyHref } from '@/lib/ai/chat/deep-links'
import type {
  WeeklyRepository,
  WeeklyRepositoryRow,
  WeeklySheetSnapshot,
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
} from './common'
import type { BotSource, ReadOnlyBotTool } from './types'
import { isRegisteredTeamCode } from '@/lib/teams/master'

const WEEKLY_CAPABILITY = 'weekly:read' as const

const WEEKLY_TEAM_SECTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  ERP: new Set(['ERP', '영업', '구매', '관리회계', '생산계획']),
  MES: new Set(['MES', '품질', '생산계획', '조업및표준화', '물류', '설비및L2', '가공']),
  PMO: new Set(['PMO']),
  가공: new Set(['가공']),
  // 주간업무 구분(업무영역 10종)에 MDM 이 아직 없다 — 빈 매핑은 '알려진 팀이지만 조회 불가'로
  // 명시 거부된다(validateTeam). 구분 신설 시 여기에 채우면 자동 활성.
  MDM: new Set<string>(),
}

/** 팀 → 주간업무 구분 집합. 매핑에 없는 등록 팀은 동명 구분과 매칭(구분 신설 시 자동 활성).
 *  미등록 팀은 null(알 수 없는 팀). */
function sectionsForTeam(team: string): ReadonlySet<string> | null {
  const known = WEEKLY_TEAM_SECTIONS[team]
  if (known) return known
  return isRegisteredTeamCode(team) ? new Set([team]) : null
}

/** team 인자 검증 — 미지 팀과 '매핑 구분 없음'을 구분해 명시 거부(조용한 빈 결과 금지). */
function validateTeam(team: string | undefined): ReturnType<typeof invalidArgument> | null {
  if (!team) return null
  const sections = sectionsForTeam(team)
  if (!sections) return invalidArgument('알 수 없는 담당팀입니다.')
  if (sections.size === 0) {
    return invalidArgument(`${team} 팀에 매핑된 주간업무 구분이 아직 없습니다. 주간업무 시트는 업무영역 구분 체계라 ${team} 전용 구분 신설 전까지 팀 필터를 지원하지 않습니다.`)
  }
  return null
}

export interface WeeklySheetToolRecord {
  id: string
  reportId: string
  projectId: string
  weekStart: string
  section: string
  module: string
  sortOrder: number
  thisContent: string
  thisIssue: string
  nextContent: string
  nextIssue: string
  updatedAt: string | null
}

export interface WeeklyComparisonValues {
  thisContent: string
  thisIssue: string
  nextContent: string
  nextIssue: string
  updatedAt: string | null
}

export interface WeeklySheetComparisonRecord {
  projectId: string
  section: string
  module: string
  fromWeekStart: string
  toWeekStart: string
  change: 'added' | 'removed' | 'changed' | 'unchanged'
  from: WeeklyComparisonValues | null
  to: WeeklyComparisonValues | null
}

interface AggregatedWeeklyRow extends WeeklyComparisonValues {
  section: string
  module: string
  sortOrder: number
  sourceRows: WeeklyRepositoryRow[]
}

function isScopedWeeklySnapshot(
  snapshot: WeeklySheetSnapshot,
  projectId: string,
  weekStart: string,
): boolean {
  return snapshot.report.projectId === projectId
    && snapshot.report.weekStart === weekStart
    && snapshot.rows.every(row => row.reportId === snapshot.report.id)
}

function matchesWeeklyScope(rowSection: string, section?: string, team?: string): boolean {
  const normalized = rowSection.trim().toLocaleLowerCase('ko-KR')
  if (section && normalized !== section.trim().toLocaleLowerCase('ko-KR')) return false
  if (!team) return true
  const mapped = sectionsForTeam(team)
  return !!mapped && [...mapped].some(value =>
    value.toLocaleLowerCase('ko-KR') === normalized,
  )
}

export function createGetWeeklySheetTool(
  repository: WeeklyRepository,
): ReadOnlyBotTool<WeeklySheetToolRecord> {
  return {
    name: 'get_weekly_sheet',
    requiredCapability: WEEKLY_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const weekStart = isIsoDate(args.weekStart) ? args.weekStart : null
      const section = readOptionalString(args.section, 100)
      const team = readOptionalString(args.team, 30)
      const query = readOptionalString(args.query)
      const limit = readLimit(args.limit)
      if (
        !projectId || !weekStart || section === null || team === null
        || query === null || limit === null
      ) {
        return invalidArgument()
      }
      const teamError = validateTeam(team || undefined)
      if (teamError) return teamError
      if (new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) {
        return invalidArgument('주간업무 기준일은 월요일이어야 합니다.')
      }
      const denied = checkProjectAccess(context, projectId, WEEKLY_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.getSheet(projectId, weekStart)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!repoResult.data) {
        return {
          ok: true,
          result: {
            status: 'ok', facts: { reportFound: false, totalMatched: 0, returned: 0 },
            records: [], sources: [], asOf: context.now, truncated: false, warnings: [],
          },
        }
      }
      if (!isScopedWeeklySnapshot(repoResult.data, projectId, weekStart)) return repositoryScopeViolation()

      const needle = query?.toLocaleLowerCase('ko-KR')
      const matched = repoResult.data.rows.filter(row => {
        if (!matchesWeeklyScope(row.section, section, team)) return false
        if (!needle) return true
        return [row.section, row.module, row.thisContent, row.thisIssue, row.nextContent, row.nextIssue]
          .some(value => value.toLocaleLowerCase('ko-KR').includes(needle))
      })
      const records: WeeklySheetToolRecord[] = matched.slice(0, limit).map(row => ({
        ...row,
        projectId,
        weekStart,
      }))
      const href = weeklyHref(projectId, weekStart)
      const reportSource: BotSource = {
        id: `weekly-report:${repoResult.data.report.id}`,
        domain: 'weekly',
        entityType: 'weekly_report',
        entityId: repoResult.data.report.id,
        projectId,
        title: repoResult.data.report.title || `${weekStart} 주간업무`,
        href,
        updatedAt: repoResult.data.report.updatedAt,
      }
      const rowSources: BotSource[] = records.map(row => ({
        id: `weekly-row:${row.id}`,
        domain: 'weekly',
        entityType: 'weekly_row',
        entityId: row.id,
        projectId,
        title: [row.section, row.module].filter(Boolean).join(' · ') || '주간업무 행',
        href,
        updatedAt: row.updatedAt,
        excerpt: shortExcerpt(row.thisContent, row.thisIssue, row.nextContent, row.nextIssue),
      }))
      const truncated = matched.length > records.length
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            reportFound: true,
            weekStart,
            title: repoResult.data.report.title,
            totalRows: repoResult.data.rows.length,
            totalMatched: matched.length,
            returned: records.length,
          },
          records,
          sources: [reportSource, ...rowSources],
          asOf: context.now,
          truncated,
          warnings: truncated ? [`주간업무 ${matched.length}행 중 ${records.length}행만 반환했습니다.`] : [],
        },
      }
    },
  }
}

function monday(value: string): boolean {
  return new Date(`${value}T00:00:00Z`).getUTCDay() === 1
}

function aggregateRows(rows: WeeklyRepositoryRow[]): Map<string, AggregatedWeeklyRow> {
  const out = new Map<string, AggregatedWeeklyRow>()
  const append = (left: string, right: string): string => {
    const value = right.trim()
    return !value ? left : left ? `${left}\n${value}` : value
  }
  for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const section = row.section.trim()
    const moduleName = row.module.trim()
    const key = `${section.toLocaleLowerCase('ko-KR')}\u0000${moduleName.toLocaleLowerCase('ko-KR')}`
    const current = out.get(key)
    if (!current) {
      out.set(key, {
        section,
        module: moduleName,
        sortOrder: row.sortOrder,
        thisContent: row.thisContent,
        thisIssue: row.thisIssue,
        nextContent: row.nextContent,
        nextIssue: row.nextIssue,
        updatedAt: row.updatedAt,
        sourceRows: [row],
      })
      continue
    }
    current.thisContent = append(current.thisContent, row.thisContent)
    current.thisIssue = append(current.thisIssue, row.thisIssue)
    current.nextContent = append(current.nextContent, row.nextContent)
    current.nextIssue = append(current.nextIssue, row.nextIssue)
    current.updatedAt = [current.updatedAt, row.updatedAt]
      .filter((value): value is string => typeof value === 'string')
      .sort()
      .at(-1) ?? null
    current.sourceRows.push(row)
  }
  return out
}

function comparable(row: AggregatedWeeklyRow): WeeklyComparisonValues {
  return {
    thisContent: row.thisContent,
    thisIssue: row.thisIssue,
    nextContent: row.nextContent,
    nextIssue: row.nextIssue,
    updatedAt: row.updatedAt,
  }
}

function comparisonChange(
  from: AggregatedWeeklyRow | undefined,
  to: AggregatedWeeklyRow | undefined,
): WeeklySheetComparisonRecord['change'] {
  if (!from) return 'added'
  if (!to) return 'removed'
  return from.thisContent === to.thisContent
    && from.thisIssue === to.thisIssue
    && from.nextContent === to.nextContent
    && from.nextIssue === to.nextIssue
    ? 'unchanged'
    : 'changed'
}

function comparisonReportSource(
  snapshot: WeeklySheetSnapshot,
  projectId: string,
): BotSource {
  return {
    id: `weekly-report:${snapshot.report.id}`,
    domain: 'weekly',
    entityType: 'weekly_report',
    entityId: snapshot.report.id,
    projectId,
    title: snapshot.report.title || `${snapshot.report.weekStart} 주간업무`,
    href: weeklyHref(projectId, snapshot.report.weekStart),
    updatedAt: snapshot.report.updatedAt,
  }
}

export function createCompareWeeklySheetsTool(
  repository: WeeklyRepository,
): ReadOnlyBotTool<WeeklySheetComparisonRecord> {
  return {
    name: 'compare_weekly_sheets',
    requiredCapability: WEEKLY_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const fromWeekStart = isIsoDate(args.fromWeekStart) ? args.fromWeekStart : null
      const toWeekStart = isIsoDate(args.toWeekStart) ? args.toWeekStart : null
      const section = readOptionalString(args.section, 100)
      const team = readOptionalString(args.team, 30)
      const query = readOptionalString(args.query)
      const limit = readLimit(args.limit)
      if (
        !projectId || !fromWeekStart || !toWeekStart || section === null || team === null
        || query === null || limit === null
      ) return invalidArgument()
      const teamError = validateTeam(team || undefined)
      if (teamError) return teamError
      if (!monday(fromWeekStart) || !monday(toWeekStart) || fromWeekStart >= toWeekStart) {
        return invalidArgument('비교할 두 주차는 서로 다른 월요일이며 과거 주차부터 입력해야 합니다.')
      }
      const denied = checkProjectAccess(context, projectId, WEEKLY_CAPABILITY)
      if (denied) return denied

      const [fromResult, toResult] = await Promise.all([
        repository.getSheet(projectId, fromWeekStart),
        repository.getSheet(projectId, toWeekStart),
      ])
      if (!fromResult.ok) return repositoryFailure(fromResult)
      if (!toResult.ok) return repositoryFailure(toResult)
      if (
        (fromResult.data && !isScopedWeeklySnapshot(fromResult.data, projectId, fromWeekStart))
        || (toResult.data && !isScopedWeeklySnapshot(toResult.data, projectId, toWeekStart))
      ) return repositoryScopeViolation()

      const fromRows = aggregateRows(fromResult.data?.rows ?? [])
      const toRows = aggregateRows(toResult.data?.rows ?? [])
      const needle = query?.toLocaleLowerCase('ko-KR')
      const keys = [...new Set([...fromRows.keys(), ...toRows.keys()])]
      const compared = keys.flatMap(key => {
        const from = fromRows.get(key)
        const to = toRows.get(key)
        const representative = to ?? from
        if (!representative) return []
        if (!matchesWeeklyScope(representative.section, section, team)) return []
        if (needle) {
          const haystack = [
            representative.section, representative.module,
            from?.thisContent, from?.thisIssue, from?.nextContent, from?.nextIssue,
            to?.thisContent, to?.thisIssue, to?.nextContent, to?.nextIssue,
          ].filter((value): value is string => typeof value === 'string')
          if (!haystack.some(value => value.toLocaleLowerCase('ko-KR').includes(needle))) return []
        }
        return [{ key, from, to, representative, change: comparisonChange(from, to) }]
      }).sort((a, b) =>
        a.representative.sortOrder - b.representative.sortOrder
        || a.representative.section.localeCompare(b.representative.section, 'ko-KR')
        || a.representative.module.localeCompare(b.representative.module, 'ko-KR'),
      )
      const selected = compared.slice(0, limit)
      const records: WeeklySheetComparisonRecord[] = selected.map(value => ({
        projectId,
        section: value.representative.section,
        module: value.representative.module,
        fromWeekStart,
        toWeekStart,
        change: value.change,
        from: value.from ? comparable(value.from) : null,
        to: value.to ? comparable(value.to) : null,
      }))

      const reportSources = [fromResult.data, toResult.data]
        .filter((value): value is WeeklySheetSnapshot => value !== null)
        .map(snapshot => comparisonReportSource(snapshot, projectId))
      const rowSources: BotSource[] = selected.flatMap(value => [
        ...(value.from?.sourceRows ?? []).map(row => ({
          id: `weekly-row:${row.id}`,
          domain: 'weekly' as const,
          entityType: 'weekly_row' as const,
          entityId: row.id,
          projectId,
          title: [row.section, row.module].filter(Boolean).join(' · ') || '주간업무 행',
          href: weeklyHref(projectId, fromWeekStart),
          updatedAt: row.updatedAt,
          excerpt: shortExcerpt(row.thisContent, row.thisIssue, row.nextContent, row.nextIssue),
        })),
        ...(value.to?.sourceRows ?? []).map(row => ({
          id: `weekly-row:${row.id}`,
          domain: 'weekly' as const,
          entityType: 'weekly_row' as const,
          entityId: row.id,
          projectId,
          title: [row.section, row.module].filter(Boolean).join(' · ') || '주간업무 행',
          href: weeklyHref(projectId, toWeekStart),
          updatedAt: row.updatedAt,
          excerpt: shortExcerpt(row.thisContent, row.thisIssue, row.nextContent, row.nextIssue),
        })),
      ])
      const truncated = compared.length > selected.length
      const count = (change: WeeklySheetComparisonRecord['change']) =>
        compared.filter(record => record.change === change).length
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            fromWeekStart,
            toWeekStart,
            fromReportFound: fromResult.data !== null,
            toReportFound: toResult.data !== null,
            totalCompared: compared.length,
            returned: records.length,
            added: count('added'),
            removed: count('removed'),
            changed: count('changed'),
            unchanged: count('unchanged'),
          },
          records,
          sources: [...reportSources, ...rowSources],
          asOf: context.now,
          truncated,
          warnings: truncated
            ? [`비교 결과 ${compared.length}행 중 ${records.length}행만 반환했습니다.`]
            : [],
        },
      }
    },
  }
}
