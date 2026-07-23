import { getIssues } from '@/lib/data/issues'
import { getProjectMembers } from '@/lib/data/members'
import { resolveMemberIds } from '@/lib/data/meetings'
import { getMembership, getSession } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { createServerClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { IssuesView } from '@/components/issues/IssuesView'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export default async function IssuesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [issues, members, m, user, projects, locale] = await Promise.all([
    getIssues(projectId),
    getProjectMembers(projectId),
    getMembership(),
    getSession(),
    listProjects(),
    getServerLocale(),
  ])
  // '내 담당' 필터용 — user_id+email 이중 매칭(meetings 관례). 비로그인은 빈 배열.
  const myMemberIds = user ? await resolveMemberIds(await createServerClient(), user) : []

  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'issue.projectFallback')

  return (
    <ProjectPageShell
      hero={
        <PageHero
          eyebrow="ISSUES"
          badge={<HeroBadge>Issue Tracker</HeroBadge>}
          title={`${projectName} ${t(locale, 'issue.heroTitleSuffix')}`}
          description={t(locale, 'issue.heroDesc')}
        />
      }
    >
      <IssuesView
        issues={issues}
        members={members}
        projectId={projectId}
        currentUserId={user?.id ?? null}
        role={m?.role ?? null}
        myMemberIds={myMemberIds}
        today={seoulToday()}
      />
    </ProjectPageShell>
  )
}
