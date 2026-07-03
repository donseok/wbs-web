import { CalendarClock, CalendarCheck, CalendarRange } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getMyMeetings } from '@/lib/data/meetings'
import { expandMeetings, summarizeMeetings } from '@/lib/domain/meetings'
import { getMembership, getSession } from '@/lib/auth'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { MyMeetingsView } from '@/components/meetings/MyMeetingsView'

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

export default async function MyMeetingsPage() {
  const today = seoulToday()
  const [gs, ge] = monthGrid(today)
  const [{ meetings, exceptions }, m, user, locale] = await Promise.all([
    getMyMeetings(gs, ge),
    getMembership(),
    getSession(),
    getServerLocale(),
  ])
  const mineOcc = expandMeetings(meetings.filter(x => x.isMine), exceptions, gs, ge)
  const { today: todayN, upcoming7d, total } = summarizeMeetings(mineOcc, today)

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="MY MEETINGS"
        badge={<HeroBadge>My Meetings</HeroBadge>}
        title={t(locale, 'meet.myHeroTitle')}
        description={t(locale, 'meet.myHeroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TODAY" value={todayN} sub={t(locale, 'meet.kpi.todaySub')} icon={CalendarCheck} tone="brand" />
            <KpiCard variant="hero" label="NEXT 7 DAYS" value={upcoming7d} sub={t(locale, 'meet.kpi.upcomingSub')} icon={CalendarClock} tone="warning" />
            <KpiCard variant="hero" label="THIS MONTH" value={total} sub={t(locale, 'meet.kpi.totalSub')} icon={CalendarRange} tone="success" />
          </>
        }
      />}
    >
      <MyMeetingsView initialMeetings={meetings} initialExceptions={exceptions}
        todayIso={today} currentUserId={user?.id ?? null} role={m?.role ?? null} />
    </ProjectPageShell>
  )
}
