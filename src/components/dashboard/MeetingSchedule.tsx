import Link from 'next/link'
import { CalendarDays, ArrowRight } from 'lucide-react'
import type { Meeting, MeetingException } from '@/lib/domain/types'
import { MEETING_META, expandMeetings, occurrencesByDate, sortOccurrences, summarizeMeetings } from '@/lib/domain/meetings'
import { SectionCard } from '@/components/ui/SectionCard'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { CountBadge, DateCell, MiniEmpty, Stat, addDaysIso, weekdayKey } from './bits'

/** 리스트 표시 상한 — 카드 높이를 근태 카드와 비슷하게 유지한다. */
const MAX_ROWS = 6
/** 전개 범위(오늘 포함 14일) — 근태 카드와 동일 창. */
const WINDOW_DAYS = 14

/** 향후 2주 회의 일정 — 오늘/7일/14일 스탯 + 날짜순 리스트. */
export async function MeetingSchedule({ projectId, meetings, exceptions, today }: {
  projectId: string
  meetings: Meeting[]
  exceptions: MeetingException[]
  today: string
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
        <div className="grid grid-cols-3 gap-3">
          <Stat label={tr('dash.meet.statToday')} value={`${s.today}${tr('dash.unitCount')}`}
            tone={s.today > 0 ? 'text-brand' : undefined} />
          <Stat label={tr('dash.meet.stat7d')} value={`${s.upcoming7d}${tr('dash.unitCount')}`} />
          <Stat label={tr('dash.meet.stat14d')} value={`${s.total}${tr('dash.unitCount')}`} />
        </div>
        {rows.length === 0 ? (
          <MiniEmpty text={tr('dash.meet.empty')} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map(o => {
              const meta = MEETING_META[o.category]
              return (
                <li key={o.occurrenceId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <DateCell date={o.occurrenceDate} isToday={o.occurrenceDate === today}
                    todayLabel={tr('dash.today')} weekday={tr(weekdayKey(o.occurrenceDate))} />
                  <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink" title={o.title}>{o.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-muted">
                      {o.startTime && (
                        <span className="tabular-nums">
                          {o.startTime.slice(0, 5)}{o.endTime ? `–${o.endTime.slice(0, 5)}` : ''}
                        </span>
                      )}
                      {o.location && <span className="truncate">{o.location}</span>}
                    </div>
                  </div>
                  <span className={`badge shrink-0 ${meta.chip}`}>{tr(meta.labelKey)}</span>
                </li>
              )
            })}
          </ul>
        )}
        <Link href={`/p/${projectId}/meetings`} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
          {tr('dash.viewAll')} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </SectionCard>
  )
}
