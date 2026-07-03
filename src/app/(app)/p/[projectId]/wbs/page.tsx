import { getComputedWbs } from '@/lib/data/wbs'
import { listProjects } from '@/app/actions/project'
import { getMembership } from '@/lib/auth'
import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { PageHero } from '@/components/ui/PageHero'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

type ProjectRow = { id: string; name: string; description?: string | null; start_date?: string | null; end_date?: string | null }

export default async function WbsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { projectId } = await params
  const { view } = await searchParams
  const locale = await getServerLocale()
  const [{ items, holidays, today }, m, projects] = await Promise.all([
    getComputedWbs(projectId),
    getMembership(),
    listProjects(),
  ])
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="WBS · GANTT"
        title={`${project?.name ?? t(locale, 'wbs.projectFallback')} ${t(locale, 'wbs.heroTitleSuffix')}`}
        description={t(locale, 'wbs.heroDesc')}
      />}
    >
      <WbsGanttSheet
        items={items}
        holidays={holidays}
        today={today}
        membership={m}
        projectId={projectId}
        projectName={project?.name ?? ''}
        projectDescription={project?.description}
        startDate={project?.start_date}
        endDate={project?.end_date}
        defaultView={view === 'timeline' ? 'timeline' : 'sheet'}
      />
    </ProjectPageShell>
  )
}
