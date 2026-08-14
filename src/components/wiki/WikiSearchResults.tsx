'use client'
import { useEffect, useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import { snippetOf, type SearchHit, type SearchViewState } from '@/lib/domain/searchView'

const SOURCE_KEYS: Record<string, DictKey> = {
  minutes: 'wiki.search2.source.minutes',
  issues: 'wiki.search2.source.issues',
  wbs: 'wiki.search2.source.wbs',
  announcements: 'wiki.search2.source.announcements',
  meetings: 'wiki.search2.source.meetings',
  weekly: 'wiki.search2.source.weekly',
}

// 옛 WikiAskPanel 답변 카드(불릿 [n] + 근거 필 버튼)와 같은 구조. 카드당 8건까지만
// 번호를 매겨 보여준다 — 그 이상은 개별 근거가 아니라 wiki.search2.count 로만 알린다.
const MAX_BULLETS = 8
// route.ts(POST /api/wiki/summarize)의 MAX_SNIPPET_CHARS·MAX_TITLE_CHARS 와 맞춘 상한.
const SUMMARY_SNIPPET_CHARS = 500
const SUMMARY_TITLE_CHARS = 120

type SummaryState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; answer: string }
  | { kind: 'error' }

function sourceLabel(locale: Locale, domain: string): string {
  return SOURCE_KEYS[domain] ? t(locale, SOURCE_KEYS[domain]) : domain
}

export function WikiSearchResults({ state, locale, query, projectId }: {
  state: SearchViewState
  locale: Locale
  /** 검색창에 제출된 질의(타이핑 중 값이 아니다) — 매칭 중심 스니펫과 요약 요청에 쓴다. */
  query: string
  projectId: string
}) {
  const [summary, setSummary] = useState<SummaryState>({ kind: 'idle' })

  // 새 검색을 실행하면 이전 요약은 지운다 — state 는 검색이 바뀔 때마다 새 객체다.
  useEffect(() => { setSummary({ kind: 'idle' }) }, [state])

  async function summarize(hits: SearchHit[]) {
    if (summary.kind === 'loading') return
    setSummary({ kind: 'loading' })
    try {
      const res = await fetch('/api/wiki/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          q: query,
          sources: hits.slice(0, MAX_BULLETS).map((hit, index) => ({
            n: index + 1,
            title: hit.title.slice(0, SUMMARY_TITLE_CHARS),
            snippet: snippetOf(hit.content, 400, query).slice(0, SUMMARY_SNIPPET_CHARS),
            domain: sourceLabel(locale, hit.domain),
          })),
        }),
      })
      if (!res.ok) { setSummary({ kind: 'error' }); return }
      const body = await res.json().catch(() => null) as { answer?: unknown } | null
      const answer = typeof body?.answer === 'string' ? body.answer : ''
      // 빈 답을 성공으로 위장하지 않는다(에러 처리 3원칙).
      if (!answer) { setSummary({ kind: 'error' }); return }
      setSummary({ kind: 'done', answer })
    } catch {
      setSummary({ kind: 'error' })
    }
  }

  // idle 안내(제목·설명·칩)는 셸(WikiSearch)이 맡는다 — 별도 카드를 띄우지 않는다.
  if (state.kind === 'idle') return null

  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-surface p-4 text-ink shadow-[var(--shadow-md)]" aria-live="polite">
      {state.kind === 'loading' && (
        <p className="text-sm text-ink-muted">{t(locale, 'wiki.ask.working')}</p>
      )}

      {state.kind === 'error' && (
        <p className="text-sm text-delayed">{t(locale, 'wiki.search2.error')}</p>
      )}

      {state.kind === 'done' && (
        <>
          {state.degraded && (
            <p className="mb-2 text-sm text-ink-muted">{t(locale, 'wiki.search2.degraded')}</p>
          )}

          {state.hits.length === 0
            ? <p className="text-sm text-ink-muted">{t(locale, 'wiki.search2.empty')}</p>
            : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-ink-muted">{t(locale, 'wiki.search2.answer.intro')}</p>
                  <button
                    type="button"
                    onClick={() => void summarize(state.hits)}
                    disabled={summary.kind === 'loading'}
                    className="btn btn-ghost h-8 shrink-0 px-2.5 text-xs"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    {t(locale, 'wiki.search2.summarize')}
                  </button>
                </div>

                {summary.kind === 'loading' && (
                  <p className="mt-2 text-sm text-ink-muted">{t(locale, 'wiki.search2.summarizing')}</p>
                )}
                {summary.kind === 'error' && (
                  <p className="mt-2 text-sm text-delayed">{t(locale, 'wiki.search2.summarizeFailed')}</p>
                )}
                {summary.kind === 'done' && (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{summary.answer}</p>
                )}

                <ol className="mt-3 flex flex-col gap-2.5">
                  {state.hits.slice(0, MAX_BULLETS).map((hit, index) => (
                    <li key={`${hit.domain}:${hit.entityId}`} className="flex gap-2 text-sm leading-6 text-ink">
                      <span className="shrink-0 font-semibold text-ink-subtle">[{index + 1}]</span>
                      <span className="min-w-0">
                        <span className="chip mr-1.5 bg-brand-weak text-brand">
                          {sourceLabel(locale, hit.domain)}
                        </span>
                        {snippetOf(hit.content, 200, query)}
                        <span className="text-ink-subtle"> ({hit.title})</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-xs text-ink-subtle">
                  {t(locale, 'wiki.search2.count').replace('{n}', String(state.hits.length))}
                </p>

                <div className="mt-3 border-t border-line pt-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                    {t(locale, 'wiki.ask.sources')}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {state.hits.slice(0, MAX_BULLETS).map((hit, index) => (
                      <a
                        key={`${hit.domain}:${hit.entityId}`}
                        href={hit.href}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-brand transition hover:border-brand-ring hover:text-brand-hover"
                      >
                        <span className="shrink-0 font-semibold">[{index + 1}]</span>
                        <span className="truncate">{hit.title}</span>
                        <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
                      </a>
                    ))}
                  </div>
                </div>
              </>
            )}
        </>
      )}
    </div>
  )
}
