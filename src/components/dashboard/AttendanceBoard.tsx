import Link from 'next/link'
import { CalendarCheck, ArrowRight } from 'lucide-react'
import type { AttendanceRecord, ProjectMember } from '@/lib/domain/types'
import { ATTENDANCE_META, summarize } from '@/lib/domain/attendance'
import { SectionCard } from '@/components/ui/SectionCard'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { CountBadge, DateCell, MiniEmpty, Stat, addDaysIso, weekdayKey } from './bits'

/** 리스트 표시 상한 — 회의 카드와 좌우 균형을 맞춘다. */
const MAX_ROWS = 6
/** 표시 범위(오늘 포함 14일) — 회의 카드와 동일 창. */
const WINDOW_DAYS = 14

/** 향후 2주 근태 — 오늘 휴가/출장/재택 스탯 + 자리비움 예정 리스트('정상근무' 기록은 제외). */
export async function AttendanceBoard({ projectId, records, members, today }: {
  projectId: string
  records: AttendanceRecord[]
  members: ProjectMember[]
  today: string
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  const windowEnd = addDaysIso(today, WINDOW_DAYS - 1)
  const nameOf = new Map(members.map(m => [m.id, m.name]))
  const upcoming = records
    .filter(r => r.type !== 'work' && r.date >= today && r.date <= windowEnd)
    .sort((a, b) => a.date.localeCompare(b.date)
      || (nameOf.get(a.memberId) ?? '').localeCompare(nameOf.get(b.memberId) ?? ''))
  const s = summarize(upcoming.filter(r => r.date === today))
  const rows = upcoming.slice(0, MAX_ROWS)

  return (
    <SectionCard
      eyebrow="ATTENDANCE" title={tr('dash.att.title')} icon={CalendarCheck}
      actions={<CountBadge n={upcoming.length} unit={tr('dash.unitCount')} />}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label={tr('dash.att.statLeave')} value={`${s.leave}${tr('dash.unitPeople')}`}
            tone={s.leave > 0 ? 'text-progress' : undefined} />
          <Stat label={tr('dash.att.statTrip')} value={`${s.trip}${tr('dash.unitPeople')}`}
            tone={s.trip > 0 ? 'text-accent-secondary' : undefined} />
          <Stat label={tr('dash.att.statRemote')} value={`${s.remote}${tr('dash.unitPeople')}`}
            tone={s.remote > 0 ? 'text-brand' : undefined} />
        </div>
        {rows.length === 0 ? (
          <MiniEmpty text={tr('dash.att.empty')} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map(r => {
              const meta = ATTENDANCE_META[r.type]
              const name = nameOf.get(r.memberId) ?? tr('att.unknown')
              return (
                <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <DateCell date={r.date} isToday={r.date === today}
                    todayLabel={tr('dash.today')} weekday={tr(weekdayKey(r.date))} />
                  <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink" title={name}>{name}</div>
                    {r.note && <div className="mt-0.5 truncate text-[11px] text-ink-muted" title={r.note}>{r.note}</div>}
                  </div>
                  <span className={`badge shrink-0 ${meta.chip}`}>{tr(`att.type.${r.type}` as DictKey)}</span>
                </li>
              )
            })}
          </ul>
        )}
        <Link href={`/p/${projectId}/attendance`} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
          {tr('dash.viewAll')} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </SectionCard>
  )
}
