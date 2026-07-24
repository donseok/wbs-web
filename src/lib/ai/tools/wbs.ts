import { wbsItemHref } from '@/lib/ai/chat/deep-links'
import { computeDependencySchedule } from '@/lib/domain/dependencySchedule'
import { computeTree } from '@/lib/domain/rollup'
import type { ComputedItem, Status, TeamCode } from '@/lib/domain/types'
import type {
  WbsChangeField,
  WbsRepository,
  WbsRepositoryItem,
  WbsProjectSnapshot,
  WbsSupplementalRepository,
} from '@/lib/repositories/types'
import {
  checkProjectAccess,
  invalidArgument,
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
import type { BotSource, ReadOnlyBotTool, ToolExecutionContext, ToolExecutionResult } from './types'
import { activeTeamCodesSync, isRegisteredTeamCode } from '@/lib/teams/master'

const WBS_CAPABILITY = 'wbs:read' as const

export interface WbsToolItemRecord {
  id: string
  projectId: string
  parentId: string | null
  level: ComputedItem['level']
  code: string
  name: string
  path: string
  biz: string | null
  deliverable: string | null
  plannedStart: string | null
  plannedEnd: string | null
  plannedPct: number
  actualPct: number
  achievement: number | null
  status: Status
  owners: ComputedItem['owners']
  childIds: string[]
  updatedAt: string | null
}

export interface WbsDependencyRecord {
  id: string
  projectId: string
  type: 'FS' | 'SS'
  lagDays: number
  predecessorId: string
  predecessorName: string
  successorId: string
  successorName: string
  predecessorForecastEnd: string | null
  successorForecastStart: string | null
  successorForecastEnd: string | null
  successorDelayDays: number | null
  critical: boolean
}

export interface WbsChangeLogToolRecord {
  id: number
  projectId: string
  itemId: string
  itemCode: string
  itemName: string
  field: WbsChangeField
  oldValue: string | null
  newValue: string | null
  changedAt: string
  actorLabel: string | null
  actorTeam: TeamCode | null
  actorRole: string | null
}

export interface WbsAttachmentToolRecord {
  id: string
  projectId: string
  itemId: string
  itemCode: string
  itemName: string
  fileName: string
  size: number | null
  mime: string | null
  createdAt: string
}

interface FlatItem {
  item: ComputedItem
  path: string
}

function isScopedWbsSnapshot(snapshot: WbsProjectSnapshot, projectId: string): boolean {
  return snapshot.projectId === projectId
    && snapshot.items.every(item => item.projectId === projectId)
    && snapshot.dependencies.every(dependency => dependency.projectId === projectId)
}

function flatten(items: ComputedItem[]): FlatItem[] {
  const out: FlatItem[] = []
  const visit = (nodes: ComputedItem[], parentPath: string) => {
    for (const item of nodes) {
      const label = item.code ? `${item.code} ${item.name}` : item.name
      const path = parentPath ? `${parentPath} > ${label}` : label
      out.push({ item, path })
      visit(item.children, path)
    }
  }
  visit(items, '')
  return out
}

function computedSnapshot(
  rows: WbsRepositoryItem[],
  baseDate: string | null,
  holidays: string[],
  context: ToolExecutionContext,
): { flat: FlatItem[]; updatedAtById: Map<string, string | null>; today: string } {
  const today = baseDate ?? todayInSeoul(context.now)
  const computed = computeTree(rows, today, new Set(holidays))
  return {
    flat: flatten(computed),
    updatedAtById: new Map(rows.map(row => [row.id, row.updatedAt])),
    today,
  }
}

function toRecord(flat: FlatItem, updatedAt: string | null): WbsToolItemRecord {
  const { item, path } = flat
  return {
    id: item.id,
    projectId: (item as ComputedItem & { projectId?: string }).projectId ?? '',
    parentId: item.parentId,
    level: item.level,
    code: item.code,
    name: item.name,
    path,
    biz: item.biz,
    deliverable: item.deliverable,
    plannedStart: item.plannedStart,
    plannedEnd: item.plannedEnd,
    plannedPct: item.plannedPct,
    actualPct: item.rolledActualPct,
    achievement: item.achievement,
    status: item.status,
    owners: item.owners,
    childIds: item.children.map(child => child.id),
    updatedAt,
  }
}

function itemSource(projectId: string, record: WbsToolItemRecord): BotSource {
  return {
    id: `wbs:${record.id}`,
    domain: 'wbs',
    entityType: 'wbs_item',
    entityId: record.id,
    projectId,
    title: record.code ? `${record.code} ${record.name}` : record.name,
    href: wbsItemHref(projectId, record.id),
    updatedAt: record.updatedAt,
    excerpt: shortExcerpt(record.path, record.biz, record.deliverable),
  }
}

function loadArgs(args: unknown): { projectId: string; raw: Record<string, unknown> } | null {
  if (!isRecord(args)) return null
  const projectId = readRequiredString(args.projectId)
  return projectId ? { projectId, raw: args } : null
}

export function createFindWbsItemsTool(repository: WbsRepository): ReadOnlyBotTool<WbsToolItemRecord> {
  return {
    name: 'find_wbs_items',
    requiredCapability: WBS_CAPABILITY,
    async execute(args, context) {
      const parsed = loadArgs(args)
      if (!parsed) return invalidArgument()
      const query = readOptionalString(parsed.raw.query)
      const team = readOptionalString(parsed.raw.team, 30)
      const limit = readLimit(parsed.raw.limit)
      const status = readOptionalString(parsed.raw.status, 30)
      const from = readOptionalString(parsed.raw.from, 10)
      const to = readOptionalString(parsed.raw.to, 10)
      const dateMode = readOptionalString(parsed.raw.dateMode, 20)
      if (
        query === null || team === null || limit === null || status === null
        || from === null || to === null || dateMode === null
      ) return invalidArgument()
      if (status && !(['not_started', 'in_progress', 'delayed', 'done'] as string[]).includes(status)) {
        return invalidArgument('알 수 없는 WBS 상태입니다.')
      }
      if (team && !activeTeamCodesSync().includes(team)) {
        return invalidArgument('알 수 없는 담당팀입니다.')
      }
      if ((from === undefined) !== (to === undefined)) {
        return invalidArgument('WBS 일정 조회에는 시작일과 종료일이 모두 필요합니다.')
      }
      if (from && to && !validDateRange(from, to)) {
        return invalidArgument('WBS 일정 범위가 올바르지 않습니다.')
      }
      if (dateMode && !(['overlap', 'starts', 'ends'] as string[]).includes(dateMode)) {
        return invalidArgument('알 수 없는 WBS 일정 조회 방식입니다.')
      }
      if (dateMode && (!from || !to)) {
        return invalidArgument('WBS 일정 조회 방식에는 시작일과 종료일이 필요합니다.')
      }
      const denied = checkProjectAccess(context, parsed.projectId, WBS_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.getProjectSnapshot(parsed.projectId)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!repoResult.data) {
        return {
          ok: true,
          result: {
            status: 'ok', facts: { projectFound: false, totalMatched: 0, returned: 0 },
            records: [], sources: [], asOf: context.now, truncated: false, warnings: [],
          },
        }
      }
      if (!isScopedWbsSnapshot(repoResult.data, parsed.projectId)) return repositoryScopeViolation()

      const snapshot = computedSnapshot(
        repoResult.data.items,
        repoResult.data.baseDate,
        repoResult.data.holidays,
        context,
      )
      const needle = query?.toLocaleLowerCase('ko-KR')
      const matches = snapshot.flat.filter(({ item, path }) => {
        if (status && item.status !== status) return false
        if (team && !item.owners.some(owner => owner.team === team as TeamCode)) return false
        if (from && to) {
          const mode = dateMode ?? 'overlap'
          if (mode === 'starts' && (!item.plannedStart || item.plannedStart < from || item.plannedStart > to)) return false
          if (mode === 'ends' && (!item.plannedEnd || item.plannedEnd < from || item.plannedEnd > to)) return false
          if (
            mode === 'overlap'
            && (!item.plannedStart || !item.plannedEnd || item.plannedStart > to || item.plannedEnd < from)
          ) return false
        }
        if (!needle) return true
        return [item.code, item.name, item.biz, item.deliverable, path]
          .filter(Boolean)
          .some(value => String(value).toLocaleLowerCase('ko-KR').includes(needle))
      })
      const selected = matches.slice(0, limit)
      const records = selected.map(flat => {
        const record = toRecord(flat, snapshot.updatedAtById.get(flat.item.id) ?? null)
        record.projectId = parsed.projectId
        return record
      })
      const truncated = matches.length > records.length
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            projectFound: true,
            totalMatched: matches.length,
            returned: records.length,
            calculationDate: snapshot.today,
            ...(from && to ? { rangeFrom: from, rangeTo: to, dateMode: dateMode ?? 'overlap' } : {}),
          },
          records,
          sources: records.map(record => itemSource(parsed.projectId, record)),
          asOf: context.now,
          truncated,
          warnings: truncated ? [`검색 결과 ${matches.length}건 중 ${records.length}건만 반환했습니다.`] : [],
        },
      }
    },
  }
}

