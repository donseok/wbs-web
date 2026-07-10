'use client'
import { useRef, useState, type ChangeEvent } from 'react'
import type { TeamCode } from '@/lib/domain/types'
import {
  MINUTE_ATTACHMENTS_MAX_COUNT, MINUTE_ATTACHMENT_MAX, MINUTE_BODY_FILE_MAX,
  MINUTE_BODY_MAX, TEAM_CODES, sanitizeFileName,
} from '@/lib/domain/minutes'
import { createMinute, fetchProjectMeetingsLite, recordMinuteFile } from '@/app/actions/minutes'
import { createBrowserClient } from '@/lib/supabase/client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'

const BUCKET = 'minutes'

export function MinuteUploadModal({
  open, onClose, onSaved, todayIso, projects,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  todayIso: string
  projects: { id: string; name: string }[]
}) {
  const { t } = useLocale()
  const [date, setDate] = useState(todayIso)
  const [team, setTeam] = useState<TeamCode>('PMO')
  const [title, setTitle] = useState('')
  const [bodyFile, setBodyFile] = useState<File | null>(null)
  const [bodyText, setBodyText] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [projectId, setProjectId] = useState('')
  const [meetingId, setMeetingId] = useState('')
  const [meetings, setMeetings] = useState<{ id: string; title: string; meetingDate: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // 부분 실패 후 재시도 시 회의록 재생성·파일 중복 기록 방지 (모달은 열 때마다 리마운트되므로 세션 단위)
  const progressRef = useRef<{ id: string; done: number } | null>(null)

  /** 파일 일괄 선택(단일 입력 UX) — 본문이 비어 있으면 첫 .md가 본문, 나머지는 전부 첨부로 자동 분류.
   *  검증을 모두 통과한 뒤에만 상태를 반영해 부분 적용을 막는다. */
  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (files.length === 0) return
    setErr(null)
    const isMd = (f: File) => /\.(md|markdown)$/i.test(f.name)
    const bodyCand = !bodyFile ? files.find(isMd) ?? null : null
    const rest = files.filter(f => f !== bodyCand)
    if (bodyCand && bodyCand.size > MINUTE_BODY_FILE_MAX) { setErr(t('min.err.bodyFileMax')); return }
    if (attachments.length + rest.length > MINUTE_ATTACHMENTS_MAX_COUNT) { setErr(t('min.err.attachCount')); return }
    if (rest.some(f => f.size > MINUTE_ATTACHMENT_MAX)) { setErr(t('min.err.attachMax')); return }
    if (bodyCand) {
      const text = await bodyCand.text()
      if (text.length > MINUTE_BODY_MAX) { setErr(t('min.err.bodyMax')); return }
      setBodyFile(bodyCand); setBodyText(text)
      if (!title.trim()) setTitle(bodyCand.name.replace(/\.(md|markdown)$/i, ''))
    }
    if (rest.length) setAttachments(prev => [...prev, ...rest])
  }

  async function onProject(pid: string) {
    setProjectId(pid); setMeetingId(''); setMeetings([])
    if (pid) setMeetings(await fetchProjectMeetingsLite(pid))
  }

  async function save() {
    if (!bodyFile) { setErr(t('min.err.bodyRequired')); return }
    setBusy(true); setErr(null)
    try {
      let minuteId = progressRef.current?.id ?? null
      if (!minuteId) {
        const res = await createMinute({
          minuteDate: date, teamCode: team, title: title.trim() || bodyFile.name,
          bodyMd: bodyText, meetingId: meetingId || null,
        })
        if (!res.ok || !res.id) { setErr(res.error ?? t('min.err.upload')); return }
        minuteId = res.id
        progressRef.current = { id: minuteId, done: 0 }
      }
      const sb = createBrowserClient()
      const files: { role: 'body' | 'attachment'; f: File }[] = [
        { role: 'body', f: bodyFile },
        ...attachments.map(f => ({ role: 'attachment' as const, f })),
      ]
      // 파일 업로드 실패 시에도 회의록은 유지한다(body_md 가 원천 — 스펙 §7).
      // body 파일 실패면 뷰어가 '재업로드 유도' 상태를 안내하고, replaceMinuteBody 로 복구 가능.
      for (let i = progressRef.current?.done ?? 0; i < files.length; i++) {
        const { role, f } = files[i]
        const path = `${minuteId}/${Date.now()}-${sanitizeFileName(f.name)}`
        const up = await sb.storage.from(BUCKET).upload(path, f, { upsert: false })
        if (up.error) { setErr(`${t('min.err.upload')}: ${up.error.message}`); return }
        const rec = await recordMinuteFile(minuteId, {
          role, fileName: f.name, filePath: path,
          size: f.size, mime: f.type || 'application/octet-stream',
        })
        if (!rec.ok) {
          // 메타 기록 실패 → 방금 올린 객체 정리(보상). 회의록은 유지.
          await sb.storage.from(BUCKET).remove([path])
          setErr(rec.error ?? t('min.err.record')); return
        }
        progressRef.current = { id: minuteId, done: i + 1 }
      }
      onSaved()
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('min.upload')} size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={save} disabled={busy || !bodyFile} className="btn btn-primary">
            {busy ? t('min.form.saving') : t('min.form.save')}
          </button>
        </div>
      }>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.date')}</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="app-input" />
        </label>
        <div className="text-sm">
          <span className="mb-1 block font-medium">{t('min.form.team')}</span>
          <SegmentedTabs<TeamCode>
            tabs={TEAM_CODES.map(tk => ({ key: tk, label: tk }))}
            value={team} onChange={setTeam} size="sm" />
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('min.form.files')}</span>
          <input type="file" multiple onChange={e => void onFiles(e)} className="app-input pt-1.5" />
          <span className="mt-1 block text-xs text-ink-subtle">{t('min.form.filesHint')}</span>
          {(bodyFile || attachments.length > 0) && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-ink-subtle">
              {bodyFile && (
                <li className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 rounded bg-progress-weak px-1 text-[10px] font-semibold text-accent-ink">{t('min.form.roleBody')}</span>
                    <span className="truncate">{bodyFile.name} · {bodyText.length.toLocaleString()}자</span>
                  </span>
                  <button type="button" className="text-delayed" onClick={() => { setBodyFile(null); setBodyText('') }}>✕</button>
                </li>
              )}
              {attachments.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] font-semibold text-ink-muted">{t('min.form.roleAttach')}</span>
                    <span className="truncate">{f.name}</span>
                  </span>
                  <button type="button" className="text-delayed"
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </label>
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
