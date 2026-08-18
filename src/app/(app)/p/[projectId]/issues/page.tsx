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
  // '내 담당' 필터용 멤버 ID 는 user 에만 의존한다 — 메인 로드가 다 끝나길 기다렸다가 직렬로
  // 한 왕복을 더 도는 대신, user 프라미스에 체이닝해 같은 Promise.all 에 태운다(meetings 관례).
  const userPromise = getSession()
  const [issues, members, m, user, projects, locale, myMemberIds] = await Promise.all([
    getIssues(projectId),
    getProjectMembers(projectId),
    getActorForView(),
    userPromise,
    listProjects(),
    getServerLocale(),
    // user_id+email 이중 매칭(meetings 관례). 비로그인은 빈 배열.
    userPromise.then(async u => (u ? resolveMemberIds(await createServerClient(), u) : [])),
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
