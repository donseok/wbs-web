'use client'

import { useEffect, useState, useTransition } from 'react'
import { CalendarDays, Clock4, MapPin, Repeat, Trash2, Pencil, Ban, RotateCcw, User } from 'lucide-react'
import type { DictKey } from '@/lib/i18n/dict'
import type { Meeting, MeetingAttendeeInfo, MeetingOccurrence } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { fmtDate } from '@/components/wbs/shared'
import { MEETING_META, canEditMeeting } from '@/lib/domain/meetings'
import { fetchMeetingDetail, cancelOccurrence, restoreOccurrence, deleteMeeting } from '@/app/actions/meetings'

export function MeetingDetailModal({
  open, occurrence, isCancelled, currentUserId, role, onClose, onEditSeries, onChanged,
}: {
  open: boolean
  occurrence: MeetingOccurrence | null
  isCancelled: boolean
  currentUserId: string | null
  role: string | null
  onClose: () => void
  onEditSeries: (m: Meeting) => void
  onChanged: () => void
}) {
  const { t } = useLocale()
  const [detail, setDetail] = useState<{ meeting: Meeting; attendees: MeetingAttendeeInfo[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open || !occurrence) { setDetail(null); setConfirmDelete(false); return }
    let alive = true
    setLoading(true)
    fetchMeetingDetail(occurrence.seriesId)
      .then(d => { if (alive) setDetail(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, occurrence])

  if (!occurrence) return null
  const meta = MEETING_META[occurrence.category]
  const canEdit = detail ? canEditMeeting(detail.meeting, currentUserId, role) : false
  const timeLabel = occurrence.startTime
    ? `${occurrence.startTime}${occurrence.endTime ? `–${occurrence.endTime}` : ''}`
    : t('meet.allDay')

  const runCancel = () => startTransition(async () => {
    const res = isCancelled
      ? await restoreOccurrence(occurrence.seriesId, occurrence.occurrenceDate)
      : await cancelOccurrence(occurrence.seriesId, occurrence.occurrenceDate)
    if (res.ok) { onChanged(); onClose() }
  })
  const runDelete = () => startTransition(async () => {
    const res = await deleteMeeting(occurrence.seriesId)
    if (res.ok) { onChanged(); onClose() }
  })

  return (
    <>
      <Modal
        open={open && !confirmDelete}
        onClose={onClose}
        eyebrow={t(meta.labelKey as DictKey)}
        title={occurrence.title}
        footer={canEdit ? (
          <>
            {occurrence.isRecurring && (
              <button onClick={runCancel} disabled={pending} className="btn btn-ghost mr-auto text-pending hover:bg-pending-weak">
                {isCancelled ? <><RotateCcw className="h-4 w-4" />{t('meet.detail.restoreOccurrence')}</> : <><Ban className="h-4 w-4" />{t('meet.detail.cancelOccurrence')}</>}
              </button>
            )}
            <button onClick={() => setConfirmDelete(true)} disabled={pending} className="btn btn-ghost text-delayed hover:bg-delayed-weak"><Trash2 className="h-4 w-4" />{t('meet.detail.deleteSeries')}</button>
            <button onClick={() => detail && onEditSeries(detail.meeting)} disabled={pending || !detail} className="btn btn-primary"><Pencil className="h-4 w-4" />{t('meet.detail.editSeries')}</button>
          </>
        ) : (
          <button onClick={onClose} className="btn btn-ghost">{t('common.close')}</button>
        )}
      >
        <div className="space-y-3 text-sm">
          <span className={`chip ${meta.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{t(meta.labelKey as DictKey)}</span>

          {isCancelled && (
            <div className="rounded-lg bg-delayed-weak px-3 py-1.5 text-xs font-semibold text-delayed">{t('meet.detail.cancelledBadge')}</div>
          )}
          <div className="flex items-center gap-2 text-ink"><CalendarDays className="h-4 w-4 text-ink-subtle" />{fmtDate(occurrence.occurrenceDate)}
            {occurrence.isRecurring && <span className="inline-flex items-center gap-1 text-[11px] text-ink-subtle"><Repeat className="h-3 w-3" />{t('meet.recurring')}</span>}
          </div>
          <div className="flex items-center gap-2 text-ink"><Clock4 className="h-4 w-4 text-ink-subtle" /><span className="tabular-nums">{timeLabel}</span></div>
          {occurrence.location && <div className="flex items-center gap-2 text-ink"><MapPin className="h-4 w-4 text-ink-subtle" />{occurrence.location}</div>}
          {detail?.meeting.createdByName && <div className="flex items-center gap-2 text-ink-muted"><User className="h-4 w-4 text-ink-subtle" />{t('meet.detail.createdBy')}: {detail.meeting.createdByName}</div>}

          <div>
            <div className="mb-1.5 text-xs font-semibold text-ink-muted">{t('meet.detail.attendees')}</div>
            {loading ? <div className="text-xs text-ink-subtle">…</div>
              : (detail?.attendees.length ?? 0) === 0 ? <div className="text-xs text-ink-subtle">{t('meet.detail.noAttendees')}</div>
              : (
                <div className="flex flex-wrap gap-1.5">
                  {detail!.attendees.map(a => (
                    <span key={a.id} className="chip bg-surface-2 text-ink">{a.name}{a.teamCode ? ` · ${a.teamCode}` : ''}</span>
                  ))}
                </div>
              )}
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-ink-muted">{t('meet.detail.body')}</div>
            {loading ? <div className="text-xs text-ink-subtle">…</div>
              : detail?.meeting.body ? <p className="whitespace-pre-wrap text-sm leading-6 text-ink-muted">{detail.meeting.body}</p>
              : <div className="text-xs text-ink-subtle">{t('meet.detail.noBody')}</div>}
          </div>
        </div>
      </Modal>

      <Modal
        open={open && confirmDelete}
        onClose={() => { if (!pending) setConfirmDelete(false) }}
        size="sm"
        eyebrow="Delete meeting"
        title={t('meet.delete.title')}
        footer={
          <>
            <button onClick={() => setConfirmDelete(false)} disabled={pending} className="btn btn-ghost">{t('common.cancel')}</button>
            <button onClick={runDelete} disabled={pending} className="btn bg-delayed text-white hover:brightness-105 disabled:opacity-50">{pending ? t('meet.deleting') : t('common.delete')}</button>
          </>
        }
      >
        <p className="text-sm leading-6 text-ink-muted">{t('meet.delete.confirm')}</p>
      </Modal>
    </>
  )
}
