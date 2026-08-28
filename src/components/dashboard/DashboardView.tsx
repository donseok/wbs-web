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

/** 경영진/PMO 대시보드 — ExecSummary 아래를 타임라인·트렌드·회의·이슈로 구성.
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
  // 이중 시계 — WBS 진척은 today(base_date 우선), 회의·회의록·이슈는 실제 오늘(섹션 D·E 주석).
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

      {/* 실행 큐 — 진척 트렌드 아래에서 숫자형 리스크를 담당자가 바로 열어볼 수 있는 WBS 작업으로 연결 */}
      <RiskWorklist items={items} projectId={projectId} today={today} />

      {/* D. 회의 일정 — '주요 이슈·의사결정'(회의록 인사이트) 카드는 2026-08-28 사용자 요청으로 제거.
          today 프롭은 base_date(공정율 기준일)로 고정될 수 있으므로(getComputedWbs) 쓰지 않는다 —
          회의는 진척 산정이 아니라 실제 달력이므로 항상 실제 오늘 기준. */}
      <MeetingSchedule projectId={projectId} meetings={meetings} exceptions={meetingExceptions} today={realToday}
        currentUserId={currentUserId} role={role} />

      {/* E. 이슈 현황(2026-08-28, AI 브리핑 & 위험 신호 카드 자리) — 좌: 현황(KPI·분포·Mega별),
          우: 등록·해결 추이 위에 지연·임박 조치 대기. 이슈 기한은 실제 달력이라 realToday.
          이슈 0건이면 현황 카드 하나만 빈 상태로 — 빈 카드 셋을 나란히 두지 않는다. */}
      {issues.length === 0 ? (
        <IssueStatusCard issues={issues} projectId={projectId} today={realToday} locale={locale} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <IssueStatusCard issues={issues} projectId={projectId} today={realToday} locale={locale} />
          <div className="grid gap-5 content-start">
            <IssueTrendCard issues={issues} today={realToday} locale={locale} />
            <IssueQueueCard issues={issues} projectId={projectId} today={realToday} locale={locale} />
          </div>
        </div>
      )}
    </div>
  )
}
