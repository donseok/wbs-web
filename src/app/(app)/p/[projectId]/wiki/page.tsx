import { listProjects } from '@/app/actions/project'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { PageHero } from '@/components/ui/PageHero'
import { WikiOverview } from '@/components/wiki/WikiOverview'
import { getWikiOverview } from '@/lib/data/wiki'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

export default async function ProjectWikiPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const [data, projects, locale] = await Promise.all([
    getWikiOverview(projectId),
    listProjects(),
    getServerLocale(),
  ])
  const project = projects.find((candidate) => candidate.id === projectId)
  const projectName = project?.name ?? t(locale, 'wiki.projectFallback')

  return (
    <ProjectPageShell
      hero={<PageHero title={`${projectName}${t(locale, 'wiki.heroTitleSuffix')}`} />}
    >
      <WikiOverview projectId={projectId} data={data} locale={locale} />
    </ProjectPageShell>
  )
}
