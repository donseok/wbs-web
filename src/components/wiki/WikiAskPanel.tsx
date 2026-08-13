'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, FileText, RotateCcw, Search, Send, Sparkles } from 'lucide-react'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import type {
  BotSource,
  ChatRequestV2,
  ChatStreamEvent,
} from '@/lib/ai/chat/protocol'
import {
  consumeChatNdjson,
  isSafeInternalBotHref,
} from '@/components/chat/chatStream'
import { createWikiQuestion } from '@/app/actions/wiki'
import { trackWikiEvent } from './wikiAnalytics'

type AskState =
  | { status: 'idle' }
  | { status: 'loading'; question: string; message: string | null; answer: string; sources: BotSource[] }
  | { status: 'success'; question: string; answer: string; sources: BotSource[]; asOf: string | null; truncated: boolean }
  | { status: 'error'; question: string; message: string }

const SUGGESTIONS = {
  ko: ['현재 확정된 핵심 결정은?', '아직 해결되지 않은 질문은?', '최근에 바뀐 내용은?'],
  en: ['What are the key decisions?', 'Which questions remain open?', 'What changed recently?'],
} as const

function mergeSources(current: BotSource[], incoming: BotSource[]): BotSource[] {
  const byId = new Map(current.map((source) => [source.id, source]))
  for (const source of incoming) byId.set(source.id, source)
  return [...byId.values()]
}

function trustedSources(value: unknown): BotSource[] {
  if (!Array.isArray(value)) return []
  return value.filter((source): source is BotSource => {
    if (typeof source !== 'object' || source === null) return false
    const candidate = source as Partial<BotSource>
    return typeof candidate.id === 'string'
      && typeof candidate.title === 'string'
      && typeof candidate.domain === 'string'
      && typeof candidate.href === 'string'
      && isSafeInternalBotHref(candidate.href)
  })
}

function formatAsOf(value: string | null, locale: Locale): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(date)
}

