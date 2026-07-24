'use client'
import { useMemo } from 'react'
import type { Minute } from '@/lib/domain/types'
import { monthMatrix } from '@/lib/domain/attendance'
import { krSpecialDayMap } from '@/lib/domain/holidays'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { teamStyle } from '@/components/wbs/shared'

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function dowClass(dow: number, base = 'text-ink') {
  if (dow === 0) return 'text-delayed'
  if (dow === 6) return 'text-progress'
  return base
}

export function MinutesCalendar({
  year, month0, todayIso, minutes, onSelectDate, selectedDate,
}: {
  year: number
  month0: number
  todayIso: string
  minutes: Minute[]
  onSelectDate: (dateIso: string) => void
  selectedDate: string | null
}) {
  const { t } = useLocale()
  const matrix = useMemo(() => monthMatrix(year, month0), [year, month0])
  const byDate = useMemo(() => {
    const map = new Map<string, Minute[]>()
    for (const mi of minutes) {
      const arr = map.get(mi.minuteDate) ?? []
      arr.push(mi); map.set(mi.minuteDate, arr)
    }
    return map
  }, [minutes])
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
          const rows = byDate.get(cell) ?? []
          const special = specialDays.get(cell)
          const isRestDay = !!special && special.kind !== 'anniversary'
          const isSelected = cell === selectedDate
          return (
            <button key={cell} type="button" onClick={() => rows.length && onSelectDate(cell)}
              className={`min-h-[92px] bg-surface p-1.5 text-left ${inMonth ? '' : 'opacity-40'} ${isSelected ? 'ring-2 ring-inset ring-brand-ring' : ''} ${rows.length ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default'}`}>
              <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${isToday ? 'bg-brand text-white' : isRestDay ? 'text-delayed' : dowClass(dow)}`}>
                {dayNum}
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {rows.slice(0, 4).map(mi => (
                  <span key={mi.id}
                    className={`inline-flex items-center rounded px-1 py-px text-[10px] font-bold text-white ${teamStyle(mi.teamCode).bar}`}>
                    {mi.teamCode}
                  </span>
                ))}
                {rows.length > 4 && (
                  <span className="text-[10px] font-medium text-ink-subtle">+{rows.length - 4}</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
