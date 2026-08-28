import { after } from 'next/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { getSnapshots, recordProgressSnapshot } from '@/lib/data/snapshots'
import { getAnnouncements } from '@/lib/data/announcements'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getIssuesForDashboard } from '@/lib/data/issues'
import { getProjectConfig } from '@/lib/data/projectConfig'
import { listProjects } from '@/app/actions/project'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { effectiveLegacyRole, isProjectAdmin } from '@/lib/domain/authz'
import { createServerClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero } from '@/components/ui/PageHero'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

export default async function Dashboard({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const locale = await getServerLocale()
  const [{ items, holidays, today }, projects, announcements, snapshots, meetingData, issues, sb, user, membership, config] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getAnnouncements(projectId),
    getSnapshots(projectId),
    getProjectMeetingData(projectId),
    // 이슈 현황 카드 — issues 단일 쿼리 슬라이스. 같은 배치에 얹어 직렬 왕복을 늘리지 않는다.
    getIssuesForDashboard(projectId),
    createServerClient(),
    // 회의 카드에서 '작성자 본인이면 수정' 판정에 쓰는 식별자 — 기존 배치에 얹어 직렬 왕복을 늘리지 않는다.
    getSession(),
    getActorForView(),
    // 마일스톤 키워드 등 프로젝트 설정(project_settings) — 0058 시드 덕에 값은 LEGACY_MILESTONE_KEYWORDS와 동일(회귀 0).
    getProjectConfig(projectId),
  ])
  // 보험 스냅샷 — 응답 전송 후 실행. 페이지의 after() 안에서는 cookies() 호출이 불가하므로
  // supabase 클라이언트를 미리 만들어 넘긴다(서버 액션 훅과 달리 이 경로만 client 인자 사용).
  after(() => recordProgressSnapshot(projectId, sb))

  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'dash.heroProjectFallback')

  return (
    <ProjectPageShell
      hero={<PageHero title={`${projectName}${t(locale, 'dash.heroTitleSuffix')}`} />}
    >
      <DashboardView
        items={items}
        projectId={projectId}
        projectName={projectName}
        projectDescription={project?.description}
        startDate={project?.start_date ?? null}
        endDate={project?.end_date ?? null}
        today={today}
        holidays={holidays}
        snapshots={snapshots}
        announcements={announcements}
        meetings={meetingData.meetings}
        meetingExceptions={meetingData.exceptions}
        issues={issues}
        currentUserId={user?.id ?? null}
        role={effectiveLegacyRole(membership, projectId)}
        canGenerateBrief={isProjectAdmin(membership, projectId)}
        milestoneKeywords={config.milestoneKeywords}
      />
    </ProjectPageShell>
  )
}
