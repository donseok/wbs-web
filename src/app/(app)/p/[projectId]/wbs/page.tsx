import { getComputedWbs } from '@/lib/data/wbs'
import { listProjects } from '@/app/actions/project'
import { getMembership, getSession } from '@/lib/auth'
import { displayNameFrom } from '@/lib/domain/display-name'
import { getWbsCollapse } from '@/app/actions/preferences'
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
  searchParams: Promise<{ view?: string; focus?: string }>
}) {
  const { projectId } = await params
  const { view, focus } = await searchParams
  const locale = await getServerLocale()
  const [{ items, holidays, today }, m, projects, initialCollapsed, user] = await Promise.all([
    getComputedWbs(projectId),
    getMembership(),
    listProjects(),
    getWbsCollapse(projectId),
    getSession(),
  ])
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  // 프레즌스 신원 — 주간 시트와 동일하게 서버 세션에서 전달
  const me = user ? { id: user.id, name: displayNameFrom(user.user_metadata, user.email) ?? '사용자' } : null
  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="WBS · GANTT"
        title={`${project?.name ?? t(locale, 'wbs.projectFallback')} ${t(locale, 'wbs.heroTitleSuffix')}`}
        description={t(locale, 'wbs.heroDesc')}
      />}
    >
      <WbsGanttSheet
        key={projectId}
        items={items}
        holidays={holidays}
        today={today}
        membership={m}
        me={me}
        projectId={projectId}
        projectName={project?.name ?? ''}
        projectDescription={project?.description}
        startDate={project?.start_date}
        endDate={project?.end_date}
        defaultView={view === 'timeline' ? 'timeline' : 'sheet'}
        initialCollapsed={initialCollapsed ?? undefined}
        focusId={focus ?? null}
      />
    </ProjectPageShell>
  )
}
