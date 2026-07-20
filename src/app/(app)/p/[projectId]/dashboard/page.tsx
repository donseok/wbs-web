import { after } from 'next/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { getSnapshots, recordProgressSnapshot } from '@/lib/data/snapshots'
import { getAnnouncements } from '@/lib/data/announcements'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getProjectMinuteSignals } from '@/lib/data/minutes'
import { getProjectAiBriefs, briefFrom } from '@/lib/data/aiBriefs'
import { listProjects } from '@/app/actions/project'
import { getMembership, getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero } from '@/components/ui/PageHero'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

export default async function Dashboard({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const locale = await getServerLocale()
  const [{ items, holidays, today }, projects, announcements, snapshots, meetingData, minuteSignals, briefs, sb, user, membership] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getAnnouncements(projectId),
    getSnapshots(projectId),
    getProjectMeetingData(projectId),
    // limit 30 — 위험 신호 탐지(회의 액션 경과)가 최근 8건보다 넓은 창을 봐야 해서 상향.
    // 협업 카드 표시는 DashboardView가 기존 8건으로 잘라 밀도를 유지한다.
    getProjectMinuteSignals(projectId, 30),
    // risk·weekly 를 한 왕복으로 받는다. weekly 캐시 키가 today(base_date 우선)라 예전엔
    // getComputedWbs 이후 후속 1회 조회가 필요했고, 그게 대시보드의 유일한 직렬 2단째였다.
    getProjectAiBriefs(projectId),
    createServerClient(),
    // 회의 카드에서 '작성자 본인이면 수정' 판정에 쓰는 식별자 — 기존 배치에 얹어 직렬 왕복을 늘리지 않는다.
    getSession(),
    getMembership(),
  ])
  const riskBriefRow = briefFrom(briefs, 'risk', '')
  const weeklyBriefRow = briefFrom(briefs, 'weekly', today)
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
        weeklyBriefRow={weeklyBriefRow}
        riskBriefRow={riskBriefRow}
        currentUserId={user?.id ?? null}
        role={membership?.role ?? null}
      />
    </ProjectPageShell>
  )
}
