import { CalendarClock, CalendarCheck, CalendarPlus } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getProjectMembers } from '@/lib/data/members'
import { expandMeetings, summarizeMeetings } from '@/lib/domain/meetings'
import { getMembership, getSession } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { MeetingsView } from '@/components/meetings/MeetingsView'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
function monthGrid(todayIso: string): [string, string] {
  const [y, m] = todayIso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)); const dow = first.getUTCDay()
  const s = new Date(Date.UTC(y, m - 1, 1 - dow)); const e = new Date(Date.UTC(y, m - 1, 1 - dow + 41))
  const f = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return [f(s), f(e)]
}

export default async function MeetingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const today = seoulToday()
  const [{ meetings, exceptions }, members, m, user, projects, locale] = await Promise.all([
    getProjectMeetingData(projectId),
    getProjectMembers(projectId),
    getMembership(),
    getSession(),
    listProjects(),
    getServerLocale(),
  ])
  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? ''
  const [gs, ge] = monthGrid(today)
  const monthOcc = expandMeetings(meetings, exceptions, gs, ge)
  const { today: todayN, upcoming7d, total } = summarizeMeetings(monthOcc, today)

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="MEETINGS"
        badge={<HeroBadge>Meetings</HeroBadge>}
        title={`${projectName} ${t(locale, 'meet.heroTitleSuffix')}`}
        description={t(locale, 'meet.heroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TODAY" value={todayN} sub={t(locale, 'meet.kpi.todaySub')} icon={CalendarCheck} tone="brand" />
            <KpiCard variant="hero" label="NEXT 7 DAYS" value={upcoming7d} sub={t(locale, 'meet.kpi.upcomingSub')} icon={CalendarClock} tone="warning" />
            <KpiCard variant="hero" label="THIS MONTH" value={total} sub={t(locale, 'meet.kpi.totalSub')} icon={CalendarPlus} tone="success" />
          </>
        }
      />}
    >
      <MeetingsView projectId={projectId} meetings={meetings} exceptions={exceptions} members={members}
        todayIso={today} currentUserId={user?.id ?? null} role={m?.role ?? null} />
    </ProjectPageShell>
  )
}
