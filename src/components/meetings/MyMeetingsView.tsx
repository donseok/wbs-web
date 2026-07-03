'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, CalendarDays, List, CalendarX2 } from 'lucide-react'
import type { Meeting, MeetingException, MeetingOccurrence } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { fmtDate } from '@/components/wbs/shared'
import { expandMeetings, sortOccurrences, MEETING_META } from '@/lib/domain/meetings'
import { MeetingCalendar } from './MeetingCalendar'
import { MeetingDetailModal } from './MeetingDetailModal'
import { fetchMyMeetings } from '@/app/actions/meetings'

type ViewKey = 'calendar' | 'list'

function gridRange(year: number, month0: number): [string, string] {
  const first = new Date(Date.UTC(year, month0, 1)); const dow = first.getUTCDay()
  const s = new Date(Date.UTC(year, month0, 1 - dow)); const e = new Date(Date.UTC(year, month0, 1 - dow + 41))
  const f = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return [f(s), f(e)]
}

export function MyMeetingsView({
  initialMeetings, initialExceptions, todayIso, currentUserId, role,
}: {
  initialMeetings: Meeting[]
  initialExceptions: MeetingException[]
  todayIso: string
  currentUserId: string | null
  role: string | null
}) {
  const router = useRouter()
  const { t, locale } = useLocale()
  const [initY, initM] = useMemo(() => todayIso.split('-').map(Number), [todayIso])
  const [year, setYear] = useState(initY)
  const [month0, setMonth0] = useState((initM || 1) - 1)
  const [view, setView] = useState<ViewKey>('calendar')
  const [onlyMine, setOnlyMine] = useState(true)
  const [data, setData] = useState({ meetings: initialMeetings, exceptions: initialExceptions })
  const [detailOcc, setDetailOcc] = useState<MeetingOccurrence | null>(null)
  const [pending, startTransition] = useTransition()

  const [gridStart, gridEnd] = useMemo(() => gridRange(year, month0), [year, month0])

  // 월 이동 시 서버 액션 재조회(현재 달이 아니면). 초기 달은 서버 렌더 데이터 사용.
  const isInitialMonth = year === initY && month0 === (initM || 1) - 1
  useEffect(() => {
    if (isInitialMonth) { setData({ meetings: initialMeetings, exceptions: initialExceptions }); return }
    let alive = true
    startTransition(async () => {
      const res = await fetchMyMeetings(gridStart, gridEnd)
      if (alive) setData(res)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridStart, gridEnd])

  const filteredMeetings = useMemo(
    () => onlyMine ? data.meetings.filter(m => m.isMine) : data.meetings,
    [data.meetings, onlyMine],
  )
  const occurrences = useMemo(
    () => expandMeetings(filteredMeetings, data.exceptions, gridStart, gridEnd),
    [filteredMeetings, data.exceptions, gridStart, gridEnd],
  )
  const cancelledSet = useMemo(
    () => new Set(data.exceptions.filter(e => e.kind === 'cancelled').map(e => `${e.meetingId}:${e.occurrenceDate}`)),
    [data.exceptions],
  )
  const listRows = useMemo(() => sortOccurrences(occurrences).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate)), [occurrences])

  function shift(delta: number) {
    const base = new Date(Date.UTC(year, month0 + delta, 1))
    setYear(base.getUTCFullYear()); setMonth0(base.getUTCMonth())
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="chrome-icon" aria-label={t('meet.prevMonth')}><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[116px] text-center text-base font-bold tabular-nums text-ink">
            {new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: locale === 'ko' ? 'numeric' : 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month0, 1)))}
          </div>
          <button onClick={() => shift(1)} className="chrome-icon" aria-label={t('meet.nextMonth')}><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => { setYear(initY); setMonth0((initM || 1) - 1) }} className="btn btn-ghost h-10">{t('meet.today')}</button>
          {pending && <span className="text-xs text-ink-subtle">…</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs<'mine' | 'all'>
            tabs={[{ key: 'mine', label: t('meet.onlyMine') }, { key: 'all', label: t('meet.allProjects') }]}
            value={onlyMine ? 'mine' : 'all'} onChange={k => setOnlyMine(k === 'mine')} size="sm"
          />
          <SegmentedTabs<ViewKey>
            tabs={[{ key: 'calendar', label: t('meet.view.calendar'), icon: CalendarDays }, { key: 'list', label: t('meet.view.list'), icon: List }]}
            value={view} onChange={setView} size="sm"
          />
        </div>
      </div>

      {view === 'calendar' ? (
        <MeetingCalendar year={year} month0={month0} todayIso={todayIso} occurrences={occurrences} onSelectOccurrence={setDetailOcc} />
      ) : listRows.length === 0 ? (
        <EmptyState icon={CalendarX2}
          title={onlyMine ? t('meet.empty.mineTitle') : t('meet.empty.title')}
          description={onlyMine ? t('meet.empty.mineDesc') : t('meet.empty.desc')} />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                  <th className="px-4 py-3">{t('meet.col.date')}</th>
                  <th className="px-4 py-3">{t('meet.col.time')}</th>
                  <th className="px-4 py-3">{t('meet.col.title')}</th>
                  <th className="px-4 py-3">{t('meet.col.project')}</th>
                  <th className="px-4 py-3">{t('meet.col.category')}</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map(o => {
                  const meta = MEETING_META[o.category]
                  return (
                    <tr key={o.occurrenceId} onClick={() => setDetailOcc(o)} role="button" tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') setDetailOcc(o) }}
                      className="cursor-pointer border-b border-line/70 last:border-0 transition hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2">
                      <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-ink">{fmtDate(o.occurrenceDate)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-muted">{o.startTime ?? t('meet.allDay')}</td>
                      <td className="px-4 py-3 text-ink">{o.title}</td>
                      <td className="px-4 py-3 text-ink-muted">{o.projectName ?? '-'}</td>
                      <td className="px-4 py-3"><span className={`chip ${meta.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{t(meta.labelKey as DictKey)}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <MeetingDetailModal open={!!detailOcc} occurrence={detailOcc}
        isCancelled={detailOcc ? cancelledSet.has(detailOcc.occurrenceId) : false}
        currentUserId={currentUserId} role={role}
        onClose={() => setDetailOcc(null)} onEditSeries={() => { /* 내 회의에서는 편집 시 프로젝트로 이동 유도 */ }}
        onChanged={() => router.refresh()} />
    </div>
  )
}
