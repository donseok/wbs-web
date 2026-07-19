import { dashboardHref, wbsItemHref } from '@/lib/ai/chat/deep-links'
import {
  addDaysCal,
  detectMilestones,
  progressSignal,
  scheduleModel,
} from '@/lib/domain/dashboard'
import { round1 } from '@/lib/domain/format'
import { expandMeetings, summarizeMeetings } from '@/lib/domain/meetings'
import { computeTree, overallProgress } from '@/lib/domain/rollup'
import { collectLeaves } from '@/lib/domain/tree'
import type { Status } from '@/lib/domain/types'
import type {
  MeetingBotRepository,
  WbsBotRepository,
  WbsProjectSnapshot,
} from '@/lib/repositories/types'
import {
  checkProjectAccess,
  invalidArgument,
  isRecord,
  readRequiredString,
  repositoryFailure,
  repositoryScopeViolation,
  todayInSeoul,
} from './common'
import type { BotSource, ReadOnlyBotTool } from './types'

const DASHBOARD_CAPABILITY = 'dashboard:read' as const
const MEETING_SIGNAL_WARNING = '회의 데이터를 확인하지 못해 회의 신호를 제외했습니다.'

function isScopedWbsSnapshot(snapshot: WbsProjectSnapshot, projectId: string): boolean {
  return snapshot.projectId === projectId
    && snapshot.items.every(item => item.projectId === projectId)
    && snapshot.dependencies.every(dependency => dependency.projectId === projectId)
}

function meetingRowsStayInScope(
  projectId: string,
  meetings: ReadonlyArray<{ id: string; projectId: string }>,
  exceptions: ReadonlyArray<{ meetingId: string }>,
): boolean {
  const meetingIds = new Set(meetings.map(meeting => meeting.id))
  return meetings.every(meeting => meeting.projectId === projectId)
    && exceptions.every(exception => meetingIds.has(exception.meetingId))
}

export function createGetProjectDashboardTool(
  wbs: WbsBotRepository,
  meetings: MeetingBotRepository,
): ReadOnlyBotTool<never> {
  return {
    name: 'get_project_dashboard',
    requiredCapability: DASHBOARD_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      if (!projectId) return invalidArgument()
      const denied = checkProjectAccess(context, projectId, DASHBOARD_CAPABILITY)
      if (denied) return denied

      const wbsResult = await wbs.getProjectSnapshot(projectId)
      if (!wbsResult.ok) return repositoryFailure(wbsResult)
      if (!wbsResult.data) {
        return {
          ok: true,
          result: {
            status: 'ok', facts: { projectFound: false }, records: [], sources: [],
            asOf: context.now, truncated: false, warnings: [],
          },
        }
      }
      if (!isScopedWbsSnapshot(wbsResult.data, projectId)) return repositoryScopeViolation()

      const snapshot = wbsResult.data
      // WBS 신호는 기준일(base_date 우선), 회의 신호는 실제 오늘 — 대시보드 화면의 이중 시계 관례.
      const realToday = todayInSeoul(context.now)
      const calculationDate = snapshot.baseDate ?? realToday
      const roots = computeTree(snapshot.items, calculationDate, new Set(snapshot.holidays))
      const leaves = collectLeaves(roots)
      const statusCount = (status: Status) => leaves.filter(leaf => leaf.status === status).length
      const { actual, planned } = overallProgress(roots)
      const variance = round1(actual - planned)

      // 스냅샷에는 프로젝트 기간 컬럼이 없어 WBS 계획일 최소/최대로 근사한다.
      let startDate: string | null = null
      let endDate: string | null = null
      for (const item of snapshot.items) {
        if (item.plannedStart && (!startDate || item.plannedStart < startDate)) startDate = item.plannedStart
        if (item.plannedEnd && (!endDate || item.plannedEnd > endDate)) endDate = item.plannedEnd
      }
      const schedule = scheduleModel({
        startDate, endDate, today: calculationDate,
        overallActual: actual, overallPlanned: planned,
      })
      const milestone = detectMilestones(roots, calculationDate)

      const sources: BotSource[] = [{
        id: `dashboard:${projectId}`,
        domain: 'dashboard',
        entityType: 'project',
        entityId: projectId,
        projectId,
        title: '프로젝트 대시보드',
        href: dashboardHref(projectId),
        updatedAt: null,
      }]
      // detectMilestones는 항목 id를 반환하지 않아 이름+계획 완료일로 원본 leaf를 역추적한다.
      const milestoneLeaf = milestone.name === null
        ? undefined
        : leaves.find(leaf => leaf.name === milestone.name && leaf.plannedEnd === milestone.date)
      if (milestoneLeaf) {
        sources.push({
          id: `wbs:${milestoneLeaf.id}`,
          domain: 'wbs',
          entityType: 'wbs_item',
          entityId: milestoneLeaf.id,
          projectId,
          title: milestoneLeaf.code ? `${milestoneLeaf.code} ${milestoneLeaf.name}` : milestoneLeaf.name,
          href: wbsItemHref(projectId, milestoneLeaf.id),
          updatedAt: snapshot.items.find(item => item.id === milestoneLeaf.id)?.updatedAt ?? null,
        })
      }

      const meetingRangeTo = addDaysCal(realToday, 7)
      const meetingsResult = await meetings.listProjectMeetings(projectId, realToday, meetingRangeTo)
      // 범위를 넓힌 회의 응답은 부분 신뢰 금지 — 부분 응답이 아니라 전체 실패로 처리한다.
      if (meetingsResult.ok && !meetingRowsStayInScope(
        projectId, meetingsResult.data.meetings, meetingsResult.data.exceptions,
      )) return repositoryScopeViolation()

      let meetingFacts: { todayMeetings: number; upcoming7dMeetings: number } | null = null
      if (meetingsResult.ok) {
        const occurrences = expandMeetings(
          meetingsResult.data.meetings, meetingsResult.data.exceptions, realToday, meetingRangeTo,
        )
        const summary = summarizeMeetings(occurrences, realToday)
        meetingFacts = { todayMeetings: summary.today, upcoming7dMeetings: summary.upcoming7d }
      }

      return {
        ok: true,
        result: {
          status: meetingFacts ? 'ok' : 'partial',
          facts: {
            projectFound: true,
            calculationDate,
            plannedPct: planned,
            actualPct: actual,
            variance,
            progressSignal: progressSignal(variance),
            wbsItemCount: leaves.length,
            delayedCount: statusCount('delayed'),
            doneCount: statusCount('done'),
            inProgressCount: statusCount('in_progress'),
            projectedEnd: schedule.projectedEnd,
            slipDays: schedule.slipDays,
            elapsedPct: schedule.elapsedPct,
            scheduleSignal: schedule.signal,
            // 'none'은 DISPLAY_ENUMS의 반복 주기 'none'(반복 없음)과 충돌하므로 null(없음)로 표기한다.
            scheduleLabel: schedule.label === 'none' ? null : schedule.label,
            milestoneName: milestone.name,
            milestoneDate: milestone.date,
            milestoneDday: milestone.dday,
            milestoneOverdue: milestone.overdue,
            ...(meetingFacts ?? {}),
          },
          records: [],
          sources,
          asOf: context.now,
          truncated: false,
          warnings: meetingFacts ? [] : [MEETING_SIGNAL_WARNING],
        },
      }
    },
  }
}
