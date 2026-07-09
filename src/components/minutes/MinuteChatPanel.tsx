'use client'
import { useRef, useState } from 'react'
import { MessageCircle, RotateCcw, Send, X } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { linkifyMinutePaths } from './linkify'

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
  /** 대화 초기화 — 응답 수신 중에는 무시(스트림이 사라진 말풍선에 계속 쓰는 혼선 방지). */
  function reset() {
    if (loading) return
    setMessages([])
  }
  return { messages, loading, send, reset }
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

type ChatScope = 'doc' | 'archive'

/** 문서 모드 패널 — 뷰어 우측(좁은 화면에선 아래). 범위 토글로 전체 보관함 질문 가능. */
export function MinuteChatPanel({ minuteId }: { minuteId: string }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(true)
  const [scope, setScope] = useState<ChatScope>('doc')
  // 범위별 독립 스레드 — 전환해도 각 대화가 보존되고 LLM 컨텍스트가 섞이지 않는다.
  const doc = useMinutesChat((message, history) => ({ mode: 'doc', minuteId, message, history }))
  const archive = useMinutesChat((message, history) => ({
    mode: 'archive', message, history, filters: { team: null, from: null, to: null },
  }))
  const chat = scope === 'doc' ? doc : archive

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
        <span className="inline-flex items-center gap-2">
          <MessageCircle className="h-4 w-4 shrink-0 text-brand" />
          <SegmentedTabs<ChatScope>
            tabs={[{ key: 'doc', label: t('min.chat.scope.doc') },
                   { key: 'archive', label: t('min.chat.scope.all') }]}
            value={scope} onChange={setScope} size="sm" />
        </span>
        <span className="inline-flex items-center gap-2">
          <button onClick={chat.reset} disabled={chat.loading || chat.messages.length === 0}
            className="text-ink-subtle hover:text-ink disabled:opacity-40"
            title={t('min.chat.reset')} aria-label={t('min.chat.reset')}>
            <RotateCcw className="h-4 w-4" />
          </button>
          <button onClick={() => setOpen(false)} className="text-ink-subtle hover:text-ink" aria-label="close">
            <X className="h-4 w-4" />
          </button>
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {chat.messages.map(m => (
          <ChatBubble key={m.id} role={m.role} content={m.content}
            renderContent={scope === 'archive' ? linkifyMinutePaths : undefined} />
        ))}
      </div>
      <ChatComposer onSend={chat.send} loading={chat.loading} />
    </aside>
  )
}
