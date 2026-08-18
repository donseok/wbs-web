import { getIssues } from '@/lib/data/issues'
import { getProjectMembers } from '@/lib/data/members'
import { resolveMemberIds } from '@/lib/data/meetings'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { effectiveLegacyRole } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { createServerClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { IssuesView } from '@/components/issues/IssuesView'
import { seoulToday } from '@/lib/domain/dates'

export default async function IssuesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [issues, members, m, projects, locale, { user, myMemberIds }] = await Promise.all([
    getIssues(projectId),
    getProjectMembers(projectId),
    getActorForView(),
    listProjects(),
    getServerLocale(),
    // '내 담당' 필터용 — user_id+email 이중 매칭(meetings 관례). 비로그인은 빈 배열.
    // resolveMemberIds 는 getSession 의 user 인자가 필요한 진짜 의존이라 체인은 유지하되,
    // 체인 전체를 Promise.all 의 한 항목으로 태워 다른 독립 조회와 왕복을 겹친다(직렬 2단 → 1단).
    (async () => {
      const user = await getSession()
      const myMemberIds = user ? await resolveMemberIds(await createServerClient(), user) : []
      return { user, myMemberIds }
    })(),
  ])

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
        role={effectiveLegacyRole(m, projectId)}
        myMemberIds={myMemberIds}
        today={seoulToday()}
      />
    </ProjectPageShell>
  )
}
