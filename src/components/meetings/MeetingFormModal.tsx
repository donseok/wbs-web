'use client'

import { useEffect, useState, useTransition } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { DictKey } from '@/lib/i18n/dict'
import type { Meeting, MeetingCategory, MeetingRecurrence, ProjectMember } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { MEETING_CATEGORIES, RECURRENCE_ORDER } from '@/lib/domain/meetings'
import { MeetingAttendeePicker } from './MeetingAttendeePicker'
import { createMeeting, updateMeeting, type MeetingInput } from '@/app/actions/meetings'

type FormState = {
  title: string; meetingDate: string; allDay: boolean; startTime: string; endTime: string
  location: string; category: MeetingCategory; recurrence: MeetingRecurrence
  recurrenceUntil: string; body: string; attendeeIds: string[]
}

function initState(initial: Meeting | null, todayIso: string): FormState {
  if (!initial) return {
    title: '', meetingDate: todayIso, allDay: false, startTime: '10:00', endTime: '11:00',
    location: '', category: 'routine', recurrence: 'none', recurrenceUntil: '', body: '', attendeeIds: [],
  }
  return {
    title: initial.title,
    meetingDate: initial.meetingDate,
    allDay: initial.startTime === null,
    startTime: initial.startTime ?? '10:00',
    endTime: initial.endTime ?? '',
    location: initial.location ?? '',
    category: initial.category,
    recurrence: initial.recurrence,
    recurrenceUntil: initial.recurrenceUntil ?? '',
    body: initial.body,
    attendeeIds: initial.attendeeIds,
  }
}

export function MeetingFormModal({
  open, projectId, members, initial, todayIso, onClose, onSaved,
}: {
  open: boolean
  projectId: string
  members: ProjectMember[]
  initial: Meeting | null
  todayIso: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLocale()
  const [form, setForm] = useState<FormState>(() => initState(initial, todayIso))
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => { if (open) { setForm(initState(initial, todayIso)); setErr(null) } }, [open, initial, todayIso])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  function submit() {
    const input: MeetingInput = {
      title: form.title,
      meetingDate: form.meetingDate,
      startTime: form.allDay ? null : form.startTime,
      endTime: form.allDay || !form.endTime ? null : form.endTime,
      location: form.location.trim() || null,
      category: form.category,
      body: form.body,
      recurrence: form.recurrence,
      recurrenceUntil: form.recurrence === 'none' ? null : (form.recurrenceUntil || null),
      attendeeIds: form.attendeeIds,
    }
    setErr(null)
    startTransition(async () => {
      const res = initial ? await updateMeeting(initial.id, input) : await createMeeting(projectId, input)
      if (!res.ok) { setErr(res.error ?? t('meet.saveFailed')); return }
      onSaved()
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="MEETING"
      title={initial ? t('meet.editMeeting') : t('meet.addMeeting')}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost">{t('common.cancel')}</button>
          <button onClick={submit} disabled={pending} className="btn btn-primary">{pending ? t('meet.saving') : t('common.save')}</button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.title')}</span>
          <input value={form.title} onChange={e => set('title', e.target.value)} placeholder={t('meet.form.titlePlaceholder')} className="app-input" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.date')}</span>
            <input type="date" value={form.meetingDate} onChange={e => set('meetingDate', e.target.value)} className="app-input px-2 text-xs" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.category')}</span>
            <select value={form.category} onChange={e => set('category', e.target.value as MeetingCategory)} className="app-input">
              {MEETING_CATEGORIES.map(c => <option key={c} value={c}>{t(`meet.cat.${c}` as DictKey)}</option>)}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input id="allday" type="checkbox" checked={form.allDay} onChange={e => set('allDay', e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />
          <label htmlFor="allday" className="text-xs font-semibold text-ink-muted">{t('meet.form.allDay')}</label>
        </div>
        {!form.allDay && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.start')}</span>
              <input type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)} className="app-input px-2 text-xs" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.end')}</span>
              <input type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)} className="app-input px-2 text-xs" />
            </label>
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.location')}</span>
          <input value={form.location} onChange={e => set('location', e.target.value)} placeholder={t('meet.form.locationPlaceholder')} className="app-input" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.recurrence')}</span>
            <select value={form.recurrence} onChange={e => set('recurrence', e.target.value as MeetingRecurrence)} className="app-input">
              {RECURRENCE_ORDER.map(r => <option key={r} value={r}>{t(`meet.recur.${r}` as DictKey)}</option>)}
            </select>
          </label>
          {form.recurrence !== 'none' && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.recurrenceUntil')}</span>
              <input type="date" min={form.meetingDate} value={form.recurrenceUntil} onChange={e => set('recurrenceUntil', e.target.value)} className="app-input px-2 text-xs" />
            </label>
          )}
        </div>
        {initial && initial.recurrence !== 'none' && (
          <p className="flex items-start gap-1.5 text-[11px] leading-5 text-ink-subtle">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pending" />
            {t('meet.form.ruleChangeWarn')}
          </p>
        )}

        <div>
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.attendees')}</span>
          <MeetingAttendeePicker members={members} selected={form.attendeeIds} onChange={ids => set('attendeeIds', ids)} />
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('meet.form.body')}</span>
          <textarea value={form.body} onChange={e => set('body', e.target.value)} rows={3} placeholder={t('meet.form.bodyPlaceholder')} className="app-textarea" />
        </label>

        {err && (
          <p className="flex items-center gap-1.5 rounded-lg bg-delayed-weak px-3 py-2 text-xs font-medium text-delayed">
            <AlertTriangle className="h-4 w-4 shrink-0" />{err}
          </p>
        )}
      </div>
    </Modal>
  )
}