export function createGetWbsItemDetailTool(repository: WbsRepository): ReadOnlyBotTool<WbsToolItemRecord> {
  return {
    name: 'get_wbs_item_detail',
    requiredCapability: WBS_CAPABILITY,
    async execute(args, context) {
      const parsed = loadArgs(args)
      const itemId = parsed ? readRequiredString(parsed.raw.itemId) : null
      if (!parsed || !itemId) return invalidArgument()
      const denied = checkProjectAccess(context, parsed.projectId, WBS_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.getProjectSnapshot(parsed.projectId)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!repoResult.data) return emptyWbsDetail(context, false)
      if (!isScopedWbsSnapshot(repoResult.data, parsed.projectId)) return repositoryScopeViolation()
      const snapshot = computedSnapshot(
        repoResult.data.items, repoResult.data.baseDate, repoResult.data.holidays, context,
      )
      const flat = snapshot.flat.find(value => value.item.id === itemId)
      if (!flat) return emptyWbsDetail(context, true)
      const record = toRecord(flat, snapshot.updatedAtById.get(itemId) ?? null)
      record.projectId = parsed.projectId
      return {
        ok: true,
        result: {
          status: 'ok',
          facts: { projectFound: true, itemFound: true, calculationDate: snapshot.today },
          records: [record],
          sources: [itemSource(parsed.projectId, record)],
          asOf: context.now,
          truncated: false,
          warnings: [],
        },
      }
    },
  }
}

