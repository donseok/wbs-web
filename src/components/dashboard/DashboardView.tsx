import { BarChart3 } from 'lucide-react'
import type { Announcement, ComputedItem, TeamCode } from '@/lib/domain/types'
import type { SnapshotPoint } from '@/lib/domain/trend'
import { buildTrend } from '@/lib/domain/trend'
import { progressMatrix, varianceRanking, milestoneTimeline, delayAging, dataHygiene } from '@/lib/domain/dashboard'
import { overallProgress } from '@/lib/domain/rollup'
import { collectLeaves } from '@/lib/domain/tree'
import { EmptyState } from '@/components/ui/EmptyState'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ExecSummary } from './ExecSummary'
import { TrendChart } from './TrendChart'
import { SpiPanel } from './SpiPanel'
import { ProgressMatrix } from './ProgressMatrix'
import { VarianceRanking } from './VarianceRanking'
import { MilestoneTimeline } from './MilestoneTimeline'
import { DelayAging } from './DelayAging'
import { DataHygiene } from './DataHygiene'

const TEAMS: readonly TeamCode[] = ['PMO', 'ERP', 'MES', '가공']

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/** 경영진/PMO 대시보드 — ExecSummary 아래를 트렌드·매트릭스·랭킹·타임라인·에이징·위생으로 구성.
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
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (items.length === 0) {
    return <EmptyState icon={BarChart3} title={tr('dash.emptyTitle')} description={tr('dash.emptyDesc')} />
  }

  const leaves = collectLeaves(items)
  const { actual, planned } = overallProgress(items)
  const trend = buildTrend({ items, snapshots, holidays: new Set(holidays), startDate, endDate, today })
  const matrix = progressMatrix(items, TEAMS)
  const ranking = varianceRanking(leaves, today)
  const milestones = milestoneTimeline(items, today)
  const aging = delayAging(leaves, today)
  const hygiene = dataHygiene(items)

  return (
    <div className="space-y-5">
      {/* A. 경영진 요약 — 게이지 + 신호등 3 + 공지 + 리포트 (현행 유지) */}
      <ExecSummary
        items={items} projectId={projectId} projectName={projectName}
        projectDescription={projectDescription} startDate={startDate} endDate={endDate}
        today={today} announcements={announcements}
      />

      {/* B. 진척 트렌드 — S-Curve + SPI/velocity */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TrendChart model={trend} currentActual={actual} today={today} />
        <SpiPanel model={trend} variance={actual - planned} />
      </div>

      {/* C. 병목 식별 — Phase×팀 매트릭스 + 따라잡기 랭킹 */}
      <div className="grid gap-5 xl:grid-cols-2">
        <ProgressMatrix rows={matrix} teams={TEAMS} />
        <VarianceRanking entries={ranking} />
      </div>

      {/* D. 마일스톤 여정 */}
      <MilestoneTimeline points={milestones} startDate={startDate} endDate={endDate} today={today} />

      {/* E. 기한 경과 + 계획 데이터 품질 */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <DelayAging aging={aging} />
        <DataHygiene hygiene={hygiene} projectId={projectId} />
      </div>
    </div>
  )
}
