'use client'
import { useEffect, useRef } from 'react'
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

  // onClose는 소비자가 인라인 화살표로 넘기는 게 보통이라 identity가 렌더마다 바뀐다 —
  // 최신 참조는 ref로 읽고 effect는 open 전환에만 반응한다(Modal과 동일 패턴).
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    // z-[140]: 앱 헤더 70 / 헤더 드롭다운 95 / 모바일 메뉴 100 / DK Bot 120~130 위, 모달 150 아래.
    <div className="fixed inset-0 z-[140]" role="dialog" aria-modal="true" aria-label={t('min.chat.archive.title')}>
      <div data-backdrop className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div className="absolute bottom-3 right-3 top-3 flex w-[min(28rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-[var(--shadow-xl)] animate-[slidein_.18s_ease-out]">
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
            <button onClick={onClose} className="text-ink-subtle hover:text-ink" aria-label={t('common.close')}>
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
    </div>
  )
}