function emptyWbsDetail(
  context: ToolExecutionContext,
  projectFound: boolean,
): ToolExecutionResult<WbsToolItemRecord> {
  return {
    ok: true,
    result: {
      status: 'ok', facts: { projectFound, itemFound: false }, records: [], sources: [],
      asOf: context.now, truncated: false, warnings: [],
    },
  }
}

export function createGetWbsDependenciesTool(
  repository: WbsRepository,
): ReadOnlyBotTool<WbsDependencyRecord> {
  return {
    name: 'get_wbs_dependencies',
    requiredCapability: WBS_CAPABILITY,
    async execute(args, context) {
      const parsed = loadArgs(args)
      const itemId = parsed ? readOptionalString(parsed.raw.itemId) : null
      if (!parsed || itemId === null) return invalidArgument()
      const denied = checkProjectAccess(context, parsed.projectId, WBS_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.getProjectSnapshot(parsed.projectId)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!repoResult.data) return emptyDependencies(context, false, false)
      if (!isScopedWbsSnapshot(repoResult.data, parsed.projectId)) return repositoryScopeViolation()
      const snapshot = computedSnapshot(
        repoResult.data.items, repoResult.data.baseDate, repoResult.data.holidays, context,
      )
      const byId = new Map(snapshot.flat.map(value => [value.item.id, value]))
      if (itemId && !byId.has(itemId)) return emptyDependencies(context, true, false)

      const schedule = computeDependencySchedule(
        snapshot.flat.map(({ item }) => ({
          id: item.id,
          plannedStart: item.plannedStart,
          plannedEnd: item.plannedEnd,
          actualPct: item.rolledActualPct,
        })),
        repoResult.data.dependencies,
        snapshot.today,
        repoResult.data.holidays,
      )
      const relevant = itemId
        ? repoResult.data.dependencies.filter(dep => dep.predecessorId === itemId || dep.successorId === itemId)
        : repoResult.data.dependencies
      const selected = relevant.slice(0, 50)
      const records: WbsDependencyRecord[] = selected.map(dep => {
        const predecessor = byId.get(dep.predecessorId)?.item
        const successor = byId.get(dep.successorId)?.item
        const predecessorSchedule = schedule.byId.get(dep.predecessorId)
        const successorSchedule = schedule.byId.get(dep.successorId)
        return {
          id: dep.id,
          projectId: parsed.projectId,
          type: dep.type,
          lagDays: dep.lagDays,
          predecessorId: dep.predecessorId,
          predecessorName: predecessor?.name ?? '',
          successorId: dep.successorId,
          successorName: successor?.name ?? '',
          predecessorForecastEnd: predecessorSchedule?.forecastEnd ?? null,
          successorForecastStart: successorSchedule?.forecastStart ?? null,
          successorForecastEnd: successorSchedule?.forecastEnd ?? null,
          successorDelayDays: successorSchedule?.delayDays ?? null,
          critical: schedule.criticalDependencyIds.has(dep.id),
        }
      })
      const sourceIds = new Set(selected.flatMap(dep => [dep.predecessorId, dep.successorId]))
      const sources = [...sourceIds].flatMap(id => {
        const flat = byId.get(id)
        if (!flat) return []
        const record = toRecord(flat, snapshot.updatedAtById.get(id) ?? null)
        record.projectId = parsed.projectId
        return [itemSource(parsed.projectId, record)]
      })
      const warnings: string[] = []
      if (schedule.cycleTaskIds.size) warnings.push('순환 의존성이 있어 일부 예상 일정을 계산하지 못했습니다.')
      if (schedule.invalidDependencyIds.size) warnings.push('유효하지 않은 의존성은 일정 계산에서 제외했습니다.')
      if (relevant.length > selected.length) warnings.push(`의존성 ${relevant.length}건 중 50건만 반환했습니다.`)
      const truncated = relevant.length > selected.length
      return {
        ok: true,
        result: {
          status: warnings.length || truncated ? 'partial' : 'ok',
          facts: {
            projectFound: true,
            itemFound: itemId ? true : null,
            dependencyCount: relevant.length,
            projectForecastEnd: schedule.projectForecastEnd,
            projectDelayDays: schedule.projectDelayDays,
            calculationDate: snapshot.today,
          },
          records,
          sources,
          asOf: context.now,
          truncated,
          warnings,
        },
      }
    },
  }
}

