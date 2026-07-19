import { kanbanHref, wbsItemHref } from '@/lib/ai/chat/deep-links'
import { groupByOwner, groupByPhase, groupByStatus, type KanbanColumn } from '@/lib/domain/kanban'
import { computeTree } from '@/lib/domain/rollup'
import type { ComputedItem, Status, TeamCode } from '@/lib/domain/types'
import type { WbsBotRepository, WbsProjectSnapshot } from '@/lib/repositories/types'
import {
  checkProjectAccess,
  invalidArgument,
  isRecord,
  readOptionalString,
  readRequiredString,
  repositoryFailure,
  repositoryScopeViolation,
  todayInSeoul,
} from './common'
import type { BotSource, ReadOnlyBotTool } from './types'

const KANBAN_CAPABILITY = 'kanban:read' as const

const DEFAULT_CARD_LIMIT = 5
const MAX_CARD_LIMIT = 10

const KANBAN_VIEWS = ['phase', 'owner', 'status'] as const
type KanbanView = (typeof KANBAN_VIEWS)[number]

const CARD_STATUSES: readonly Status[] = ['not_started', 'in_progress', 'delayed', 'done']
const CARD_TEAMS: readonly TeamCode[] = ['PMO', 'ERP', 'MES', '가공']

export interface KanbanCardRecord {
  id: string
  code: string
  name: string
  status: Status
  team: TeamCode | null
  plannedEnd: string | null
  actualPct: number
}

export interface KanbanColumnRecord {
  columnKey: string
  columnTitle: string
  count: number
  cards: KanbanCardRecord[]
}

function isScopedWbsSnapshot(snapshot: WbsProjectSnapshot, projectId: string): boolean {
  return snapshot.projectId === projectId
    && snapshot.items.every(item => item.projectId === projectId)
    && snapshot.dependencies.every(dependency => dependency.projectId === projectId)
}

/** 카드 상한은 컬럼당 최대 10건 — 목록 상한(readLimit)과 별도 규약이다. */
function readCardLimit(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_CARD_LIMIT
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null
  return Math.min(value, MAX_CARD_LIMIT)
}

function cardPasses(card: ComputedItem, team: TeamCode | undefined, status: Status | undefined): boolean {
  if (status && card.status !== status) return false
  if (team && !card.owners.some(owner => owner.kind === 'primary' && owner.team === team)) return false
  return true
}

function toCardRecord(card: ComputedItem): KanbanCardRecord {
  const primary = card.owners.find(owner => owner.kind === 'primary')
  return {
    id: card.id,
    code: card.code,
    name: card.name,
    status: card.status,
    team: primary?.team ?? null,
    plannedEnd: card.plannedEnd,
    actualPct: card.rolledActualPct,
  }
}

function groupColumns(view: KanbanView, computed: ComputedItem[]): KanbanColumn[] {
  if (view === 'phase') return groupByPhase(computed)
  if (view === 'owner') return groupByOwner(computed)
  return groupByStatus(computed)
}

export function createGetKanbanViewTool(repository: WbsBotRepository): ReadOnlyBotTool<KanbanColumnRecord> {
  return {
    name: 'get_kanban_view',
    requiredCapability: KANBAN_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      if (!projectId) return invalidArgument()
      const view = readOptionalString(args.view, 20)
      const team = readOptionalString(args.team, 30)
      const status = readOptionalString(args.status, 30)
      const cardLimit = readCardLimit(args.cardLimit)
      if (view === null || team === null || status === null || cardLimit === null) return invalidArgument()
      if (view && !(KANBAN_VIEWS as readonly string[]).includes(view)) {
        return invalidArgument('알 수 없는 칸반 보기입니다.')
      }
      if (team && !(CARD_TEAMS as readonly string[]).includes(team)) {
        return invalidArgument('알 수 없는 담당팀입니다.')
      }
      if (status && !(CARD_STATUSES as readonly string[]).includes(status)) {
        return invalidArgument('알 수 없는 카드 상태입니다.')
      }
      const denied = checkProjectAccess(context, projectId, KANBAN_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.getProjectSnapshot(projectId)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!repoResult.data) {
        return {
          ok: true,
          result: {
            status: 'ok', facts: { projectFound: false, totalCards: 0, returned: 0 },
            records: [], sources: [], asOf: context.now, truncated: false, warnings: [],
          },
        }
      }
      if (!isScopedWbsSnapshot(repoResult.data, projectId)) return repositoryScopeViolation()

      const today = repoResult.data.baseDate ?? todayInSeoul(context.now)
      const computed = computeTree(repoResult.data.items, today, new Set(repoResult.data.holidays))
      const effectiveView = (view ?? 'status') as KanbanView
      const columns = groupColumns(effectiveView, computed)
      const teamFilter = team as TeamCode | undefined
      const statusFilter = status as Status | undefined

      // 담당자별 보기에선 primary 팀이 여럿인 카드가 여러 컬럼에 실리므로 전체 수는 id로 중복 제거한다.
      const uniqueFiltered = new Map<string, ComputedItem>()
      let returnedCount = 0
      let truncated = false
      const records: KanbanColumnRecord[] = columns.map(column => {
        const filtered = column.cards.filter(card => cardPasses(card, teamFilter, statusFilter))
        for (const card of filtered) uniqueFiltered.set(card.id, card)
        const selected = filtered.slice(0, cardLimit)
        if (filtered.length > selected.length) truncated = true
        returnedCount += selected.length
        return {
          columnKey: column.key,
          columnTitle: column.title,
          count: filtered.length,
          cards: selected.map(toCardRecord),
        }
      })

      const distribution: Record<Status, number> = { not_started: 0, in_progress: 0, delayed: 0, done: 0 }
      for (const card of uniqueFiltered.values()) distribution[card.status] += 1

      const updatedAtById = new Map(repoResult.data.items.map(item => [item.id, item.updatedAt]))
      const seenCardIds = new Set<string>()
      const cardSources: BotSource[] = []
      for (const record of records) {
        for (const card of record.cards) {
          if (seenCardIds.has(card.id)) continue
          seenCardIds.add(card.id)
          cardSources.push({
            id: `wbs:${card.id}`,
            domain: 'wbs',
            entityType: 'wbs_item',
            entityId: card.id,
            projectId,
            title: card.code ? `${card.code} ${card.name}` : card.name,
            href: wbsItemHref(projectId, card.id),
            updatedAt: updatedAtById.get(card.id) ?? null,
          })
        }
      }
      const sources: BotSource[] = [
        {
          id: `kanban:${projectId}`,
          domain: 'kanban',
          entityType: 'project',
          entityId: projectId,
          projectId,
          title: '칸반 보드',
          // 화면 기본 모드(phase)와 다를 수 있어 항상 실제 사용한 보기를 복원한다.
          href: kanbanHref(projectId, { view: effectiveView, team }),
          updatedAt: null,
        },
        ...cardSources,
      ]

      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            projectFound: true,
            totalCards: uniqueFiltered.size,
            notStartedCount: distribution.not_started,
            inProgressCount: distribution.in_progress,
            delayedCount: distribution.delayed,
            doneCount: distribution.done,
            returned: returnedCount,
            calculationDate: today,
          },
          records,
          sources,
          asOf: context.now,
          truncated,
          warnings: truncated ? [`컬럼당 카드 ${cardLimit}건 상한을 넘어 일부 카드만 반환했습니다.`] : [],
        },
      }
    },
  }
}
