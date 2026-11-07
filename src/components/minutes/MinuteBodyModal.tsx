'use client'

import { useRef, useState } from 'react'
import { updateMinuteBody } from '@/app/actions/minutes'
import { MINUTE_BODY_MAX } from '@/lib/domain/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'

export function MinuteBodyModal({ minuteId, bodyMd, onClose, onSaved }: {
  minuteId: string
  bodyMd: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const [draft, setDraft] = useState(bodyMd)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saving = useRef(false)
  const tooLong = draft.length > MINUTE_BODY_MAX

  async function save() {
    if (saving.current || tooLong || draft === bodyMd) return
    saving.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await updateMinuteBody(minuteId, draft)
      if (!result.ok) {
        setError(result.error ?? t('min.body.failed'))
        return
      }
      toast({ title: t('min.body.saved') })
      onSaved()
    } catch {
      setError(t('min.body.failed'))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={() => { if (!saving.current) onClose() }} title={t('min.body.edit')} size="lg"
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn btn-primary" onClick={save}
          disabled={busy || tooLong || draft === bodyMd}>
          {busy ? t('min.form.saving') : t('min.form.save')}
        </button>
      </>}>
      <label htmlFor="minute-body-editor" className="mb-2 block text-sm text-ink-muted">{t('min.body.label')}</label>
      <textarea id="minute-body-editor" autoFocus value={draft} disabled={busy}
        onChange={event => setDraft(event.target.value)}
        className="min-h-[45vh] w-full rounded-xl border border-line bg-surface p-3 font-mono text-sm text-ink" />
      <p className="mt-2 text-right text-xs text-ink-muted">{draft.length.toLocaleString()} / {MINUTE_BODY_MAX.toLocaleString()}</p>
      {(error || tooLong) && <p role="alert" className="mt-2 text-sm text-delayed">{error ?? t('min.body.tooLong')}</p>}
    </Modal>
  )
}
