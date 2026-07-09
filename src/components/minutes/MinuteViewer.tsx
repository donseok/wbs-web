'use client'
import { useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Download, ExternalLink, Paperclip } from 'lucide-react'
import type { Minute, MinuteFile } from '@/lib/domain/types'
import {
  MINUTE_BODY_FILE_MAX, MINUTE_BODY_MAX, sanitizeFileName,
} from '@/lib/domain/minutes'
import {
  getMinuteFileUrl, replaceMinuteBody, deleteMinute,
} from '@/app/actions/minutes'
import { createBrowserClient } from '@/lib/supabase/client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { MarkdownView } from './MarkdownView'
import { MinuteMetaModal } from './MinuteMetaModal'
import { MinuteChatPanel } from './MinuteChatPanel'
import { TEAM } from '@/components/wbs/shared'

export function MinuteViewer({
  minute, files, canManage,
}: {
  minute: Minute
  files: MinuteFile[]
  canManage: boolean
}) {
  const router = useRouter()
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [metaOpen, setMetaOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const bodyFile = files.find(f => f.role === 'body') ?? null
  const attachments = files.filter(f => f.role === 'attachment')

  async function download(fileId: string) {
    setBusy(true)
    const res = await getMinuteFileUrl(fileId)
    setBusy(false)
    if (res.ok && res.url) {
      window.open(res.url, '_blank', 'noopener,noreferrer')
      setErr(null)
    } else {
      setErr(res.error ?? t('min.err.download'))
    }
  }

  async function onReplaceBody(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setErr(null)
    if (!/\.(md|markdown)$/i.test(f.name)) { setErr(t('min.err.bodyExt')); return }
    if (f.size > MINUTE_BODY_FILE_MAX) { setErr(t('min.err.bodyFileMax')); return }
    const text = await f.text()
    if (text.length > MINUTE_BODY_MAX) { setErr(t('min.err.bodyMax')); return }
    setBusy(true)
    try {
      const sb = createBrowserClient()
      const path = `${minute.id}/${Date.now()}-${sanitizeFileName(f.name)}`
      const up = await sb.storage.from('minutes').upload(path, f, { upsert: false })
      if (up.error) { setErr(`${t('min.err.upload')}: ${up.error.message}`); return }
      const res = await replaceMinuteBody(minute.id, text, {
        fileName: f.name, filePath: path, size: f.size, mime: f.type || 'text/markdown',
      })
      if (!res.ok) { await sb.storage.from('minutes').remove([path]); setErr(res.error ?? t('min.err.upload')); return }
      router.refresh()
    } finally { setBusy(false) }
  }

  async function onDelete() {
    setBusy(true)
    const res = await deleteMinute(minute.id)
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? 'error'); return }
    router.push('/minutes')
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {/* 메타 헤더 */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/minutes" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" />{t('min.detail.back')}
          </Link>
          <span className="text-sm tabular-nums text-ink-muted">{minute.minuteDate}</span>
          <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[minute.teamCode].bar}`}>
            {minute.teamCode}
          </span>
          <h1 className="flex-1 truncate text-lg font-bold text-ink">{minute.title}</h1>
          <span className="text-xs text-ink-subtle">{minute.createdByName ?? ''}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {bodyFile ? (
            <button onClick={() => void download(bodyFile.id)} disabled={busy} className="btn">
              <Download className="h-4 w-4" />{t('min.detail.download')}
            </button>
          ) : (
            <span className="text-xs text-delayed">{t('min.detail.noBodyFile')}</span>
          )}
          {attachments.map(f => (
            <button key={f.id} onClick={() => void download(f.id)} disabled={busy} className="btn">
              <Paperclip className="h-4 w-4" />{f.fileName}
            </button>
          ))}
          {minute.meetingId && (
            <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
              <ExternalLink className="h-3.5 w-3.5" />{t('min.detail.linkedMeeting')}
            </span>
          )}
          {canManage && (
            <span className="ml-auto flex items-center gap-2">
              <button onClick={() => setMetaOpen(true)} className="btn">{t('min.detail.edit')}</button>
              <label className="btn cursor-pointer">
                {t('min.detail.replaceBody')}
                <input type="file" accept=".md,.markdown" className="hidden" onChange={onReplaceBody} />
              </label>
              <button onClick={() => setConfirmOpen(true)} className="btn text-delayed">{t('min.detail.delete')}</button>
            </span>
          )}
        </div>
        {err && <p className="text-sm text-delayed">{err}</p>}
      </div>

      {/* 본문 + (Task 17: 우측 채팅 패널) */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="card min-w-0 flex-1 p-5">
          <MarkdownView content={minute.bodyMd} />
        </div>
        <MinuteChatPanel minuteId={minute.id} />
      </div>

      <MinuteMetaModal open={metaOpen} onClose={() => setMetaOpen(false)} onSaved={() => { setMetaOpen(false); router.refresh() }} minute={minute} />

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t('min.detail.delete')} size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmOpen(false)} className="btn">{t('common.cancel')}</button>
            <button onClick={() => { setConfirmOpen(false); void onDelete() }} disabled={busy} className="btn text-delayed">
              {t('min.detail.delete')}
            </button>
          </div>
        }>
        <p className="text-sm text-ink">{t('min.detail.deleteConfirm')}</p>
      </Modal>
    </div>
  )
}
