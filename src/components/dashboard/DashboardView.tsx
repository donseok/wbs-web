import { BarChart3 } from 'lucide-react'
import type {
  Announcement, AttendanceRecord, ComputedItem, Meeting, MeetingException, ProjectMember,
} from '@/lib/domain/types'
import type { SnapshotPoint } from '@/lib/domain/trend'
import { buildTrend } from '@/lib/domain/trend'
import { milestoneTimeline } from '@/lib/domain/dashboard'
import { overallProgress } from '@/lib/domain/rollup'
import { EmptyState } from '@/components/ui/EmptyState'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ExecSummary } from './ExecSummary'
import { TrendChart } from './TrendChart'
import { SpiPanel } from './SpiPanel'
import { MilestoneTimeline } from './MilestoneTimeline'
import { MeetingSchedule } from './MeetingSchedule'
import { AttendanceBoard } from './AttendanceBoard'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/** 경영진/PMO 대시보드 — ExecSummary 아래를 타임라인·트렌드·회의·근태로 구성.
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
  attendance = [],
  members = [],
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
  attendance?: AttendanceRecord[]
  members?: ProjectMember[]
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (items.length === 0) {
    return <EmptyState icon={BarChart3} title={tr('dash.emptyTitle')} description={tr('dash.emptyDesc')} />
  }

  const { actual, planned } = overallProgress(items)
  const trend = buildTrend({ items, snapshots, holidays: new Set(holidays), startDate, endDate, today })
  const milestones = milestoneTimeline(items, today)

  return (
    <div className="space-y-5">
      {/* A. 경영진 요약 — 게이지 + 신호등 3 + 공지 + 리포트 (현행 유지) */}
      <ExecSummary
        items={items} projectId={projectId} projectName={projectName}
        projectDescription={projectDescription} startDate={startDate} endDate={endDate}
        today={today} announcements={announcements}
      />

      {/* B. 마일스톤 여정 */}
      <MilestoneTimeline points={milestones} startDate={startDate} endDate={endDate} today={today} />

      {/* C. 진척 트렌드 — S-Curve + SPI/velocity */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TrendChart model={trend} currentActual={actual} today={today} />
        <SpiPanel model={trend} variance={actual - planned} />
      </div>

      {/* D. 협업 현황 — 회의 일정 + 근태(좌우 균형).
          today 프롭은 base_date(공정율 기준일)로 고정될 수 있으므로(getComputedWbs) 쓰지 않는다 —
          회의·근태는 진척 산정이 아니라 실제 달력이므로 항상 실제 오늘 기준. */}
      <div className="grid gap-5 xl:grid-cols-2">
        <MeetingSchedule projectId={projectId} meetings={meetings} exceptions={meetingExceptions} today={seoulToday()} />
        <AttendanceBoard projectId={projectId} records={attendance} members={members} today={seoulToday()} />
      </div>
    </div>
  )
}
