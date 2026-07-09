'use client'
import { MessageCircle, RotateCcw, X } from 'lucide-react'
import type { TeamCode } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { ChatBubble, ChatComposer, useMinutesChat } from './MinuteChatPanel'
import { linkifyMinutePaths } from './linkify'

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
  const { messages, loading, send, reset } = useMinutesChat((message, history) => ({
    mode: 'archive', message, history, filters: { team, from, to },
  }))
  if (!open) return null
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <MessageCircle className="h-4 w-4 text-brand" />{t('min.chat.archive.title')}
        </span>
        <span className="inline-flex items-center gap-2">
          <button onClick={reset} disabled={loading || messages.length === 0}
            className="text-ink-subtle hover:text-ink disabled:opacity-40"
            title={t('min.chat.reset')} aria-label={t('min.chat.reset')}>
            <RotateCcw className="h-4 w-4" />
          </button>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink" aria-label="close">
            <X className="h-4 w-4" />
          </button>
        </span>
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
