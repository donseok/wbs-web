'use client'
import { useState } from 'react'
import type { Minute, TeamCode } from '@/lib/domain/types'
import { TEAM_CODES } from '@/lib/domain/minutes'
import { updateMinuteMeta } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'

export function MinuteMetaModal({
  open, onClose, onSaved, minute,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  minute: Minute
}) {
  const { t } = useLocale()
  const [date, setDate] = useState(minute.minuteDate)
  const [team, setTeam] = useState<TeamCode>(minute.teamCode)
  const [title, setTitle] = useState(minute.title)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    const res = await updateMinuteMeta(minute.id, {
      minuteDate: date, teamCode: team, title, meetingId: minute.meetingId,
    })
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? 'error'); return }
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={t('min.meta.title')} size="sm"
      footer={<div className="flex justify-end"><button onClick={save} disabled={busy} className="btn btn-primary">{t('min.meta.save')}</button></div>}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.date')}</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="app-input" />
        </label>
        <div className="text-sm">
          <span className="mb-1 block font-medium">{t('min.form.team')}</span>
          <SegmentedTabs<TeamCode> tabs={TEAM_CODES.map(tk => ({ key: tk, label: tk }))}
            value={team} onChange={setTeam} size="sm" />
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.title')}</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className="app-input" />
        </label>
        {err && <p className="text-sm text-delayed">{err}</p>}
      </div>
    </Modal>
  )
}
