import { listProjects } from '@/app/actions/project'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
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

function parseQuestionId(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null
}

/**
 * ?q= — 검색어를 URL 에 남기는 이유는 둘이다. 문서를 열었다 뒤로 오면 검색어가
 * 사라져 매번 다시 치던 문제, 그리고 찾은 결과를 링크로 넘길 수 없던 문제.
 * 200자를 넘는 값은 검색어가 아니라고 보고 버린다.
 */
function parseQuery(value: string | string[] | undefined): string {
  return typeof value === 'string' && value.length <= 200 ? value : ''
}

export default async function ProjectWikiPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ view?: string | string[]; question?: string | string[]; q?: string | string[] }>
}) {
  const { projectId } = await params
  const { view, question, q } = await searchParams
  const [data, projects, locale, actor] = await Promise.all([
    getWikiOverview(projectId),
    listProjects(),
    getServerLocale(),
    getActorForView(),
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
        canCurate={isProjectAdmin(actor, projectId)}
        canMergeTopics={isProjectAdmin(actor, projectId)}
        canEditDocuments={isProjectMember(actor, projectId)}
        highlightQuestionId={parseQuestionId(question)}
        initialQuery={parseQuery(q)}
      />
    </ProjectPageShell>
  )
}
