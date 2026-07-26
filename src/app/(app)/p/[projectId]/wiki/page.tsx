import { listProjects } from '@/app/actions/project'
import { getMembership } from '@/lib/auth'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { PageHero } from '@/components/ui/PageHero'
import { WikiOverview } from '@/components/wiki/WikiOverview'
import { getWikiOverview } from '@/lib/data/wiki'
import { WIKI_VIEWS, type WikiView } from '@/lib/domain/wikiView'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

/** KPI 카드가 넘겨주는 ?view=. 알 수 없는 값은 조용히 전체 뷰로 되돌린다. */
function parseView(value: string | string[] | undefined): WikiView {
  return typeof value === 'string' && (WIKI_VIEWS as readonly string[]).includes(value)
    ? value as WikiView
    : 'all'
}

export default async function ProjectWikiPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ view?: string | string[] }>
}) {
  const { projectId } = await params
  const { view } = await searchParams
  const [data, projects, locale, membership] = await Promise.all([
    getWikiOverview(projectId),
    listProjects(),
    getServerLocale(),
    getMembership(),
  ])
  const project = projects.find((candidate) => candidate.id === projectId)
  const projectName = project?.name ?? t(locale, 'wiki.projectFallback')

  return (
    <ProjectPageShell
      hero={<PageHero title={`${projectName}${t(locale, 'wiki.heroTitleSuffix')}`} />}
    >
      <WikiOverview
        projectId={projectId}
        data={data}
        locale={locale}
        view={parseView(view)}
        canCurate={membership !== null}
        canMergeTopics={membership?.role === 'pmo_admin'}
      />
    </ProjectPageShell>
  )
}
