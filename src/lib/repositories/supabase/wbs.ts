import type { OwnerKind, TaskDependency, TeamCode, WbsRow } from '@/lib/domain/types'
import {
  repositoryError,
  repositoryOk,
  type RepositoryResult,
  type WbsAttachmentMetadataSnapshot,
  type WbsBotRepository,
  type WbsChangeField,
  type WbsChangeLogSnapshot,
  type WbsProjectSnapshot,
  type WbsRepositoryItem,
} from '@/lib/repositories/types'
import { isRetryableReadError, nestedOne, type SupabaseServerClient } from './common'
import { teamOrderMap } from '@/lib/domain/teams'
import { teamsSync } from '@/lib/teams/master'

type Row = Record<string, unknown>

const WBS_COLUMNS = [
  'id', 'project_id', 'parent_id', 'level', 'code', 'sort_order', 'name', 'biz', 'deliverable',
  'planned_start', 'planned_end', 'weight', 'actual_pct', 'updated_at',
  'item_owners(kind, teams(code))',
].join(', ')

const WBS_ITEM_SCOPE_COLUMNS = 'id, project_id, code, name, updated_at'
const ALLOWED_CHANGE_FIELDS: readonly WbsChangeField[] = [
  'actual_pct', 'weight', 'created', 'name', 'planned_start', 'planned_end',
  'deliverable', 'biz', 'dependency',
]

interface WbsItemScope {
  id: string
  code: string
  name: string
  updatedAt: string | null
}

function mapOwners(raw: unknown): WbsRow['owners'] {
  if (!Array.isArray(raw)) return []
  // 팀 코드는 teams FK 조인 결과라 등록 팀만 온다 — 하드코딩 화이트리스트 불필요(신규 팀 자동 수용).
  const allowedKinds = new Set<OwnerKind>(['primary', 'support'])
  const owners: WbsRow['owners'] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const row = value as Row
    const team = nestedOne(row.teams as { code?: unknown } | { code?: unknown }[] | null)
    const code = team?.code
    const kind = row.kind
    if (typeof code === 'string' && code !== '' && allowedKinds.has(kind as OwnerKind)) {
      owners.push({ team: code, kind: kind as OwnerKind })
    }
  }
  // 표시 순서는 팀 마스터 sort_order(비활성 포함 — 기존 데이터 정렬 안정). 미등록은 뒤로.
  const order = teamOrderMap(teamsSync().map(t => t.code))
  const rank = (t: TeamCode) => order.get(t) ?? Number.MAX_SAFE_INTEGER
  return owners.sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'primary' ? -1 : 1) || rank(a.team) - rank(b.team),
  )
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function safeAuditValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.length > 2_000 ? `${value.slice(0, 1_997)}…` : value
}

function teamCode(value: unknown): TeamCode | null {
  // 감사 로그 표시용 통과 파서 — 팀 목록 검증은 쓰기 경로(팀 마스터 대조)에서 이미 끝났다.
  return typeof value === 'string' && value !== '' ? value : null
}

function actorRole(value: unknown): string | null {
  return value === 'pmo_admin' || value === 'team_editor' ? value : null
}

function actorLabel(team: TeamCode | null, role: string | null): string | null {
  if (role === 'pmo_admin') return team ? `${team} 관리자` : 'PMO 관리자'
  if (role === 'team_editor') return team ? `${team} 팀 편집자` : '팀 편집자'
  return team
}

async function readItemScope(
  client: SupabaseServerClient,
  projectId: string,
  itemId: string,
): Promise<RepositoryResult<WbsItemScope | null>> {
  const result = await client
    .from('wbs_items')
    .select(WBS_ITEM_SCOPE_COLUMNS)
    .eq('project_id', projectId)
    .eq('id', itemId)
    .maybeSingle()
  if (result.error) {
    return repositoryError('WBS_ITEM_SCOPE_READ_FAILED', isRetryableReadError(result.error))
  }
  if (!result.data) return repositoryOk(null)
  const row = result.data as unknown as Row
  if (row.id !== itemId || row.project_id !== projectId) {
    return repositoryError('WBS_ITEM_SCOPE_READ_FAILED', false)
  }
  return repositoryOk({
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    updatedAt: (row.updated_at as string | null) ?? null,
  })
}

