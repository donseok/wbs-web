import Link from 'next/link'
import { CalendarDays, ArrowRight } from 'lucide-react'
import type { Meeting, MeetingException } from '@/lib/domain/types'
import { expandMeetings, occurrencesByDate, sortOccurrences, summarizeMeetings } from '@/lib/domain/meetings'
import { SectionCard } from '@/components/ui/SectionCard'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { CountBadge, MiniEmpty, addDaysIso } from './bits'
import { MeetingScheduleList } from './MeetingScheduleList'

/** 리스트 표시 상한 — 카드 높이를 근태 카드와 비슷하게 유지한다. */
const MAX_ROWS = 10
/** 전개 범위(오늘 포함 14일) — 근태 카드와 동일 창. */
const WINDOW_DAYS = 14

/** 향후 2주 회의 일정 — 날짜순 리스트. */
export async function MeetingSchedule({ projectId, meetings, exceptions, today, currentUserId = null, role = null }: {
  projectId: string
  meetings: Meeting[]
  exceptions: MeetingException[]
  today: string
  /** 작성자 본인(또는 pmo_admin)에게 상세 모달의 수정·삭제를 열기 위한 식별자. */
  currentUserId?: string | null
  role?: string | null
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  const windowEnd = addDaysIso(today, WINDOW_DAYS - 1)
  const occ = expandMeetings(meetings, exceptions, today, windowEnd)
  const sorted = Object.entries(occurrencesByDate(occ))
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, dayOcc]) => sortOccurrences(dayOcc))
  const s = summarizeMeetings(occ, today)
  const rows = sorted.slice(0, MAX_ROWS)

  return (
    <SectionCard
      eyebrow="MEETINGS" title={tr('dash.meet.title')} icon={CalendarDays}
      actions={<CountBadge n={s.total} unit={tr('dash.unitCount')} />}
    >
      <div className="space-y-4">
        {rows.length === 0 ? (
          <MiniEmpty text={tr('dash.meet.empty')} />
        ) : (
          <MeetingScheduleList rows={rows} today={today} currentUserId={currentUserId} role={role} />
        )}
        <Link href={`/p/${projectId}/meetings`} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
          {tr('dash.viewAll')} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </SectionCard>
  )
}
