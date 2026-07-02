import Link from 'next/link'
import { ListTree, GanttChartSquare, Columns3, TrendingUp, Target, Activity, CheckCircle2, AlertTriangle } from 'lucide-react'
import { getComputedWbs } from '@/lib/data/wbs'
import { overallProgress } from '@/lib/domain/rollup'
import { getProjectMembers } from '@/lib/data/members'
import { getAttendanceRecords } from '@/lib/data/attendance'
import { listProjects } from '@/app/actions/project'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { collectLeaves } from '@/components/wbs/shared'
import { ReportButton } from '@/components/report/ReportButton'
import { DashboardView } from '@/components/dashboard/DashboardView'

const HERO_BTN =
  'inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-hero-ink backdrop-blur transition hover:bg-white/20'

export default async function Dashboard({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const locale = await getServerLocale()
  const [{ items, today }, projects, members, attendance] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getProjectMembers(projectId),
    getAttendanceRecords(projectId),
  ])
  const project = projects.find(p => p.id === projectId)

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
        title={`${project?.name ?? t(locale, 'dash.heroProjectFallback')}${t(locale, 'dash.heroTitleSuffix')}`}
        description={project?.description ?? undefined}
        actions={
          <>
            <Link href={`/p/${projectId}/wbs`} className={HERO_BTN}><ListTree className="h-4 w-4" />{t(locale, 'dash.viewWbs')}</Link>
            <Link href={`/p/${projectId}/wbs?view=timeline`} className={HERO_BTN}><GanttChartSquare className="h-4 w-4" />{t(locale, 'nav.gantt')}</Link>
            <Link href={`/p/${projectId}/kanban`} className={HERO_BTN}><Columns3 className="h-4 w-4" />{t(locale, 'nav.kanban')}</Link>
            <ReportButton
              projectId={projectId}
              items={items}
              projectName={project?.name ?? ''}
              projectDescription={project?.description}
              today={today}
              startDate={project?.start_date}
              endDate={project?.end_date}
            />
          </>
        }
        heroKpis={
          <>
            <KpiCard variant="hero" label="ACTUAL PROGRESS" value={`${overallActual}%`} sub={t(locale, 'dash.kpi.actualSub')} icon={TrendingUp} tone="brand" />
            <KpiCard variant="hero" label={t(locale, 'dash.kpi.planned')} value={`${overallPlanned}%`} sub={`${t(locale, 'dash.vsPlan')} ${variance >= 0 ? '+' : ''}${variance}%p`} icon={Target} tone="default" />
            <KpiCard variant="hero" label={t(locale, 'dash.kpi.inProgress')} value={inProgress} sub={`${t(locale, 'dash.ofTotalPrefix')} ${leaves.length}${t(locale, 'dash.unitCount')}`} icon={Activity} tone="warning" />
            <KpiCard variant="hero" label={t(locale, 'dash.kpi.done')} value={doneCount} sub={`${donePct}% ${t(locale, 'dash.pctDoneSuffix')}`} icon={CheckCircle2} tone="success" />
            <KpiCard variant="hero" label={t(locale, 'dash.kpi.delayed')} value={delayedCount} sub={delayedCount > 0 ? t(locale, 'dash.needsReview') : t(locale, 'dash.normalRange')} icon={AlertTriangle} tone="danger" />
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
    </>
  )
}
