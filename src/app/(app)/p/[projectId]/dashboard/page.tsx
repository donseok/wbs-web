import Link from 'next/link'
import { ListTree, GanttChartSquare, Columns3, TrendingUp, Target, Activity, CheckCircle2, AlertTriangle } from 'lucide-react'
import { getComputedWbs } from '@/lib/data/wbs'
import { overallProgress } from '@/lib/domain/rollup'
import { getProjectMembers } from '@/lib/data/members'
import { getAttendanceRecords } from '@/lib/data/attendance'
import { getSnapshots } from '@/lib/data/snapshots'
import { getMembership } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { TrendCard } from '@/components/dashboard/TrendCard'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { collectLeaves } from '@/components/wbs/shared'
import { ReportButton } from '@/components/report/ReportButton'
import { DashboardView } from '@/components/dashboard/DashboardView'

const HERO_BTN =
  'inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-hero-ink backdrop-blur transition hover:bg-white/20'

export default async function Dashboard({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [{ items, today }, projects, members, attendance, snapshots, membership] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getProjectMembers(projectId),
    getAttendanceRecords(projectId),
    getSnapshots(projectId),
    getMembership(),
  ])
  const project = projects.find(p => p.id === projectId)
  const canCapture = membership?.role === 'pmo_admin'

  // 루트(=Phase) 가중치 정규화로 전체 공정율 산출(공유 헬퍼). weight=null은 균등.
  const { actual: overallActual, planned: overallPlanned } = overallProgress(items)
  const variance = overallActual - overallPlanned

  const leaves = collectLeaves(items)
  const inProgress = leaves.filter(l => l.status === 'in_progress').length
  const doneCount = leaves.filter(l => l.status === 'done').length
  const delayedCount = leaves.filter(l => l.status === 'delayed').length
  const donePct = leaves.length ? Math.round((doneCount / leaves.length) * 100) : 0

  return (
    <>
      <PageHero
        eyebrow="OPERATIONS"
        badge={<HeroBadge>Smart Utility</HeroBadge>}
        title={`${project?.name ?? '프로젝트'} 운영 현황`}
        description={project?.description ?? undefined}
        actions={
          <>
            <Link href={`/p/${projectId}/wbs`} className={HERO_BTN}><ListTree className="h-4 w-4" />WBS 보기</Link>
            <Link href={`/p/${projectId}/wbs`} className={HERO_BTN}><GanttChartSquare className="h-4 w-4" />간트 차트</Link>
            <Link href={`/p/${projectId}/kanban`} className={HERO_BTN}><Columns3 className="h-4 w-4" />칸반 보드</Link>
            <ReportButton
              items={items}
              projectName={project?.name ?? ''}
              projectDescription={project?.description}
              today={today}
              startDate={project?.start_date}
              endDate={project?.end_date}
            />
          </>
        }
        aside={
          <>
            <KpiCard label="ACTUAL PROGRESS" value={`${overallActual}%`} sub="실적 공정율" icon={TrendingUp} tone="brand" />
            <KpiCard label="계획 공정율" value={`${overallPlanned}%`} sub={`계획 대비 ${variance >= 0 ? '+' : ''}${variance}%p`} icon={Target} tone="default" />
            <KpiCard label="진행중 작업" value={inProgress} sub={`전체 ${leaves.length}건`} icon={Activity} tone="warning" />
            <KpiCard label="완료된 작업" value={doneCount} sub={`${donePct}% 완료`} icon={CheckCircle2} tone="success" />
            <KpiCard label="지연 작업" value={delayedCount} sub={delayedCount > 0 ? '점검 필요' : '정상 범위'} icon={AlertTriangle} tone="danger" />
          </>
        }
      />

      <DashboardView
        items={items}
        startDate={project?.start_date ?? null}
        endDate={project?.end_date ?? null}
        today={today}
        memberCount={members.length}
        attendance={attendance}
      />

      <div className="mt-5">
        <TrendCard projectId={projectId} snapshots={snapshots} canCapture={canCapture} />
      </div>
    </>
  )
}
