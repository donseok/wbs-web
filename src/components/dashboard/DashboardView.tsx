import { BarChart3 } from 'lucide-react'
import type { Announcement, ComputedItem, Meeting, MeetingException } from '@/lib/domain/types'
import type { SnapshotPoint } from '@/lib/domain/trend'
import { buildTrend } from '@/lib/domain/trend'
import { milestoneTimeline } from '@/lib/domain/dashboard'
import { round1 } from '@/lib/domain/format'
import { overallProgress } from '@/lib/domain/rollup'
import type { DashboardIssue } from '@/lib/domain/issueDashboard'
import { EmptyState } from '@/components/ui/EmptyState'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { activeCodes, teamOrderMap } from '@/lib/domain/teams'
import { teamsForProjectSync } from '@/lib/teams/master'
import { ExecSummary } from './ExecSummary'
import { TrendChart } from './TrendChart'
import { SpiPanel } from './SpiPanel'
import { MilestoneTimeline } from './MilestoneTimeline'
import { MeetingSchedule } from './MeetingSchedule'
import { RiskWorklist } from './RiskWorklist'
import { TeamProgress } from './TeamProgress'
import { IssueStatusCard } from './IssueStatusCard'
import { IssueTrendCard } from './IssueTrendCard'
import { IssueQueueCard } from './IssueQueueCard'
import { seoulToday } from '@/lib/domain/dates'

/** 경영진/PMO 대시보드 — 읽기 순서(2026-08-28 재배치): 어디까지 왔나(요약·마일스톤·S-Curve·팀별)
 *  → 지금 뭘 챙기나(WBS 큐·이슈 큐) → 이슈가 어떤 상태인가(현황·추이) → 앞으로 뭐가 있나(회의).
 *  모든 집계는 도메인 함수가 담당하고 여기서는 조립만 한다. */
export async function DashboardView({
  items,
  projectId,
  projectName,
  projectDescription = null,
  startDate = null,
  endDate = null,
  today = seoulToday(),
  holidays = [],
  snapshots = [],
  announcements = [],
  meetings = [],
  meetingExceptions = [],
  issues = [],
  currentUserId = null,
  role = null,
  canGenerateBrief = false,
  milestoneKeywords,
}: {
  items: ComputedItem[]
  projectId: string
  projectName: string
  projectDescription?: string | null
  startDate?: string | null
  endDate?: string | null
  today?: string
  holidays?: string[]
  snapshots?: SnapshotPoint[]
  announcements?: Announcement[]
  meetings?: Meeting[]
  meetingExceptions?: MeetingException[]
  /** 이슈 현황 카드용 슬라이스(page.tsx 의 getIssuesForDashboard). 실패 시 [] — 카드는 빈 상태를 정직하게 그린다. */
  issues?: DashboardIssue[]
  /** 회의 카드에서 작성자 본인/pmo_admin 에게 수정·삭제를 열기 위한 식별자. */
  currentUserId?: string | null
  role?: string | null
  /** AI 브리핑(PPT 리포트 ai=1) 생성 권한 = isProjectAdmin(actor, projectId). ensureProjectBriefAction 의
   *  requireProjectAdmin 과 같은 판정. 기본 false = fail-closed. */
  canGenerateBrief?: boolean
  /** 프로젝트 설정(project_settings)의 마일스톤 키워드 — page.tsx 가 getProjectConfig 로 주입. */
  milestoneKeywords: readonly string[]
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (items.length === 0) {
    return <EmptyState icon={BarChart3} title={tr('dash.emptyTitle')} description={tr('dash.emptyDesc')} />
  }

  const { actual, planned } = overallProgress(items)
  const subActTeamOrder = teamOrderMap(activeCodes(teamsForProjectSync(projectId)))
  const trend = buildTrend({
    items, snapshots, holidays: new Set(holidays), startDate, endDate, today,
    opts: { subActTeamOrder },
  })
  const milestones = milestoneTimeline(items, today, milestoneKeywords)
  // 이중 시계 — WBS 진척은 today(base_date 우선), 회의·이슈는 실제 오늘(섹션 D·E 주석).
  const realToday = seoulToday()

  return (
    <div className="space-y-5">
      {/* A. 경영진 요약 — 게이지 + 신호등 3 + 공지 + 리포트 (현행 유지) */}
      <ExecSummary
        items={items} projectId={projectId} projectName={projectName}
        projectDescription={projectDescription} startDate={startDate} endDate={endDate}
        today={today} announcements={announcements} canGenerateBrief={canGenerateBrief}
        milestoneKeywords={milestoneKeywords}
      />

      {/* B. 마일스톤 여정 */}
      <MilestoneTimeline points={milestones} startDate={startDate} endDate={endDate} today={today} />

      {/* C. 진척현황 — S-Curve + SPI/velocity. lg부터 2열 — xl(1280px) 기준이면 배율 확대
          노트북에서 세로로 쌓여 페이지 스크롤이 길어진다(사용자 요청 2026-07-19). */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TrendChart model={trend} today={today} />
        <SpiPanel model={trend} variance={round1(actual - planned)} />
      </div>

      {/* 팀별 진척 — 실행 큐로 내려가기 전에 팀 단위 진행 현황을 한눈에 */}
      <TeamProgress items={items} teams={teamsForProjectSync(projectId)} />

      {/* D. 조치 — '지금 챙길 것'을 한 줄에: 좌 WBS 실행 큐(지연·임박·뒤처짐), 우 지연·임박 이슈.
          두 카드는 같은 문법(틴트 행 + 딥링크)이라 나란히 두면 한 번의 시선으로 스캔된다.
          시계가 다르다 — WBS 는 today(base_date 우선, 진척 산정과 동일), 이슈는 실제 오늘(달력 기한). */}
      <div className="grid gap-5 lg:grid-cols-2">
        <RiskWorklist items={items} projectId={projectId} today={today} />
        <IssueQueueCard issues={issues} projectId={projectId} today={realToday} locale={locale} />
      </div>

      {/* E. 분석 + 일정 — 좌: 이슈 현황(KPI·상태 분포·Mega별, 세로로 길다), 우: 등록·해결 추이 위에 회의 일정.
          우측을 두 카드로 쌓아 좌측 높이와 균형을 맞춘다(추이 카드 혼자 두면 아래가 빈다 — 목업에서 확인).
          이슈 0건이면 추이(빈 상태)를 건너뛰고 회의 일정만 — 빈 카드를 나란히 두지 않는다.
          회의 일정은 진척 산정이 아니라 실제 달력이므로 항상 실제 오늘 기준(base_date 금지). */}
      <div className="grid gap-5 lg:grid-cols-2">
        <IssueStatusCard issues={issues} projectId={projectId} today={realToday} locale={locale} />
        <div className="grid content-start gap-5">
          {issues.length > 0 && <IssueTrendCard issues={issues} today={realToday} locale={locale} />}
          <MeetingSchedule projectId={projectId} meetings={meetings} exceptions={meetingExceptions} today={realToday}
            currentUserId={currentUserId} role={role} />
        </div>
      </div>
    </div>
  )
}
