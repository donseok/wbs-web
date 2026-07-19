'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, CalendarDays, List, Plus, CalendarX2 } from 'lucide-react'
import type { Meeting, MeetingException, MeetingOccurrence, ProjectMember } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { fmtDate } from '@/components/wbs/shared'
import { expandMeetings, sortOccurrences, MEETING_META } from '@/lib/domain/meetings'
import { MeetingCalendar } from './MeetingCalendar'
import { MeetingFormModal } from './MeetingFormModal'
import { MeetingDetailModal } from './MeetingDetailModal'
import { useBotPageContext } from '@/components/chat/BotPageContextProvider'

const MATRIX_ROWS = 6
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
type ViewKey = 'calendar' | 'list'

/** 챗봇 딥링크(?focus=&date=)를 열 회차로 해석한다 — 유효하지 않으면 null(조용히 무시). */
function resolveFocusOccurrence(
  meetings: Meeting[],
  exceptions: MeetingException[],
  focusId: string | null,
  date: string | null,
): MeetingOccurrence | null {
  if (!focusId) return null
  const meeting = meetings.find(m => m.id === focusId)
  if (!meeting) return null
  // date가 없거나 그 날짜에 회차가 없으면(취소 등) 시리즈 기준일로 폴백.
  const candidates = [...new Set([date, meeting.meetingDate])]
    .filter((day): day is string => !!day && ISO_DAY_RE.test(day))
  for (const day of candidates) {
    const occurrence = expandMeetings([meeting], exceptions, day, day)
      .find(o => o.seriesId === focusId)
    if (occurrence) return occurrence
  }
  return null
}

function gridRange(year: number, month0: number): [string, string] {
  const first = new Date(Date.UTC(year, month0, 1))
  const startDow = first.getUTCDay()
  const start = new Date(Date.UTC(year, month0, 1 - startDow))
  const end = new Date(Date.UTC(year, month0, 1 - startDow + MATRIX_ROWS * 7 - 1))
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return [fmt(start), fmt(end)]
}

export function MeetingsView({
  projectId, meetings, exceptions, members, todayIso, currentUserId, role,
}: {
  projectId: string
  meetings: Meeting[]
  exceptions: MeetingException[]
  members: ProjectMember[]
  todayIso: string
  currentUserId: string | null
  role: string | null
}) {
  const router = useRouter()
  const { t, locale } = useLocale()
  const searchParams = useSearchParams()
  // 챗봇 딥링크는 최초 마운트에서 한 번만 소비한다 — 이후 내비게이션은 화면 상태가 소유.
  const [initialFocus] = useState(() => resolveFocusOccurrence(
    meetings, exceptions, searchParams.get('focus'), searchParams.get('date'),
  ))
  const [initY, initM] = useMemo(() => todayIso.split('-').map(Number), [todayIso])
  const [year, setYear] = useState(initialFocus ? Number(initialFocus.occurrenceDate.slice(0, 4)) : initY)
  const [month0, setMonth0] = useState(
    initialFocus ? Number(initialFocus.occurrenceDate.slice(5, 7)) - 1 : (initM || 1) - 1,
  )
  const [view, setView] = useState<ViewKey>('calendar')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Meeting | null>(null)
  const [detailOcc, setDetailOcc] = useState<MeetingOccurrence | null>(initialFocus)

  const [gridStart, gridEnd] = useMemo(() => gridRange(year, month0), [year, month0])
  useBotPageContext({
    domain: 'meetings',
    projectId,
    selectedEntity: detailOcc ? {
      type: 'meeting_occurrence',
      id: detailOcc.seriesId,
      qualifier: { occurrenceDate: detailOcc.occurrenceDate },
    } : null,
    view,
    range: { from: gridStart, to: gridEnd },
  })
  const occurrences = useMemo(
    () => expandMeetings(meetings, exceptions, gridStart, gridEnd),
    [meetings, exceptions, gridStart, gridEnd],
  )
  const listRows = useMemo(() => sortOccurrences(occurrences).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate)), [occurrences])

  function shift(delta: number) {
    const base = new Date(Date.UTC(year, month0 + delta, 1))
    setYear(base.getUTCFullYear()); setMonth0(base.getUTCMonth())
  }
  const onSaved = () => { setFormOpen(false); setEditing(null); router.refresh() }
  const openEditFromDetail = (m: Meeting) => { setDetailOcc(null); setEditing(m); setFormOpen(true) }

  return (
    <div className="space-y-4">
      {/* 툴바 (스크롤 시 상단 고정) */}
      <div className="sticky top-0 z-20 -mx-1 flex flex-col gap-3 bg-canvas/95 px-1 pb-3 pt-1 backdrop-blur-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="chrome-icon" aria-label={t('meet.prevMonth')}><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[116px] text-center text-base font-bold tabular-nums text-ink">
            {new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: locale === 'ko' ? 'numeric' : 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month0, 1)))}
          </div>
          <button onClick={() => shift(1)} className="chrome-icon" aria-label={t('meet.nextMonth')}><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => { setYear(initY); setMonth0((initM || 1) - 1) }} className="btn btn-ghost h-10">{t('meet.today')}</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs<ViewKey>
            tabs={[{ key: 'calendar', label: t('meet.view.calendar'), icon: CalendarDays }, { key: 'list', label: t('meet.view.list'), icon: List }]}
            value={view} onChange={setView} size="sm"
          />
          <button onClick={() => { setEditing(null); setFormOpen(true) }} className="btn btn-primary"><Plus className="h-4 w-4" />{t('meet.addMeeting')}</button>
        </div>
      </div>

      {view === 'calendar' ? (
        <MeetingCalendar year={year} month0={month0} todayIso={todayIso} occurrences={occurrences} onSelectOccurrence={setDetailOcc} />
      ) : listRows.length === 0 ? (
        <EmptyState icon={CalendarX2} title={t('meet.empty.title')} description={t('meet.empty.desc')} />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                  <th className="px-4 py-3">{t('meet.col.date')}</th>
                  <th className="px-4 py-3">{t('meet.col.time')}</th>
                  <th className="px-4 py-3">{t('meet.col.title')}</th>
                  <th className="px-4 py-3">{t('meet.col.category')}</th>
                  <th className="px-4 py-3">{t('meet.col.attendees')}</th>
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
                      <td className="px-4 py-3"><span className={`chip ${meta.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{t(meta.labelKey as DictKey)}</span></td>
                      <td className="px-4 py-3 text-ink-muted">{o.attendeeCount}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <MeetingFormModal open={formOpen} projectId={projectId} members={members} initial={editing} todayIso={todayIso}
        onClose={() => { setFormOpen(false); setEditing(null) }} onSaved={onSaved} />
      <MeetingDetailModal open={!!detailOcc} occurrence={detailOcc}
        currentUserId={currentUserId} role={role}
        onClose={() => setDetailOcc(null)} onEditSeries={openEditFromDetail} onChanged={() => router.refresh()} />
    </div>
  )
}