function emptyDependencies(
  context: ToolExecutionContext,
  projectFound: boolean,
  itemFound: boolean,
): ToolExecutionResult<WbsDependencyRecord> {
  return {
    ok: true,
    result: {
      status: 'ok', facts: { projectFound, itemFound, dependencyCount: 0 }, records: [], sources: [],
      asOf: context.now, truncated: false, warnings: [],
    },
  }
}

function scopedWbsSource(
  projectId: string,
  itemId: string,
  itemCode: string,
  itemName: string,
  updatedAt: string | null,
  excerpt?: string,
): BotSource {
  return {
    id: `wbs:${itemId}`,
    domain: 'wbs',
    entityType: 'wbs_item',
    entityId: itemId,
    projectId,
    title: itemCode ? `${itemCode} ${itemName}` : itemName,
    href: wbsItemHref(projectId, itemId),
    updatedAt,
    ...(excerpt ? { excerpt } : {}),
  }
}

export function createGetWbsChangeLogTool(
  repository: WbsSupplementalRepository,
): ReadOnlyBotTool<WbsChangeLogToolRecord> {
  return {
    name: 'get_wbs_change_log',
    requiredCapability: WBS_CAPABILITY,
    async execute(args, context) {
      const parsed = loadArgs(args)
      const itemId = parsed ? readRequiredString(parsed.raw.itemId) : null
      const limit = parsed ? readLimit(parsed.raw.limit) : null
      if (!parsed || !itemId || limit === null) return invalidArgument()
      const denied = checkProjectAccess(context, parsed.projectId, WBS_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.getChangeLog(parsed.projectId, itemId, limit)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!repoResult.data) {
        return {
          ok: true,
          result: {
            status: 'ok', facts: { itemFound: false, returned: 0 }, records: [], sources: [],
            asOf: context.now, truncated: false, warnings: [],
          },
        }
      }

      const snapshot = repoResult.data
      if (
        snapshot.itemId !== itemId
        || snapshot.entries.some(entry => entry.wbsItemId !== itemId)
      ) return repositoryScopeViolation()
      const records: WbsChangeLogToolRecord[] = snapshot.entries.map(entry => ({
        ...entry,
        projectId: parsed.projectId,
        itemId: snapshot.itemId,
        itemCode: snapshot.itemCode,
        itemName: snapshot.itemName,
      }))
      const warnings = snapshot.truncated
        ? [`최근 변경 이력 ${limit}건만 반환했습니다.`]
        : []
      return {
        ok: true,
        result: {
          status: snapshot.truncated ? 'partial' : 'ok',
          facts: {
            itemFound: true,
            returned: records.length,
            latestChangeAt: records[0]?.changedAt ?? null,
          },
          records,
          sources: [scopedWbsSource(
            parsed.projectId,
            snapshot.itemId,
            snapshot.itemCode,
            snapshot.itemName,
            snapshot.itemUpdatedAt,
            shortExcerpt(...records.slice(0, 3).map(record =>
              `${record.field}: ${record.oldValue ?? '없음'} → ${record.newValue ?? '없음'}`,
            )),
          )],
          asOf: context.now,
          truncated: snapshot.truncated,
          warnings,
        },
      }
    },
  }
}

