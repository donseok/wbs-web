import { Users, UserCog, UserRound, Shield } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectMembers } from '@/lib/data/members'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { listProjectRoles } from '@/app/actions/projectRoles'
import { listProjectInvites } from '@/app/actions/projectInvites'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { MembersBoard } from '@/components/members/MembersBoard'
import { ProjectRolesManager } from '@/components/settings/ProjectRolesManager'
import { ProjectInviteManager } from '@/components/settings/ProjectInviteManager'
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
  const isSuperuser = m?.isSuperuser === true

  // 권한·초대는 설정에서 이 페이지로 이동(2026-08-20 화면 통합) — 명단·권한을 한 화면에서 본다.
  // 관리자에게만 필요하고, 이 조회의 실패가 명단 본체를 막으면 안 된다(섹션 안 에러 문구로 흡수).
  const [roles, invites] = await Promise.all([
    canEdit ? listProjectRoles(projectId) : null,
    canEdit ? listProjectInvites(projectId) : null,
  ])

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
      <div className="space-y-4">
        <MembersBoard members={members} canEdit={canEdit} projectId={projectId} />
        {canEdit && (
          <div id="project-roles-section">
          <SectionCard
            eyebrow="AUTHORIZATION"
            title={locale === 'ko' ? '권한' : 'Roles'}
            icon={Shield}
          >
            <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">
              {locale === 'ko'
                ? '로그인 계정의 이 프로젝트 권한입니다. 권한을 주면 위 명단에도 자동으로 추가되고, 역할을 조회(해제)로 바꾸면 권한이 삭제됩니다.'
                : 'Project permissions for login accounts. Granting a role also adds the person to the roster above; setting the role to Viewer removes the permission.'}
            </p>
            {roles && (roles.ok ? (
              <ProjectRolesManager
                projectId={projectId}
                rows={roles.rows}
                canManageAdmins={isSuperuser}
              />
            ) : (
              <p className="text-sm text-delayed">{roles.error}</p>
            ))}
            <div className="mt-6 border-t border-line pt-5">
              <ProjectInviteManager
                projectId={projectId}
                rows={invites?.ok ? invites.rows : []}
                loadError={invites && !invites.ok ? invites.error : null}
              />
            </div>
          </SectionCard>
          </div>
        )}
      </div>
    </ProjectPageShell>
  )
}
