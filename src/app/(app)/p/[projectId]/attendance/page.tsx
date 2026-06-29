import { CalendarCheck, CalendarOff, PlaneTakeoff } from 'lucide-react'
import { getAttendanceRecords } from '@/lib/data/attendance'
import { getProjectMembers } from '@/lib/data/members'
import { getMembership } from '@/lib/auth'
import { DEMO, DEMO_TODAY } from '@/lib/demo'
import { summarize } from '@/lib/domain/attendance'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { AttendanceView } from '@/components/attendance/AttendanceView'

export default async function AttendancePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [records, members, m] = await Promise.all([
    getAttendanceRecords(projectId),
    getProjectMembers(projectId),
    getMembership(),
  ])
  const today = DEMO
    ? DEMO_TODAY
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  const s = summarize(records)

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="ATTENDANCE"
        badge={<HeroBadge>Attendance</HeroBadge>}
        title="근태현황"
        description="프로젝트 멤버의 출결 상태를 캘린더와 리스트로 한눈에 확인하세요."
        aside={
          <>
            <KpiCard label="TOTAL RECORDS" value={s.total} sub="전체 근태 기록" icon={CalendarCheck} />
            <KpiCard label="LEAVE DAYS" value={s.leave} sub="연차·반차·병가" icon={CalendarOff} tone="brand" />
            <KpiCard label="BUSINESS TRIP" value={s.trip} sub="출장 일정" icon={PlaneTakeoff} tone="warning" />
          </>
        }
      />
      <AttendanceView
        projectId={projectId}
        records={records}
        members={members}
        initialDate={today}
        canEdit={m?.role === 'pmo_admin' && !DEMO}
      />
    </div>
  )
}