function mapItem(row: Row): WbsRepositoryItem {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    parentId: (row.parent_id as string | null) ?? null,
    level: row.level as WbsRow['level'],
    code: row.code as string,
    sortOrder: Number(row.sort_order) || 0,
    name: row.name as string,
    biz: (row.biz as string | null) ?? null,
    deliverable: (row.deliverable as string | null) ?? null,
    plannedStart: (row.planned_start as string | null) ?? null,
    plannedEnd: (row.planned_end as string | null) ?? null,
    weight: nullableNumber(row.weight),
    actualPct: nullableNumber(row.actual_pct),
    owners: mapOwners(row.item_owners),
    updatedAt: (row.updated_at as string | null) ?? null,
  }
}

function mapDependency(row: Row): TaskDependency {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    predecessorId: row.predecessor_id as string,
    successorId: row.successor_id as string,
    type: row.dependency_type as TaskDependency['type'],
    lagDays: Number(row.lag_days) || 0,
  }
}

/** Request-scoped Supabase adapter. All statements in this adapter are SELECTs. */
export function createSupabaseWbsRepository(client: SupabaseServerClient): WbsBotRepository {
  return {
    async getProjectSnapshot(projectId): Promise<RepositoryResult<WbsProjectSnapshot | null>> {
      const [projectResult, itemsResult, holidaysResult, dependenciesResult] = await Promise.all([
        client.from('projects').select('id, base_date').eq('id', projectId).maybeSingle(),
        client.from('wbs_items').select(WBS_COLUMNS).eq('project_id', projectId).order('sort_order'),
        client.from('holidays').select('date').eq('project_id', projectId).order('date'),
        client.from('task_dependencies')
          .select('id, project_id, predecessor_id, successor_id, dependency_type, lag_days')
          .eq('project_id', projectId),
      ])

      if (projectResult.error) {
        return repositoryError('WBS_PROJECT_READ_FAILED', isRetryableReadError(projectResult.error))
      }
      if (itemsResult.error) {
        return repositoryError('WBS_ITEMS_READ_FAILED', isRetryableReadError(itemsResult.error))
      }
      if (holidaysResult.error) {
        return repositoryError('WBS_HOLIDAYS_READ_FAILED', isRetryableReadError(holidaysResult.error))
      }
      if (dependenciesResult.error) {
        return repositoryError('WBS_DEPENDENCIES_READ_FAILED', isRetryableReadError(dependenciesResult.error))
      }
      if (!projectResult.data) return repositoryOk(null)

      const project = projectResult.data as Row
      const snapshot: WbsProjectSnapshot = {
        projectId,
        baseDate: (project.base_date as string | null) ?? null,
        items: ((itemsResult.data ?? []) as unknown as Row[]).map(mapItem),
        holidays: ((holidaysResult.data ?? []) as Row[]).map(row => row.date as string),
        dependencies: ((dependenciesResult.data ?? []) as Row[]).map(mapDependency),
      }
      return repositoryOk(snapshot)
    },

    async getChangeLog(projectId, itemId, limit) {
      const itemResult = await readItemScope(client, projectId, itemId)
      if (!itemResult.ok) return itemResult
      if (!itemResult.data) return repositoryOk(null)
      const item = itemResult.data

      const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 50))
      const logsResult = await client
        .from('change_logs')
        .select('id, wbs_item_id, field, old_value, new_value, at, user_id')
        .eq('wbs_item_id', itemId)
        .in('field', [...ALLOWED_CHANGE_FIELDS])
        .order('at', { ascending: false })
        .limit(safeLimit + 1)
      if (logsResult.error) {
        return repositoryError('WBS_CHANGE_LOG_READ_FAILED', isRetryableReadError(logsResult.error))
      }

      const rows = (logsResult.data ?? []) as unknown as Row[]
      if (rows.some(row => row.wbs_item_id !== itemId || !ALLOWED_CHANGE_FIELDS.includes(row.field as WbsChangeField))) {
        return repositoryError('WBS_CHANGE_LOG_READ_FAILED', false)
      }
      const selected = rows.slice(0, safeLimit)
      const userIds = [...new Set(selected.flatMap(row =>
        typeof row.user_id === 'string' ? [row.user_id] : [],
      ))]
      const actors = new Map<string, { team: TeamCode | null; role: string | null }>()
      if (userIds.length) {
        const actorsResult = await client
          .from('memberships')
          .select('user_id, role, teams(code)')
          .in('user_id', userIds)
        if (actorsResult.error) {
          return repositoryError(
            'WBS_CHANGE_LOG_ACTORS_READ_FAILED',
            isRetryableReadError(actorsResult.error),
          )
        }
        for (const raw of (actorsResult.data ?? []) as unknown as Row[]) {
          if (typeof raw.user_id !== 'string') continue
          const team = nestedOne(raw.teams as { code?: unknown } | { code?: unknown }[] | null)
          actors.set(raw.user_id, {
            team: teamCode(team?.code),
            role: actorRole(raw.role),
          })
        }
      }

      const snapshot: WbsChangeLogSnapshot = {
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        itemUpdatedAt: item.updatedAt,
        entries: selected.map(row => {
          const actor = typeof row.user_id === 'string' ? actors.get(row.user_id) : undefined
          const team = actor?.team ?? null
          const role = actor?.role ?? null
          return {
            id: Number(row.id),
            wbsItemId: item.id,
            field: row.field as WbsChangeField,
            oldValue: safeAuditValue(row.old_value),
            newValue: safeAuditValue(row.new_value),
            changedAt: row.at as string,
            actorLabel: actorLabel(team, role),
            actorTeam: team,
            actorRole: role,
          }
        }),
        truncated: rows.length > safeLimit,
      }
      return repositoryOk(snapshot)
    },

    async listAttachmentMetadata(projectId, itemId, limit) {
      const itemResult = await readItemScope(client, projectId, itemId)
      if (!itemResult.ok) return itemResult
      if (!itemResult.data) return repositoryOk(null)
      const item = itemResult.data

      const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 50))
      // Intentionally excludes file_path and uploaded_by. This is a table SELECT only;
      // no Storage client or signed-URL operation is reachable from this adapter.
      const attachmentsResult = await client
        .from('deliverable_attachments')
        .select('id, wbs_item_id, file_name, size, mime, created_at')
        .eq('wbs_item_id', itemId)
        .order('created_at', { ascending: false })
        .limit(safeLimit + 1)
      if (attachmentsResult.error) {
        return repositoryError('WBS_ATTACHMENTS_READ_FAILED', isRetryableReadError(attachmentsResult.error))
      }

      const rows = (attachmentsResult.data ?? []) as unknown as Row[]
      if (rows.some(row => row.wbs_item_id !== itemId)) {
        return repositoryError('WBS_ATTACHMENTS_READ_FAILED', false)
      }
      const snapshot: WbsAttachmentMetadataSnapshot = {
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        itemUpdatedAt: item.updatedAt,
        attachments: rows.slice(0, safeLimit).map(row => ({
          id: row.id as string,
          wbsItemId: item.id,
          fileName: row.file_name as string,
          size: nullableNumber(row.size),
          mime: (row.mime as string | null) ?? null,
          createdAt: row.created_at as string,
        })),
        truncated: rows.length > safeLimit,
      }
      return repositoryOk(snapshot)
    },
  }
}
