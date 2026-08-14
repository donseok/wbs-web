import { listProjects } from '@/app/actions/project'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { PageHero } from '@/components/ui/PageHero'
import { WikiTopicDetail } from '@/components/wiki/WikiTopicDetail'
import { getWikiTopicDetail } from '@/lib/data/wiki'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

export default async function WikiTopicPage({
  params,
}: {
  params: Promise<{ projectId: string; topicId: string }>
}) {
  const { projectId, topicId } = await params
  const [data, projects, locale, membership] = await Promise.all([
    getWikiTopicDetail(projectId, topicId),
    listProjects(),
    getServerLocale(),
    getActorForView(),
  ])
  const project = projects.find((candidate) => candidate.id === projectId)
  const projectName = project?.name ?? t(locale, 'wiki.projectFallback')
  const title = data.topic
    ? `${projectName} · ${data.topic.title}`
    : `${projectName}${t(locale, 'wiki.heroTitleSuffix')}`
  const canEditDocuments = isProjectMember(membership, projectId)

  return (
    <ProjectPageShell hero={<PageHero title={title} />}>
      <WikiTopicDetail
        projectId={projectId}
        data={data}
        locale={locale}
        canCurate={isProjectAdmin(membership, projectId)}
        canEditDocuments={canEditDocuments}
        canVerifyDocuments={canEditDocuments}
      />
    </ProjectPageShell>
  )
}
