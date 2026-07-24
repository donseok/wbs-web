import { membersHref } from '@/lib/ai/chat/deep-links'
import { round1 } from '@/lib/domain/format'
import { computeTree } from '@/lib/domain/rollup'
import { collectLeaves } from '@/lib/domain/tree'
import type { ComputedItem, ProjectMemberRole, TeamCode } from '@/lib/domain/types'
import type {
  MemberRepository,
  MemberRepositoryRecord,
  WbsBotRepository,
} from '@/lib/repositories/types'
import {
  checkProjectAccess,
  internalProjectHref,
  invalidArgument,
  isRecord,
  readLimit,
  readOptionalString,
  readRequiredString,
  repositoryFailure,
  repositoryScopeViolation,
  todayInSeoul,
} from './common'
import type { BotSource, ReadOnlyBotTool, ToolExecutionContext, ToolExecutionResult } from './types'
import { activeTeamCodesSync, isRegisteredTeamCode } from '@/lib/teams/master'

const MEMBERS_CAPABILITY = 'members:read' as const
const MEMBER_ROLES: readonly ProjectMemberRole[] = ['admin', 'contributor']
// 설계 §9.1 — 개인 담당 관계를 추론하지 않는다는 사실을 응답에 항상 명시한다.
const TEAM_AGGREGATION_WARNING = '개인별 담당 데이터가 등록되지 않아 팀 단위로 집계했습니다.'

/** 표시 키 충돌 방지: 'title'은 문서 제목 라벨('제목')이 선점해 직함은 position으로 노출한다. */
export type MemberToolRecord = Omit<MemberRepositoryRecord, 'title'> & { position: string | null }

function toMemberToolRecord(record: MemberRepositoryRecord): MemberToolRecord {
  const { title, ...rest } = record
  return { ...rest, position: title }
}

export interface MemberWorkloadToolRecord {
  projectId: string
  teamCode: TeamCode | null
  memberNames: string[]
  taskCount: number
  doneCount: number
  delayedCount: number
  inProgressCount: number
  notStartedCount: number
  /** 팀 leaf 실적률 단순 평균(round1). 작업이 없으면 null — 0%로 조작하지 않는다. */
  avgActualPct: number | null
}

function readTeam(value: unknown): TeamCode | null | undefined {
  const team = readOptionalString(value, 30)
  if (team === undefined) return undefined
  if (team === null || !activeTeamCodesSync().includes(team)) return null
  return team as TeamCode
}

function membersMenuSource(projectId: string, team?: TeamCode): BotSource {
  return {
    id: `members:${projectId}`,
    domain: 'members',
    entityType: 'project',
    entityId: projectId,
    projectId,
    title: '멤버 관리',
    // 팀 필터 조회는 화면 초기 필터(?team=)까지 복원한다.
    href: membersHref(projectId, team),
    updatedAt: null,
  }
}

export function createListMembersTool(repository: MemberRepository): ReadOnlyBotTool<MemberToolRecord> {
  return {
    name: 'list_members',
    requiredCapability: MEMBERS_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const team = readTeam(args.team)
      const role = readOptionalString(args.role, 30)
      const limit = readLimit(args.limit)
      if (!projectId || role === null || limit === null) return invalidArgument()
      if (team === null) return invalidArgument('알 수 없는 담당팀입니다.')
      if (role && !(MEMBER_ROLES as readonly string[]).includes(role)) {
        return invalidArgument('알 수 없는 멤버 역할입니다.')
      }
      const denied = checkProjectAccess(context, projectId, MEMBERS_CAPABILITY)
      if (denied) return denied

      const repoResult = await repository.listMembers(projectId)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (repoResult.data.some(member => member.projectId !== projectId)) {
        return repositoryScopeViolation()
      }

      const matched = repoResult.data.filter(member => {
        if (team && member.teamCode !== team) return false
        if (role && member.role !== role) return false
        return true
      })
      const records = matched.slice(0, limit).map(toMemberToolRecord)
      const truncated = matched.length > records.length
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            memberCount: matched.length,
            returned: records.length,
          },
          records,
          sources: [membersMenuSource(projectId, team)],
          asOf: context.now,
          truncated,
          warnings: truncated ? [`멤버 ${matched.length}명 중 ${records.length}명만 반환했습니다.`] : [],
        },
      }
    },
  }
}

/** leaf의 집계 팀 — primary 담당팀만 인정한다(support만 있으면 미배정으로 취급). */
function primaryTeamOf(item: ComputedItem): TeamCode | null {
  return item.owners.find(owner => owner.kind === 'primary')?.team ?? null
}