export function createListWbsAttachmentsTool(
  repository: WbsSupplementalRepository,
): ReadOnlyBotTool<WbsAttachmentToolRecord> {
  return {
    name: 'list_wbs_attachments',
    requiredCapability: WBS_CAPABILITY,
    async execute(args, context) {
      const parsed = loadArgs(args)
      const itemId = parsed ? readRequiredString(parsed.raw.itemId) : null
      const limit = parsed ? readLimit(parsed.raw.limit) : null
      if (!parsed || !itemId || limit === null) return invalidArgument()
      const denied = checkProjectAccess(context, parsed.projectId, WBS_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.listAttachmentMetadata(parsed.projectId, itemId, limit)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!repoResult.data) {
        return {
          ok: true,
          result: {
            status: 'ok', facts: { itemFound: false, returned: 0 }, records: [], sources: [],
            asOf: context.now, truncated: false, warnings: [],
          },
        }
      }

      const snapshot = repoResult.data
      if (
        snapshot.itemId !== itemId
        || snapshot.attachments.some(attachment => attachment.wbsItemId !== itemId)
      ) return repositoryScopeViolation()
      const records: WbsAttachmentToolRecord[] = snapshot.attachments.map(attachment => ({
        id: attachment.id,
        projectId: parsed.projectId,
        itemId: snapshot.itemId,
        itemCode: snapshot.itemCode,
        itemName: snapshot.itemName,
        fileName: attachment.fileName,
        size: attachment.size,
        mime: attachment.mime,
        createdAt: attachment.createdAt,
      }))
      const href = wbsItemHref(parsed.projectId, snapshot.itemId)
      const warnings = snapshot.truncated
        ? [`첨부파일 메타데이터 ${limit}건만 반환했습니다.`]
        : []
      return {
        ok: true,
        result: {
          status: snapshot.truncated ? 'partial' : 'ok',
          facts: { itemFound: true, returned: records.length },
          records,
          sources: records.map(record => ({
            id: `attachment:${record.id}`,
            domain: 'wbs',
            entityType: 'attachment',
            entityId: record.id,
            projectId: parsed.projectId,
            title: record.fileName,
            href,
            // deliverable_attachments has no updated_at. createdAt must not be
            // represented as a source update time.
            updatedAt: null,
            excerpt: shortExcerpt(
              record.mime,
              record.size === null ? undefined : `${record.size} bytes`,
              `등록 ${record.createdAt}`,
            ),
          })),
          asOf: context.now,
          truncated: snapshot.truncated,
          warnings,
        },
      }
    },
  }
}
