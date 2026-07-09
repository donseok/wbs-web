'use client'
import Link from 'next/link'
import { MessageCircle, X } from 'lucide-react'
import type { TeamCode } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { ChatBubble, ChatComposer, useMinutesChat } from './MinuteChatPanel'

const MINUTE_PATH_RE = /\/minutes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** 내부 /minutes/<uuid> 경로만 링크화 — 외부 URL·md 링크는 그대로 텍스트(피싱 표면 차단). */
function linkifyMinutePaths(content: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of content.matchAll(MINUTE_PATH_RE)) {
    const i = m.index ?? 0
    if (i > last) parts.push(content.slice(last, i))
    parts.push(
      <Link key={`${i}-${m[0]}`} href={m[0]} className="font-medium text-brand underline underline-offset-2">
        {m[0]}
      </Link>,
    )
    last = i + m[0].length
  }
  if (last < content.length) parts.push(content.slice(last))
  return parts
}

export function ArchiveChatPanel({
  open, onClose, team, from, to,
}: {
  open: boolean
  onClose: () => void
  team: TeamCode | null
  from: string | null
  to: string | null
}) {
  const { t } = useLocale()
  const { messages, loading, send } = useMinutesChat((message, history) => ({
    mode: 'archive', message, history, filters: { team, from, to },
  }))
  if (!open) return null
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <MessageCircle className="h-4 w-4 text-brand" />{t('min.chat.archive.title')}
        </span>
        <button onClick={onClose} className="text-ink-subtle hover:text-ink" aria-label="close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map(m => (
          <ChatBubble key={m.id} role={m.role} content={m.content} renderContent={linkifyMinutePaths} />
        ))}
      </div>
      <ChatComposer onSend={send} loading={loading} />
    </div>
  )
}
