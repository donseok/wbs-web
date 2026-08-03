import { Users, UserCog, UserRound } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectMembers } from '@/lib/data/members'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { MembersBoard } from '@/components/members/MembersBoard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

export default async function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [members, m, projects, locale] = await Promise.all([
    getProjectMembers(projectId),
    getActorForView(),
    listProjects(),
    getServerLocale(),
  ])

  const project = projects.find((p) => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'members.projectFallback')
  const canEdit = isProjectAdmin(m, projectId)

  const teamSize = members.length
  // 명단상의 구분(리더/실무)을 센다 — 프로젝트 권한(project_roles)과는 무관하다.
  const leads = members.filter((x) => x.role === 'admin').length
  const contributors = members.filter((x) => x.role === 'contributor').length

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="TEAM"
        badge={<HeroBadge>Members</HeroBadge>}
        title={`${projectName} ${t(locale, 'members.heroTitleSuffix')}`}
        description={t(locale, 'members.heroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TEAM SIZE" value={teamSize} sub={t(locale, 'members.kpiTeamSizeSub')} icon={Users} tone="brand" />
            <KpiCard variant="hero" label="LEADS" value={leads} sub={t(locale, 'members.kpiAdminsSub')} icon={UserCog} tone="success" />
            <KpiCard variant="hero" label="CONTRIBUTORS" value={contributors} sub={t(locale, 'members.kpiContributorsSub')} icon={UserRound} tone="default" />
          </>
        }
      />}
    >
      <MembersBoard members={members} canEdit={canEdit} projectId={projectId} />
    </ProjectPageShell>
  )
}