export function WikiAskPanel({
  projectId,
  locale,
  canLeaveQuestion = false,
}: {
  projectId: string
  locale: Locale
  canLeaveQuestion?: boolean
}) {
  const [input, setInput] = useState('')
  const [state, setState] = useState<AskState>({ status: 'idle' })
  const [questionState, setQuestionState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const abortRef = useRef<AbortController | null>(null)
  const requestRef = useRef(0)

  useEffect(() => () => abortRef.current?.abort(), [])

  async function ask(raw: string) {
    const question = raw.trim()
    if (!question || state.status === 'loading') return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const requestNo = requestRef.current + 1
    requestRef.current = requestNo
    setInput('')
    setQuestionState('idle')
    setState({ status: 'loading', question, message: null, answer: '', sources: [] })
    trackWikiEvent('wiki_ask_submitted', `/p/${projectId}/wiki`, { source: 'wiki_home' })

    let answer = ''
    let sources: BotSource[] = []
    let asOf: string | null = null
    let truncated = false

    const updateLoading = (message: string | null = null) => {
      if (requestRef.current !== requestNo) return
      setState({ status: 'loading', question, message, answer, sources })
    }

    const complete = (fallback: boolean) => {
      if (requestRef.current !== requestNo) return
      const grounded = answer.trim().length > 0 && sources.length > 0
      const finalAnswer = grounded ? answer : ''
      const finalSources = grounded ? sources : []
      setState({ status: 'success', question, answer: finalAnswer, sources: finalSources, asOf, truncated })
      trackWikiEvent(grounded ? 'wiki_ask_answered' : 'wiki_ask_no_answer', `/p/${projectId}/wiki`, {
        source_count: grounded ? finalSources.length : 0,
        truncated,
        fallback,
      })
    }

    const onEvent = (event: ChatStreamEvent) => {
      if (requestRef.current !== requestNo) throw new DOMException('Stale request', 'AbortError')
      if (event.type === 'status') updateLoading(event.message)
      if (event.type === 'delta') {
        answer += event.text
        updateLoading()
      }
      if (event.type === 'sources') {
        sources = mergeSources(sources, trustedSources(event.items))
        updateLoading()
      }
      if (event.type === 'done') {
        asOf = event.asOf
        truncated = event.truncated
      }
    }

    try {
      // Wiki에서는 사람이 관리한 정본 문서·답변된 지식 공백·승인된 회의 지식을 함께
      // 검색하는 전용 경로가 정본이다. 일반 Chat 라우터가 켜져 있어도 문서 본문을 놓치지 않는다.
      const response = await fetch('/api/wiki/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, question }),
        signal: controller.signal,
      })
      if ([404, 405, 501].includes(response.status)) {
        const request: ChatRequestV2 = {
          projectId,
          message: question,
          history: [],
          pageContext: {
            contextVersion: 1,
            pathname: `/p/${projectId}/wiki`,
            domain: 'wiki',
            projectId,
            selectedEntity: null,
            timezone: 'Asia/Seoul',
          },
          conversationState: { version: 1, lastEntities: [], lastDomains: ['wiki'] },
        }
        const fallback = await fetch('/api/chat/v2/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
          body: JSON.stringify(request),
          signal: controller.signal,
        })
        if (!fallback.ok || !fallback.body) {
          const payload = await fallback.json().catch(() => null) as { error?: string } | null
          throw new Error(payload?.error || t(locale, 'wiki.ask.error'))
        }
        const terminal = await consumeChatNdjson(fallback.body, onEvent)
        if (terminal.type === 'error') throw new Error(terminal.message)
        complete(true)
        return
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || t(locale, 'wiki.ask.error'))
      }
      const payload = await response.json() as {
        answer?: unknown
        sources?: unknown
        asOf?: unknown
        truncated?: unknown
      }
      answer = typeof payload.answer === 'string' ? payload.answer : ''
      sources = trustedSources(payload.sources)
      asOf = typeof payload.asOf === 'string' ? payload.asOf : null
      truncated = payload.truncated === true
      complete(false)
    } catch (error) {
      if (controller.signal.aborted || requestRef.current !== requestNo) return
      trackWikiEvent('wiki_ask_failed', `/p/${projectId}/wiki`, { stage: 'answer' })
      setState({
        status: 'error',
        question,
        message: error instanceof Error && error.message ? error.message : t(locale, 'wiki.ask.error'),
      })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  async function leaveQuestion(question: string) {
    if (!canLeaveQuestion || questionState === 'saving' || questionState === 'saved') return
    setQuestionState('saving')
    const result = await createWikiQuestion({ projectId, question })
    if (result.ok) {
      setQuestionState('saved')
      trackWikiEvent('wiki_question_created', `/p/${projectId}/wiki`, { source: 'ask_gap' })
    } else {
      setQuestionState('error')
      trackWikiEvent('wiki_ask_failed', `/p/${projectId}/wiki`, { stage: 'question_create' })
    }
  }

  const sources = state.status === 'success' || state.status === 'loading'
    ? trustedSources(state.sources).slice(0, 8)
    : []
  // 답변은 내부 근거 링크가 하나 이상 검증된 뒤에만 노출한다. 스트림 도중에도
  // 근거 없는 생성 문장이 잠깐 보였다 사라지는 신뢰 회귀를 막는다.
  const answer = (state.status === 'success' || state.status === 'loading') && sources.length > 0
    ? state.answer
    : ''
  const busy = state.status === 'loading'

  return (
    <section className="hero-card hero-glow overflow-hidden px-5 py-6 sm:px-7 sm:py-7" aria-labelledby="wiki-ask-title">
      <div className="relative z-10 max-w-3xl">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-hero-ink-muted">
          <Sparkles className="h-4 w-4 text-[#3fd8c6]" aria-hidden />
          {t(locale, 'wiki.ask.eyebrow')}
        </div>
        <h2 id="wiki-ask-title" className="mt-2 text-xl font-bold tracking-tight text-hero-ink sm:text-2xl">
          {t(locale, 'wiki.ask.title')}
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-hero-ink-muted">{t(locale, 'wiki.ask.desc')}</p>

        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => { event.preventDefault(); void ask(input) }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
              }}
              maxLength={2000}
              placeholder={t(locale, 'wiki.ask.placeholder')}
              aria-label={t(locale, 'wiki.ask.placeholder')}
              disabled={busy}
              className="h-12 w-full rounded-2xl border border-white/15 bg-surface pl-11 pr-4 text-sm text-ink shadow-[var(--shadow-sm)] outline-none transition placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand-ring disabled:opacity-70"
            />
          </div>
          <button type="submit" disabled={busy || !input.trim()} className="btn btn-primary h-12 rounded-2xl px-5">
            {busy ? t(locale, 'wiki.ask.working') : t(locale, 'wiki.ask.submit')}
            <Send className="h-4 w-4" aria-hidden />
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-1.5" aria-label={t(locale, 'wiki.ask.suggestions')}>
          {SUGGESTIONS[locale].map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void ask(suggestion)}
              disabled={busy}
              className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs text-hero-ink-muted transition hover:bg-white/[0.11] hover:text-hero-ink disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>

        {(state.status === 'loading' || state.status === 'success') && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-surface p-4 text-ink shadow-[var(--shadow-md)]" aria-live="polite">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-weak text-brand">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-ink-muted">{state.question}</p>
                {answer ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{answer}</p>
                ) : (
                  <p className="mt-2 text-sm text-ink-muted">{state.status === 'loading' ? (state.message ?? t(locale, 'wiki.ask.working')) : t(locale, 'wiki.ask.noAnswer')}</p>
                )}
                {sources.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                      {t(locale, 'wiki.ask.sources')}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {sources.map((source) => (
                        <Link
                          key={source.id}
                          href={source.href}
                          title={source.excerpt ?? source.title}
                          onClick={() => trackWikiEvent('wiki_source_opened', `/p/${projectId}/wiki`, { domain: source.domain })}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-brand transition hover:border-brand-ring hover:text-brand-hover"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{source.title}</span>
                          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {state.status === 'success' && (state.asOf || state.truncated) && (
                  <p className="mt-2 text-[11px] text-ink-subtle">
                    {formatAsOf(state.asOf, locale) && `${t(locale, 'wiki.ask.asOf')} ${formatAsOf(state.asOf, locale)}`}
                    {state.asOf && state.truncated && ' · '}
                    {state.truncated && t(locale, 'wiki.ask.truncated')}
                  </p>
                )}
                {state.status === 'success' && sources.length === 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-xs leading-5 text-ink-muted">{t(locale, canLeaveQuestion ? 'wiki.ask.gapDesc' : 'wiki.ask.gapDescReadOnly')}</p>
                    {canLeaveQuestion && (
                      <button
                        type="button"
                        onClick={() => void leaveQuestion(state.question)}
                        disabled={questionState === 'saving' || questionState === 'saved'}
                        className="btn btn-ghost mt-2 h-9 px-3 text-xs"
                      >
                        {questionState === 'saving'
                          ? t(locale, 'wiki.ask.questionSaving')
                          : questionState === 'saved'
                            ? t(locale, 'wiki.ask.questionSaved')
                            : t(locale, 'wiki.ask.leaveQuestion')}
                      </button>
                    )}
                    {questionState === 'error' && <p className="mt-2 text-xs font-medium text-delayed">{t(locale, 'wiki.ask.questionFailed')}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-delayed/30 bg-surface p-4 text-sm sm:flex-row sm:items-center" role="alert">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-delayed">{t(locale, 'wiki.ask.failedTitle')}</p>
              <p className="mt-1 text-ink-muted">{state.message}</p>
            </div>
            <button type="button" onClick={() => void ask(state.question)} className="btn btn-ghost h-9 shrink-0 px-3 text-xs">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t(locale, 'wiki.ask.retry')}
            </button>
            {canLeaveQuestion && (
              <button
                type="button"
                onClick={() => void leaveQuestion(state.question)}
                disabled={questionState === 'saving' || questionState === 'saved'}
                className="btn btn-primary h-9 shrink-0 px-3 text-xs"
              >
                {questionState === 'saving'
                  ? t(locale, 'wiki.ask.questionSaving')
                  : questionState === 'saved'
                    ? t(locale, 'wiki.ask.questionSaved')
                    : t(locale, 'wiki.ask.leaveQuestion')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
