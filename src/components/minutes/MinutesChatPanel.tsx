'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import type { MinutesPreset } from '@/lib/domain/types'

type Role = 'user' | 'assistant'
/** error: 서버가 준 오류 문구. 정상 답변과 같은 말풍선으로 보이면 오답을 답으로 읽는다. */
interface Msg { id: number; role: Role; content: string; error?: boolean }

/** 라우트의 MESSAGE_MAX 와 같은 값(api/minutes/[id]/chat/route.ts:13) — 넘기면 400. */
const MESSAGE_MAX = 2000

const PRESETS: { key: MinutesPreset; labelKey: DictKey }[] = [
  { key: 'summary', labelKey: 'min.chat.preset.summary' },
  { key: 'decisions', labelKey: 'min.chat.preset.decisions' },
  { key: 'actions', labelKey: 'min.chat.preset.actions' },
  { key: 'risks', labelKey: 'min.chat.preset.risks' },
]

export function MinutesChatPanel({ minutesId }: { minutesId: string }) {
  const { t } = useLocale()
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const idRef = useRef(0)
  const nextId = () => (idRef.current += 1)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 진행 중 요청의 취소 핸들. 언마운트(라우트 이탈) 시 fetch/스트림을 끊는다. */
  const ctrlRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const ref = ctrlRef
    return () => ref.current?.abort()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  /**
   * body 는 `{ message }` 또는 `{ preset }` 중 **하나만** — 라우트는 둘 다 오면 400 을 낸다.
   * 프리셋의 실제 프롬프트 문구(presetPrompt)는 서버 전용이라 클라이언트가 알지 못하고, 알 필요도 없다.
   * 대화창에는 사용자가 실제로 누른 것 = 지역화된 라벨("요약")을 남긴다.
   *
   * history 는 프리셋에도 함께 보낸다 — 프리셋은 대화의 한 턴이지 독립 명령이 아니다("요약" 뒤에
   * "리스크 분석"을 누르면 앞 답변을 참조할 수 있어야 한다). 라우트의 sanitizeHistory 가
   * user/assistant 만 남기고 4000자·최근 12턴으로 자른다. 이번 턴의 질문은 서버가 붙이므로
   * history 에는 넣지 않는다(현재 messages 스냅샷 = 직전까지의 대화).
   */
  async function ask(body: { message: string } | { preset: MinutesPreset }, userLabel: string) {
    if (loading) return
    const history = messages
      .filter(m => !m.error) // 오류 문구를 어시스턴트 발화로 되먹이지 않는다.
      .map(m => ({ role: m.role, content: m.content }))

    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: userLabel }])
    setLoading(true) // await 앞 — 뒤에 두면 첫 await 사이에 두 번째 제출이 통과한다.

    const fail = (content: string) => {
      if (ctrl.signal.aborted) return
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content, error: true }])
    }

    let asstId: number | null = null
    try {
      const res = await fetch(`/api/minutes/${minutesId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, history }),
        signal: ctrl.signal,
      })
      // 라우트는 성공에만 text/plain 스트림을, 401/400/404/500 에는 JSON 을 준다.
      // res.ok 만 보고 getReader() 하면 JSON 오류 본문이 어시스턴트 답변으로 렌더된다.
      // content-type 까지 보는 이유: 프록시/에지가 200 + HTML 오류 페이지를 끼워 넣을 수 있다.
      const ct = res.headers.get('content-type') ?? ''
      if (!res.ok || !res.body || !ct.startsWith('text/plain')) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        fail(data.error ?? t('min.chat.error'))
        return
      }

      // 토큰 스트리밍 — 첫 청크에서 말풍선을 만들고 이후 누적 갱신(DkBot.send 와 동일 구조).
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (ctrl.signal.aborted) {
          await reader.cancel().catch(() => {})
          return
        }
        acc += decoder.decode(value, { stream: true })
        if (asstId === null) {
          const id = nextId()
          asstId = id
          setMessages(prev => [...prev, { id, role: 'assistant', content: acc }])
        } else {
          const id = asstId
          setMessages(prev => prev.map(m => (m.id === id ? { ...m, content: acc } : m)))
        }
      }
      // 라우트는 토큰이 없으면 안내 문장을 흘리므로 여기 도달은 사실상 불가하지만,
      // 도달하면 사용자 질문만 남고 답이 없는 화면이 된다 — 침묵보다 오류가 낫다.
      if (asstId === null) fail(t('min.chat.error'))
    } catch {
      // AbortError 포함 — 중단된 요청은 조용히 버린다(fail 이 aborted 를 검사한다).
      fail(t('min.chat.error'))
    } finally {
      // 늦게 끝난 옛 요청이 새 요청의 로딩을 풀지 않도록 자기 요청일 때만 해제한다.
      if (ctrlRef.current === ctrl) {
        ctrlRef.current = null
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    void ask({ message: text }, text)
  }

  return (
    <aside className="card flex h-[560px] flex-col p-4" aria-label={t('min.chat.title')}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Sparkles className="h-4 w-4 text-brand" /> {t('min.chat.title')}
      </h2>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {PRESETS.map(p => (
          <button
            key={p.key}
            type="button"
            className="btn btn-ghost h-7 px-2.5 text-xs"
            disabled={loading}
            onClick={() => void ask({ preset: p.key }, t(p.labelKey))}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto" aria-live="polite">
        {messages.length === 0 && <p className="text-xs text-ink-muted">{t('min.chat.empty')}</p>}
        {messages.map(m => (
          <div
            key={m.id}
            className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
              m.role === 'user'
                ? 'ml-auto bg-brand-weak text-ink'
                : m.error
                  ? 'bg-delayed-weak text-delayed'
                  : 'bg-surface-2 text-ink'
            }`}
          >
            {m.content}
          </div>
        ))}
      </div>

      <form className="mt-3 flex gap-2" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          // 한글 IME 조합 중의 Enter 는 '조합 확정' 키다 — 그대로 두면 확정과 동시에 폼이 제출되어
          // 마지막 글자가 잘린 채 전송된다(DkBot.onInputKey 와 같은 이유, 같은 판정).
          onKeyDown={e => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault() }}
          placeholder={t('min.chat.placeholder')}
          aria-label={t('min.chat.placeholder')}
          maxLength={MESSAGE_MAX}
          className="app-input h-9 flex-1"
          disabled={loading}
        />
        <button
          type="submit"
          className="btn btn-primary h-9 px-3"
          disabled={loading || !input.trim()}
          aria-label={t('min.chat.send')}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </aside>
  )
}
