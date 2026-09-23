import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectMembers } from '@/lib/data/members'
import { getForceManagedIds } from '@/lib/data/forceProgress'
import { getProjectConfig } from '@/lib/data/projectConfig'
import { listProjects } from '@/app/actions/project'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { toProjectActorView } from '@/lib/domain/authz'
import { displayNameFrom } from '@/lib/domain/display-name'
import { getWbsCollapse, getUiPrefs } from '@/app/actions/preferences'
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
  searchParams: Promise<{ view?: string; focus?: string; open?: string }>
}) {
  const { projectId } = await params
  const { view, focus, open } = await searchParams
  const locale = await getServerLocale()
  const [{ items, dependencies, unresolvedDepends, holidays, today }, actor, projects, initialCollapsed, user, projectConfig, uiPrefs, members] = await Promise.all([
    getComputedWbs(projectId),
    getActorForView(),
    listProjects(),
    getWbsCollapse(projectId),
    getSession(),
    getProjectConfig(projectId),
    getUiPrefs(),
    getProjectMembers(projectId),
  ])
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  // 프레즌스 신원 — 주간 시트와 동일하게 서버 세션에서 전달
  const me = user ? { id: user.id, name: displayNameFrom(user.user_metadata, user.email) ?? '사용자' } : null
  // 강제 진행 버튼 노출 — 관리자가 아니어도 후행의 서브트리 관리자면 보인다(서버 가드는 그대로).
  const forceManagedIds = await getForceManagedIds(projectId, items, user ? { id: user.id, email: user.email ?? null } : null)
  return (
    <ProjectPageShell
      flush
      hero={<PageHero
        eyebrow="WBS · GANTT"
        title={`${project?.name ?? t(locale, 'wbs.projectFallback')} ${t(locale, 'wbs.heroTitleSuffix')}`}
        description={t(locale, 'wbs.heroDesc')}
      />}
    >
      <WbsGanttSheet
        key={projectId}
        items={items}
        dependencies={dependencies}
        unresolvedDepends={unresolvedDepends}
        holidays={holidays}
        today={today}
        actorView={toProjectActorView(actor, projectId)}
        me={me}
        projectId={projectId}
        projectName={project?.name ?? ''}
        projectDescription={project?.description}
        startDate={project?.start_date}
        endDate={project?.end_date}
        defaultView={view === 'timeline' ? 'timeline' : 'sheet'}
        initialCollapsed={initialCollapsed ?? undefined}
        focusId={focus ?? null}
        focusOpen={open === '1'}
        levelLabels={projectConfig.levelLabels}
        maxDepth={projectConfig.maxDepth}
        milestoneKeywords={projectConfig.milestoneKeywords}
        initialHideDone={uiPrefs.wbsHideDone ?? false}
        initialOutline={uiPrefs.wbsOutline ?? false}
        initialGanttScale={uiPrefs.wbsGanttScale}
        members={members}
        forceManagedIds={forceManagedIds}
      />
    </ProjectPageShell>
  )
}
