import { ListChecks, Activity, Gauge } from 'lucide-react'
import { getComputedWbs } from '@/lib/data/wbs'
import { getMembership } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { collectLeaves } from '@/components/wbs/shared'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'

export default async function KanbanPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [{ items, today }, m, projects, locale] = await Promise.all([
    getComputedWbs(projectId),
    getMembership(),
    listProjects(),
    getServerLocale(),
  ])

  const project = projects.find((p: { id: string }) => p.id === projectId)
  const name = project?.name ?? t(locale, 'kanban.projectFallback')

  const leaves = collectLeaves(items)
  const total = leaves.length
  const inProgress = leaves.filter(leaf => leaf.status === 'in_progress').length
  const overall = items.length
    ? Math.round(items.reduce((sum, root) => sum + root.rolledActualPct, 0) / items.length)
    : 0

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="KANBAN BOARD"
        title={`${name} ${t(locale, 'kanban.heroTitleSuffix')}`}
        description={t(locale, 'kanban.heroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label={t(locale, 'kanban.kpiTotalTasks')} value={total} sub={t(locale, 'kanban.kpiTotalTasksSub')} icon={ListChecks} />
            <KpiCard variant="hero" label={t(locale, 'status.in_progress')} value={inProgress} sub={`${t(locale, 'kanban.kpiOfTotalPrefix')}${total}${t(locale, 'kanban.kpiOfTotalSuffix')}`} icon={Activity} tone="brand" />
            <KpiCard variant="hero" label={t(locale, 'kanban.kpiOverallProgress')} value={`${overall}%`} sub={t(locale, 'kanban.kpiOverallProgressSub')} icon={Gauge} tone="success" />
          </>
        }
      />
      <KanbanBoard items={items} membership={m} today={today} />
    </div>
  )
}