function emptyWorkload(context: ToolExecutionContext): ToolExecutionResult<MemberWorkloadToolRecord> {
  return {
    ok: true,
    result: {
      status: 'ok',
      facts: { projectFound: false, memberCount: 0, totalLeafTasks: 0, returned: 0 },
      records: [],
      sources: [],
      asOf: context.now,
      truncated: false,
      warnings: [],
    },
  }
}

export function createGetMemberWorkloadTool(
  members: MemberRepository,
  wbs: WbsBotRepository,
): ReadOnlyBotTool<MemberWorkloadToolRecord> {
  return {
    name: 'get_member_workload',
    requiredCapability: MEMBERS_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const team = readTeam(args.team)
      if (!projectId) return invalidArgument()
      if (team === null) return invalidArgument('알 수 없는 담당팀입니다.')
      const denied = checkProjectAccess(context, projectId, MEMBERS_CAPABILITY)
      if (denied) return denied

      // 워크로드는 멤버 명단과 WBS 집계가 둘 다 있어야 의미가 있다 — 부분 성공을 조합하지 않는다.
      const [membersResult, wbsResult] = await Promise.all([
        members.listMembers(projectId),
        wbs.getProjectSnapshot(projectId),
      ])
      if (!membersResult.ok) return repositoryFailure(membersResult)
      if (!wbsResult.ok) return repositoryFailure(wbsResult)
      if (membersResult.data.some(member => member.projectId !== projectId)) {
        return repositoryScopeViolation()
      }
      if (!wbsResult.data) return emptyWorkload(context)
      if (
        wbsResult.data.projectId !== projectId
        || wbsResult.data.items.some(item => item.projectId !== projectId)
      ) return repositoryScopeViolation()

      const today = wbsResult.data.baseDate ?? todayInSeoul(context.now)
      const computed = computeTree(wbsResult.data.items, today, new Set(wbsResult.data.holidays))
      const leaves = collectLeaves(computed)

      const buckets = new Map<TeamCode | null, MemberWorkloadToolRecord & { actualSum: number }>()
      const bucketOf = (teamCode: TeamCode | null) => {
        const existing = buckets.get(teamCode)
        if (existing) return existing
        const created = {
          projectId,
          teamCode,
          memberNames: [] as string[],
          taskCount: 0,
          doneCount: 0,
          delayedCount: 0,
          inProgressCount: 0,
          notStartedCount: 0,
          avgActualPct: null as number | null,
          actualSum: 0,
        }
        buckets.set(teamCode, created)
        return created
      }
      for (const member of membersResult.data) {
        bucketOf(member.teamCode).memberNames.push(member.name)
      }
      for (const leaf of leaves) {
        const bucket = bucketOf(primaryTeamOf(leaf))
        bucket.taskCount += 1
        bucket.actualSum += leaf.rolledActualPct
        if (leaf.status === 'done') bucket.doneCount += 1
        else if (leaf.status === 'delayed') bucket.delayedCount += 1
        else if (leaf.status === 'in_progress') bucket.inProgressCount += 1
        else bucket.notStartedCount += 1
      }

      const orderedKeys: Array<TeamCode | null> = [...activeTeamCodesSync(), null]
      const records: MemberWorkloadToolRecord[] = orderedKeys.flatMap(key => {
        if (team && key !== team) return []
        const bucket = buckets.get(key)
        if (!bucket) return []
        const { actualSum, ...record } = bucket
        return [{
          ...record,
          avgActualPct: record.taskCount > 0 ? round1(actualSum / record.taskCount) : null,
        }]
      })
      const memberCount = records.reduce((sum, record) => sum + record.memberNames.length, 0)
      const sources: BotSource[] = [
        membersMenuSource(projectId, team),
        {
          id: `wbs-overview:${projectId}`,
          domain: 'wbs',
          entityType: 'project',
          entityId: projectId,
          projectId,
          title: 'WBS 진척 데이터',
          href: internalProjectHref(projectId, 'wbs'),
          updatedAt: null,
        },
      ]
      return {
        ok: true,
        result: {
          status: 'ok',
          facts: {
            projectFound: true,
            memberCount,
            totalLeafTasks: leaves.length,
            returned: records.length,
            calculationDate: today,
          },
          records,
          sources,
          asOf: context.now,
          truncated: false,
          warnings: [TEAM_AGGREGATION_WARNING],
        },
      }
    },
  }
}
