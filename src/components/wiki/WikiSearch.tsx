'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, Send, Sparkles } from 'lucide-react'
import { WikiSearchResults } from './WikiSearchResults'
import { useWikiSearchQuery } from './useWikiSearchQuery'
import { toSearchViewState, type SearchViewState } from '@/lib/domain/searchView'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

// 사용자가 지정한 옛 WikiAskPanel 디자인의 추천 칩과 같은 자리 — 문구만 검색용으로 바꿨다.
const CHIP_KEYS: DictKey[] = ['wiki.search2.chip1', 'wiki.search2.chip2', 'wiki.search2.chip3']

export function WikiSearch({ projectId, locale, initialQuery }: {
  projectId: string
  locale: Locale
  initialQuery: string
}) {
  const [query, setQuery] = useWikiSearchQuery(initialQuery)
  const [state, setState] = useState<SearchViewState>({ kind: 'idle' })
  // 제출된 질의 — 입력창의 실시간 값과 분리한다. WikiSearchResults 에 그대로 내려가
  // 매칭 중심 스니펫·요약 요청에 쓰이므로, 타이핑 중에 흔들리면 안 된다.
  const [submittedQuery, setSubmittedQuery] = useState('')
  const seq = useRef(0)

  const run = useCallback(async (next: string) => {
    const trimmed = next.trim()
    if (!trimmed) { setState({ kind: 'idle' }); setSubmittedQuery(''); return }
    setSubmittedQuery(trimmed)
    const mine = ++seq.current
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/api/wiki/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, q: next }),
      })
      const body = await res.json().catch(() => null)
      // 내가 보낸 요청이 더는 최신이 아니면 결과를 버린다.
      if (mine !== seq.current) return
      setState(toSearchViewState({ ok: res.ok, status: res.status, body }))
    } catch {
      if (mine !== seq.current) return
      setState({ kind: 'error' })
    }
  }, [projectId])

  // ?q= 딥링크로 들어오면 한 번은 실제로 검색해 준다. 안 하면 검색어만 채워지고 결과가 빈다.
  const ranInitial = useRef(false)
  useEffect(() => {
    if (ranInitial.current || !initialQuery.trim()) return
    ranInitial.current = true
    void run(initialQuery)
  }, [initialQuery, run])

  function runChip(label: string) {
    setQuery(label)
    void run(label)
  }

  const busy = state.kind === 'loading'

  return (
    <section className="hero-card hero-glow overflow-hidden px-5 py-6 sm:px-7 sm:py-7" aria-labelledby="wiki-search-title">
      <div className="relative z-10 max-w-3xl">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-hero-ink-muted">
          <Sparkles className="h-4 w-4 text-[#3fd8c6]" aria-hidden />
          {t(locale, 'wiki.ask.eyebrow')}
        </div>
        <h2 id="wiki-search-title" className="mt-2 text-xl font-bold tracking-tight text-hero-ink sm:text-2xl">
          {t(locale, 'wiki.ask.title')}
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-hero-ink-muted">{t(locale, 'wiki.search2.idle.desc')}</p>

        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={event => { event.preventDefault(); void run(query) }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
              }}
              placeholder={t(locale, 'wiki.search2.placeholder')}
              aria-label={t(locale, 'wiki.search2.placeholder')}
              disabled={busy}
              className="h-12 w-full rounded-2xl border border-white/15 bg-surface pl-11 pr-4 text-sm text-ink shadow-[var(--shadow-sm)] outline-none transition placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand-ring disabled:opacity-70"
            />
          </div>
          <button type="submit" disabled={busy || !query.trim()} className="btn btn-primary h-12 rounded-2xl px-5">
            {busy ? t(locale, 'wiki.ask.working') : t(locale, 'wiki.ask.submit')}
            <Send className="h-4 w-4" aria-hidden />
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {CHIP_KEYS.map(key => {
            const label = t(locale, key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => runChip(label)}
                disabled={busy}
                className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs text-hero-ink-muted transition hover:bg-white/[0.11] hover:text-hero-ink disabled:opacity-50"
              >
                {label}
              </button>
            )
          })}
        </div>

        <WikiSearchResults state={state} locale={locale} query={submittedQuery} projectId={projectId} />
      </div>
    </section>
  )
}
