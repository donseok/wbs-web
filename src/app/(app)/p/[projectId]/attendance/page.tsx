import { CalendarCheck, CalendarOff, PlaneTakeoff } from 'lucide-react'
import { getAttendanceRecords } from '@/lib/data/attendance'
import { getProjectMembers } from '@/lib/data/members'
import { getMembership } from '@/lib/auth'
import { summarize } from '@/lib/domain/attendance'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { AttendanceView } from '@/components/attendance/AttendanceView'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

export default async function AttendancePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [records, members, m] = await Promise.all([
    getAttendanceRecords(projectId),
    getProjectMembers(projectId),
    getMembership(),
  ])
  const locale = await getServerLocale()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  const s = summarize(records)

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="ATTENDANCE"
        badge={<HeroBadge>Attendance</HeroBadge>}
        title={t(locale, 'att.title')}
        description={t(locale, 'att.desc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TOTAL RECORDS" value={s.total} sub={t(locale, 'att.kpi.totalSub')} icon={CalendarCheck} />
            <KpiCard variant="hero" label="LEAVE DAYS" value={s.leave} sub={t(locale, 'att.kpi.leaveSub')} icon={CalendarOff} tone="brand" />
            <KpiCard variant="hero" label="BUSINESS TRIP" value={s.trip} sub={t(locale, 'att.kpi.tripSub')} icon={PlaneTakeoff} tone="warning" />
          </>
        }
      />}
    >
      <AttendanceView
        projectId={projectId}
        records={records}
        members={members}
        initialDate={today}
        canEdit={m?.role === 'pmo_admin'}
      />
    </ProjectPageShell>
  )
}
