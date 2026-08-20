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
        {/* 카드 보드는 2026-08-20 통합에서 은퇴 — 명단 정보(팀·구분·직함)까지 아래 표에서 직접 편집한다. */}
        {canEdit && (
          <div id="project-roles-section">
          <SectionCard
            eyebrow="TEAM & AUTHORIZATION"
            title={locale === 'ko' ? '참여자 · 권한' : 'Participants & Roles'}
            icon={Shield}
          >
            <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">
              {locale === 'ko'
                ? '이 프로젝트의 참여자 명단과 로그인 권한을 한 곳에서 관리합니다. 권한을 주면 명단에 자동 등록되고, 프로젝트 팀·명단 구분·직함은 각 행의 연필 버튼으로 수정합니다.'
                : 'Manage the participant roster and login permissions in one place. Granting a role also registers the person on the roster; edit project team, roster type, and title via the pencil button on each row.'}
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
        {/* 비관리자 — 권한 조회는 관리자 전용이라 읽기 전용 명단만 보여준다(조회 실패 위장 아님, 권한 게이트). */}
        {!canEdit && (
          <SectionCard
            eyebrow="TEAM"
            title={locale === 'ko' ? '참여자 명단' : 'Participants'}
            icon={Users}
          >
            {members.length === 0 ? (
              <p className="text-sm text-ink-subtle">{t(locale, 'members.emptyTitle')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                      <th className="py-2 pr-3">{locale === 'ko' ? '이름' : 'Name'}</th>
                      <th className="py-2 pr-3">{locale === 'ko' ? '이메일' : 'Email'}</th>
                      <th className="py-2 pr-3">{locale === 'ko' ? '프로젝트 팀' : 'Project team'}</th>
                      <th className="py-2 pr-3">{locale === 'ko' ? '명단 구분' : 'Type'}</th>
                      <th className="py-2 pr-3">{locale === 'ko' ? '직함 / 역할' : 'Title / Role'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(mem => (
                      <tr key={mem.id} className="border-b border-line/60">
                        <td className="py-2.5 pr-3 font-medium text-ink">{mem.name}</td>
                        <td className="py-2.5 pr-3 text-ink-muted">{mem.email ?? '—'}</td>
                        <td className="py-2.5 pr-3">
                          {mem.teamCode ? <span className="chip bg-surface-2 text-ink-muted">{mem.teamCode}</span> : <span className="text-ink-subtle">—</span>}
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-ink-muted">
                          {mem.role === 'admin' ? (locale === 'ko' ? '리더' : 'Lead') : (locale === 'ko' ? '실무' : 'Contributor')}
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-ink-muted">
                          {mem.title ?? '—'}{mem.roleLabel ? ` · ${mem.roleLabel}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        )}
      </div>
    </ProjectPageShell>
  )
}
