'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { DictKey } from '@/lib/i18n/dict'
import type { Meeting, MeetingCategory, MeetingRecurrence, ProjectMember } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'
import { MEETING_CATEGORIES, RECURRENCE_ORDER } from '@/lib/domain/meetings'
import { MeetingAttendeePicker } from './MeetingAttendeePicker'
import { createMeeting, updateMeeting, type MeetingInput } from '@/app/actions/meetings'
import { notifyMeetingCreated } from '@/app/actions/meetingNotify'
import { describeNotifyResult, type NotifyOutcome } from '@/lib/mail/outcome'

type FormState = {
  title: string; meetingDate: string; allDay: boolean; startTime: string; endTime: string
  location: string; category: MeetingCategory; recurrence: MeetingRecurrence
  recurrenceUntil: string; body: string; attendeeIds: string[]; notify: boolean
}

function initState(initial: Meeting | null, todayIso: string): FormState {
  if (!initial) return {
    title: '', meetingDate: todayIso, allDay: false, startTime: '10:00', endTime: '11:00',
    location: '', category: 'routine', recurrence: 'none', recurrenceUntil: '', body: '',
    attendeeIds: [], notify: true,
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
    notify: false,
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
  const { toast } = useToast()
  const [form, setForm] = useState<FormState>(() => initState(initial, todayIso))
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // 결과 패널이 떠 있는 동안 회의는 이미 저장된 상태다. 폼을 잠가 중복 생성을 막는다.
  const [outcome, setOutcome] = useState<NotifyOutcome | null>(null)
  const [pending, startTransition] = useTransition()

  // 발송은 모달보다 오래 산다 — SMTP 는 10초씩 붙잡히는데 Escape·X·백드롭은 막혀 있지 않다.
  // 저장 뒤 닫고 '새 회의'를 열면 아래 리셋 effect 가 이 값을 올려 이전 실행을 무효로 만든다.
  // 이 토큰이 없으면 뒤늦게 도착한 A 의 결과가 B 를 입력 중인 빈 폼에 내려앉아,
  // 성공이면 onSaved 가 폼을 닫아 입력을 통째로 날리고 실패면 남의 폼을 잠근 채 "저장되었습니다"를 띄운다.
  const runRef = useRef(0)

  // 콜백이 캡처한 open 은 낡아 있다. 닫힌 뒤 도착한 실패를 패널로 보내면 Modal 이 null 을 반환해
  // 아무 것도 안 보이고, 성공만 토스트로 뜨는 탓에 '조용히 성공'으로 읽힌다 — 실제로는 아무도 못 받았다.
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open }, [open])

  useEffect(() => {
    if (open) {
      runRef.current += 1
      setForm(initState(initial, todayIso)); setErr(null); setOutcome(null); setSending(false)
    }
  }, [open, initial, todayIso])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  const locked = outcome !== null
  const busy = pending || sending
  const canNotify = !initial && form.attendeeIds.length > 0

  /**
   * 발송 결과를 어디에 표시할지 고른다.
   * - 밀려난 실행: 사용자는 이미 다른 회의를 입력 중이다. 알리되(토스트) 폼 상태와 onSaved 는
   *   건드리지 않는다 — 목록 갱신을 잃는 편이 남의 입력을 날리는 것보다 훨씬 가벼운 손해다.
   * - 현재 실행인데 모달이 닫힌 경우: 패널은 렌더될 자리가 없으므로 실패를 토스트로 승격한다.
   *   실패 통지가 모달 생존에 기대면 안 된다.
   */
  function report(run: number, next: NotifyOutcome) {
    const success = next.kind === 'toast'
    const notifyToast = () => success
      ? toast({ title: t('meet.notify.toastTitle'), description: next.message, variant: 'success' })
      : toast({ title: next.message, variant: 'error' })

    if (run !== runRef.current) { notifyToast(); return }
    if (success) { notifyToast(); onSaved(); return }
    if (!openRef.current) { notifyToast(); return }
    setOutcome(next)
  }

  /**
   * 발송 구간. 트랜지션 밖에서 돈다 — 안에서 await 하면 SMTP 가 붙잡히는 내내 pending 이
   * true 로 남아, 모달을 닫고 새로 연 빈 폼의 저장 버튼까지 비활성인 채
   * 사용자가 하지도 않은 발송을 하고 있다고 말한다. 저장 구간은 pending, 발송 구간은 sending —
   * 두 값이 각자의 실제 구간만 나타내야 한다.
   */
  async function sendInvite(run: number, meetingId: string) {
    try {
      report(run, describeNotifyResult(await notifyMeetingCreated(meetingId), t))
    } catch {
      // 액션 호출 자체가 실패한 경우 — 회의가 사라진 게 아님을 반드시 알린다.
      report(run, { kind: 'panel', tone: 'error', message: t('meet.notify.unknown') })
    } finally {
      if (run === runRef.current) setSending(false)
    }
  }

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
    // 이 실행의 신분증. await 뒤의 모든 상태 쓰기는 이 값이 여전히 최신일 때만 허용된다.
    const run = ++runRef.current
    const isCurrent = () => run === runRef.current

    // 트랜지션이 감싸는 것은 저장까지다. 발송은 void 로 떼어 보내 pending 을 즉시 놓아준다.
    startTransition(async () => {
      const res = initial ? await updateMeeting(initial.id, input) : await createMeeting(projectId, input)
      if (!res.ok) {
        const message = res.error ?? t('meet.saveFailed')
        // err 줄은 이 폼 안에만 있다 — 밀려났거나 닫힌 뒤라면 보이지 않으므로 토스트로 돌린다.
        if (isCurrent() && openRef.current) setErr(message)
        else toast({ title: message, variant: 'error' })
        return
      }

      // 여기부터 회의는 이미 커밋됐다. 어떤 실패도 저장을 되돌리지 않는다.
      if (!canNotify || !form.notify || !res.id) { if (isCurrent()) onSaved(); return }

      if (isCurrent()) setSending(true)
      void sendInvite(run, res.id)
    })
  }

  return (
    <Modal
      open={open}
      // 결과 패널이 떠 있으면 회의는 이미 저장됐다. Escape·X·백드롭으로 닫아도 목록을
      // 갱신하는 onSaved 로 보내야 한다 — onClose 로 빠지면 방금 만든 회의가 목록에 없다.
      onClose={locked ? onSaved : onClose}
      eyebrow="MEETING"
      title={initial ? t('meet.editMeeting') : t('meet.addMeeting')}
      footer={
        locked ? (
          <button onClick={onSaved} className="btn btn-primary">{t('common.close')}</button>
        ) : (
          <>
            <button onClick={onClose} disabled={busy} className="btn btn-ghost">{t('common.cancel')}</button>
            <button onClick={submit} disabled={busy} className="btn btn-primary">
              {sending ? t('meet.notify.sending') : pending ? t('meet.saving') : t('common.save')}
            </button>
          </>
        )
      }
    >
      <fieldset disabled={locked} className="min-w-0 border-0 p-0 disabled:opacity-60">
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

          {!initial && (
            <div>
              <label className="flex items-center gap-2">
                <input
                  id="notify-attendees"
                  type="checkbox"
                  checked={form.notify && canNotify}
                  disabled={!canNotify}
                  onChange={e => set('notify', e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-brand)] disabled:opacity-50"
                />
                <span className="text-xs font-semibold text-ink-muted">{t('meet.form.notify')}</span>
              </label>
              {!canNotify && (
                <p className="mt-1 pl-6 text-[11px] text-ink-subtle">{t('meet.form.notifyNoAttendees')}</p>
              )}
            </div>
          )}

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
      </fieldset>

      {/* 잠금 대상 밖에 둔다 — fieldset 안이면 disabled:opacity-60 으로 흐려져 정작 읽어야 할 글이 안 읽힌다. */}
      {outcome?.kind === 'panel' && (
        <p className={`mt-4 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${
          outcome.tone === 'error' ? 'bg-delayed-weak text-delayed' : 'bg-pending-weak text-accent-warning'
        }`}>
          {outcome.tone === 'error'
            ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          {outcome.message}
        </p>
      )}
    </Modal>
  )
}
