import { Users, ShieldCheck, UserRound } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectMembers } from '@/lib/data/members'
import { getMembership } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { MembersBoard } from '@/components/members/MembersBoard'

export default async function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [members, m, projects, locale] = await Promise.all([
    getProjectMembers(projectId),
    getMembership(),
    listProjects(),
    getServerLocale(),
  ])

  const project = projects.find((p) => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'members.projectFallback')
  const canEdit = m?.role === 'pmo_admin'

  const teamSize = members.length
  const admins = members.filter((x) => x.role === 'admin').length
  const contributors = members.filter((x) => x.role === 'contributor').length

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="TEAM"
        badge={<HeroBadge>Members</HeroBadge>}
        title={`${projectName} ${t(locale, 'members.heroTitleSuffix')}`}
        description={t(locale, 'members.heroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TEAM SIZE" value={teamSize} sub={t(locale, 'members.kpiTeamSizeSub')} icon={Users} tone="brand" />
            <KpiCard variant="hero" label="ADMINS" value={admins} sub={t(locale, 'members.kpiAdminsSub')} icon={ShieldCheck} tone="success" />
            <KpiCard variant="hero" label="CONTRIBUTORS" value={contributors} sub={t(locale, 'members.kpiContributorsSub')} icon={UserRound} tone="default" />
          </>
        }
      />

      <MembersBoard members={members} canEdit={canEdit} projectId={projectId} />
    </div>
  )
}
