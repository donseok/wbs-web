'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, ExternalLink, Paperclip } from 'lucide-react'
import type { Minute, MinuteFile } from '@/lib/domain/types'
import { getMinuteFileUrl } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { MarkdownView } from './MarkdownView'
import { TEAM } from '@/components/wbs/shared'

export function MinuteViewer({
  minute, files, canManage,
}: {
  minute: Minute
  files: MinuteFile[]
  canManage: boolean
}) {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const bodyFile = files.find(f => f.role === 'body') ?? null
  const attachments = files.filter(f => f.role === 'attachment')

  async function download(fileId: string) {
    setBusy(true)
    const res = await getMinuteFileUrl(fileId)
    setBusy(false)
    if (res.ok && res.url) window.open(res.url, '_blank', 'noopener,noreferrer')
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
          {/* 관리 메뉴(수정/교체/삭제) — Task 11에서 추가 (canManage) */}
        </div>
      </div>

      {/* 본문 + (Task 17: 우측 채팅 패널) */}
      <div className="card p-5">
        <MarkdownView content={minute.bodyMd} />
      </div>
      {void canManage}
    </div>
  )
}
