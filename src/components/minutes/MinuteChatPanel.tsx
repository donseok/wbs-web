'use client'
import { useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

type Msg = { id: number; role: 'user' | 'assistant'; content: string }

/** 회의록 채팅 공용 훅 — mode/필터만 다른 doc·archive 패널이 공유. */
export function useMinutesChat(buildBody: (message: string, history: Msg[]) => object) {
  const { t } = useLocale()
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(false)
  const idRef = useRef(0)
  const nextId = () => (idRef.current += 1)

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || loading) return
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: text }])
    setLoading(true)
    let asstId: number | null = null
    try {
      const res = await fetch('/api/minutes/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(text, history as Msg[])),
      })
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: data.error ?? t('min.chat.error') }])
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        if (asstId === null) {
          const id = nextId(); asstId = id
          setMessages(prev => [...prev, { id, role: 'assistant', content: acc }])
        } else {
          const id = asstId
          setMessages(prev => prev.map(m => (m.id === id ? { ...m, content: acc } : m)))
        }
      }
      if (asstId === null) setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: t('min.chat.empty') }])
    } catch {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: t('min.chat.error') }])
    } finally { setLoading(false) }
  }
  return { messages, loading, send }
}

/** 어시스턴트/사용자 말풍선 — plain text. renderContent 로 링크화 주입 가능(archive 전용). */
export function ChatBubble({ role, content, renderContent }: {
  role: 'user' | 'assistant'; content: string
  renderContent?: (content: string) => React.ReactNode
}) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
        isUser ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md border border-brand-ring/30 bg-brand-weak/50 text-ink'
      }`}>
        {!isUser && renderContent ? renderContent(content) : content}
      </div>
    </div>
  )
}

export function ChatComposer({ onSend, loading }: { onSend: (v: string) => void; loading: boolean }) {
  const { t } = useLocale()
  const [value, setValue] = useState('')
  const composingRef = useRef(false)
  function submit() {
    if (composingRef.current) return
    onSend(value); setValue('')
  }
  return (
    <div className="flex items-center gap-1.5 border-t border-line p-2">
      <input value={value} onChange={e => setValue(e.target.value)}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit() }}
        placeholder={t('min.chat.placeholder')} className="app-input h-9 flex-1" />
      <button onClick={submit} disabled={loading} className="btn btn-primary h-9 px-2.5" aria-label={t('min.chat.send')}>
        <Send className="h-4 w-4" />
      </button>
    </div>
  )
}

/** 문서 모드 패널 — 뷰어 우측(좁은 화면에선 아래). */
export function MinuteChatPanel({ minuteId }: { minuteId: string }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(true)
  const { messages, loading, send } = useMinutesChat((message, history) => ({
    mode: 'doc', minuteId, message, history,
  }))
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn self-start">
        <MessageCircle className="h-4 w-4" />{t('min.chat.doc.title')}
      </button>
    )
  }
  return (
    <aside className="card flex h-[560px] w-full flex-col lg:w-[340px] lg:shrink-0">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <MessageCircle className="h-4 w-4 text-brand" />{t('min.chat.doc.title')}
        </span>
        <button onClick={() => setOpen(false)} className="text-ink-subtle hover:text-ink" aria-label="close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map(m => <ChatBubble key={m.id} role={m.role} content={m.content} />)}
      </div>
      <ChatComposer onSend={send} loading={loading} />
    </aside>
  )
}
