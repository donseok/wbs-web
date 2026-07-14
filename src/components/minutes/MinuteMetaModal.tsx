'use client'
import { useEffect, useState } from 'react'
import type { Minute, TeamCode } from '@/lib/domain/types'
import { TEAM_CODES } from '@/lib/domain/minutes'
import { fetchProjectMeetingsLite, updateMinuteMeta } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'

export function MinuteMetaModal({
  open, onClose, onSaved, minute, projects,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  minute: Minute
  projects: { id: string; name: string }[]
}) {
  const { t } = useLocale()
  const [date, setDate] = useState(minute.minuteDate)
  const [team, setTeam] = useState<TeamCode>(minute.teamCode)
  const [title, setTitle] = useState(minute.title)
  const [projectId, setProjectId] = useState(minute.meetingProjectId ?? '')
  const [meetingId, setMeetingId] = useState(minute.meetingId ?? '')
  const [meetings, setMeetings] = useState<{ id: string; title: string; meetingDate: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 기존 연결이 있으면 열릴 때 해당 프로젝트의 회의 목록을 채워 현재 선택이 보이게 한다
  const initialProjectId = minute.meetingProjectId ?? ''
  useEffect(() => {
    if (!open || !initialProjectId) return
    let alive = true
    void fetchProjectMeetingsLite(initialProjectId).then(list => { if (alive) setMeetings(list) })
    return () => { alive = false }
  }, [open, initialProjectId])

  async function onProject(pid: string) {
    setProjectId(pid); setMeetingId(''); setMeetings([])
    if (pid) setMeetings(await fetchProjectMeetingsLite(pid))
  }

  async function save() {
    setBusy(true); setErr(null)
    const res = await updateMinuteMeta(minute.id, {
      minuteDate: date, teamCode: team, title, meetingId: meetingId || null,
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
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium">{t('min.form.project')}</span>
            <select value={projectId} onChange={e => void onProject(e.target.value)} className="app-input">
              <option value="">{t('min.form.meetingNone')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">{t('min.form.meeting')}</span>
            <select value={meetingId} onChange={e => setMeetingId(e.target.value)} disabled={!projectId} className="app-input">
              <option value="">{t('min.form.meetingNone')}</option>
              {meetings.map(mt => <option key={mt.id} value={mt.id}>{mt.meetingDate} · {mt.title}</option>)}
            </select>
          </label>
        </div>
        {err && <p className="text-sm text-delayed">{err}</p>}
      </div>
    </Modal>
  )
}
