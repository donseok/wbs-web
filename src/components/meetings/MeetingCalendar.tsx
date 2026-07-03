'use client'

import { useMemo } from 'react'
import type { MeetingOccurrence } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { monthMatrix } from '@/lib/domain/attendance'
import { occurrencesByDate, sortOccurrences, MEETING_META } from '@/lib/domain/meetings'
import { krSpecialDayMap } from '@/lib/domain/holidays'

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function dowClass(dow: number, base = 'text-ink') {
  if (dow === 0) return 'text-delayed'
  if (dow === 6) return 'text-progress'
  return base
}

export function MeetingCalendar({
  year, month0, todayIso, occurrences, onSelectOccurrence,
}: {
  year: number
  month0: number
  todayIso: string
  occurrences: MeetingOccurrence[]
  onSelectOccurrence: (o: MeetingOccurrence) => void
}) {
  const { t } = useLocale()
  const matrix = useMemo(() => monthMatrix(year, month0), [year, month0])
  const byDate = useMemo(() => occurrencesByDate(occurrences), [occurrences])
  const specialDays = useMemo(
    () => krSpecialDayMap(matrix.flat().map(cell => Number(cell.slice(0, 4)))),
    [matrix],
  )
  const ym = `${year}-${String(month0 + 1).padStart(2, '0')}`

  return (
    <div className="card overflow-hidden p-0">
      <div className="grid grid-cols-7 gap-px bg-line">
        {WEEKDAY_KEYS.map((w, i) => (
          <div key={w} className={`bg-surface-2 py-2 text-center text-[11px] font-semibold ${dowClass(i, 'text-ink-muted')}`}>
            {t(`att.weekday.${w}` as DictKey)}
          </div>
        ))}
        {matrix.flat().map((cell, idx) => {
          const dow = idx % 7
          const inMonth = cell.startsWith(ym)
          const isToday = cell === todayIso
          const dayNum = Number(cell.slice(8, 10))
          const dayOcc = sortOccurrences(byDate[cell] ?? [])
          const special = specialDays.get(cell)
          const isRestDay = !!special && special.kind !== 'anniversary'
          const specialName = special ? t(`hol.${special.name}` as DictKey) : null
          return (
            <div key={cell} className={`min-h-[104px] bg-surface p-1.5 ${inMonth ? '' : 'opacity-40'}`}>
              <div className="flex items-center justify-between gap-1 px-0.5">
                <span className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${isToday ? 'bg-brand text-white' : isRestDay ? 'text-delayed' : dowClass(dow)}`}>
                  {dayNum}
                </span>
                {specialName && (
                  <span className={`min-w-0 truncate text-[10px] font-medium ${isRestDay ? 'text-delayed' : 'text-ink-subtle'}`} title={specialName}>
                    {specialName}
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-1">
                {dayOcc.slice(0, 3).map(o => {
                  const meta = MEETING_META[o.category]
                  const timeLabel = o.startTime ?? t('meet.allDay')
                  return (
                    <button
                      key={o.occurrenceId}
                      onClick={() => onSelectOccurrence(o)}
                      className={`flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[10.5px] font-medium ${meta.chip} cursor-pointer transition hover:ring-1 hover:ring-brand-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring`}
                      title={`${timeLabel} · ${o.title}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                      <span className="shrink-0 tabular-nums opacity-80">{timeLabel}</span>
                      <span className="truncate">{o.title}</span>
                    </button>
                  )
                })}
                {dayOcc.length > 3 && (
                  <div className="px-1 text-[10px] font-medium text-ink-subtle">+{dayOcc.length - 3}{t('meet.moreSuffix')}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
