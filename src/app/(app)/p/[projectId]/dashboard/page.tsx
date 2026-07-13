import { after } from 'next/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { getSnapshots, recordProgressSnapshot } from '@/lib/data/snapshots'
import { getAnnouncements } from '@/lib/data/announcements'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getProjectMinuteSignals } from '@/lib/data/minutes'
import { listProjects } from '@/app/actions/project'
import { createServerClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero } from '@/components/ui/PageHero'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

export default async function Dashboard({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const locale = await getServerLocale()
  const [{ items, holidays, today }, projects, announcements, snapshots, meetingData, minuteSignals, sb] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getAnnouncements(projectId),
    getSnapshots(projectId),
    getProjectMeetingData(projectId),
    getProjectMinuteSignals(projectId),
    createServerClient(),
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
        minuteSignals={minuteSignals}
      />
    </ProjectPageShell>
  )
}
