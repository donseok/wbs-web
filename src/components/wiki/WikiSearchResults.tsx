'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, BookOpen, Sparkles } from 'lucide-react'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import {
  highlightSegments,
  snippetOf,
  type SearchHit,
  type SearchViewState,
} from '@/lib/domain/searchView'

const SOURCE_KEYS: Record<string, DictKey> = {
  minutes: 'wiki.search2.source.minutes',
  issues: 'wiki.search2.source.issues',
  wbs: 'wiki.search2.source.wbs',
  announcements: 'wiki.search2.source.announcements',
  meetings: 'wiki.search2.source.meetings',
  weekly: 'wiki.search2.source.weekly',
}

// 목록에 번호를 붙이는 상한 — 요약의 [n] 인용과 1:1 로 대응해야 하므로 요약 요청도 이 수만 보낸다.
const MAX_BULLETS = 8
// route.ts(POST /api/wiki/summarize)의 MAX_SNIPPET_CHARS·MAX_TITLE_CHARS 와 맞춘 상한.
const SUMMARY_SNIPPET_CHARS = 500
const SUMMARY_TITLE_CHARS = 120

type SummaryState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; answer: string }
  | { kind: 'error' }

type CorpusState =
  | { kind: 'loading' }
  | { kind: 'done'; domains: Array<{ domain: string; docs: number }>; total: number }
  | { kind: 'error' }

function sourceLabel(locale: Locale, domain: string): string {
  return SOURCE_KEYS[domain] ? t(locale, SOURCE_KEYS[domain]) : domain
}

/** 질의 토큰 매칭 구간을 <mark> 로 감싼다 — 분할은 순수 함수(highlightSegments)가 한다. */
function marked(content: string, query: string): ReactNode[] {
  return highlightSegments(content, query).map((segment, index) =>
    segment.hit
      ? (
        <mark key={index} className="rounded-[3px] bg-accent-secondary/20 px-0.5 text-inherit shadow-[inset_0_-1px_0_var(--color-accent-secondary)]">
          {segment.text}
        </mark>
      )
      : <span key={index}>{segment.text}</span>,
  )
}

/**
 * 검색 결과 2분할 — 왼쪽은 고르는 목록, 오른쪽은 고른 것을 읽는 sticky 패널 하나.
 * 근거 필을 눌러 화면을 떠나는 대신 오른쪽만 갈아 끼우며 "이게 내가 찾던 건가" 를
 * 연속으로 판단하게 한다(2026-08-17 2분할 설계 U1). xl 미만은 1열로 접고 읽기 패널을
 * 숨긴다 — 그때는 각 항목의 원문 링크가 현재 동작(원문 이동)을 유지한다(C6).
 */
export function WikiSearchResults({ state, locale, query, projectId }: {
  state: SearchViewState
  locale: Locale
  /** 검색창에 제출된 질의(타이핑 중 값이 아니다) — 매칭 중심 스니펫과 요약 요청에 쓴다. */
  query: string
  projectId: string
}) {
  const [summary, setSummary] = useState<SummaryState>({ kind: 'idle' })
  const [selected, setSelected] = useState<number | null>(null)
  const [corpus, setCorpus] = useState<CorpusState>({ kind: 'loading' })

  // 새 검색을 실행하면 이전 요약·선택은 지운다 — state 는 검색이 바뀔 때마다 새 객체다.
  useEffect(() => { setSummary({ kind: 'idle' }); setSelected(null) }, [state])

  // 검색 전 안내 패널용 코퍼스 집계 — 마운트에 한 번. 실패는 실패라고 보여준다(0건 위장 금지).
  useEffect(() => {
    let alive = true
    fetch(`/api/wiki/search?projectId=${encodeURIComponent(projectId)}`)
      .then(async res => (res.ok ? res.json() : null))
      .then((body: { domains?: unknown; total?: unknown } | null) => {
        if (!alive) return
        if (!body || !Array.isArray(body.domains)) { setCorpus({ kind: 'error' }); return }
        const domains = (body.domains as Array<Record<string, unknown>>)
          .filter(row => typeof row.domain === 'string' && typeof row.docs === 'number')
          .map(row => ({ domain: row.domain as string, docs: row.docs as number }))
        setCorpus({ kind: 'done', domains, total: typeof body.total === 'number' ? body.total : 0 })
      })
      .catch(() => { if (alive) setCorpus({ kind: 'error' }) })
    return () => { alive = false }
  }, [projectId])

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

  const hits = state.kind === 'done' ? state.hits.slice(0, MAX_BULLETS) : []
  const selectedHit = selected !== null ? hits[selected] ?? null : null

  return (
    <div className="mt-2 flex flex-col gap-2.5">
      {/* ── 상단 툴바·요약 — 두 열 위에 전폭으로 둔다 ──
          왼쪽 열 안에 있던 시절엔 이 줄(32px)만큼 결과 카드가 아래로 밀려, 같은 행에서
          시작해야 할 오른쪽 읽기 패널과 윗변이 어긋나 화면이 흔들려 보였다(사용자 지적).
          요약도 특정 결과가 아니라 결과 전체에 대한 것이므로 전폭이 제자리다. */}
      {state.kind === 'done' && state.hits.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-0.5">
          <button
            type="button"
            onClick={() => void summarize(state.hits)}
            disabled={summary.kind === 'loading'}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-brand-ring bg-brand-weak px-3 text-xs font-semibold text-brand transition hover:bg-brand-weak/70 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {t(locale, 'wiki.search2.summarize')}
          </button>
          <span className="text-xs text-ink-subtle">
            {t(locale, 'wiki.search2.count').replace('{n}', String(state.hits.length))}
          </span>
        </div>
      )}

      {state.kind === 'done' && state.hits.length > 0 && state.degraded && (
        <p className="px-0.5 text-xs text-ink-subtle">{t(locale, 'wiki.search2.degraded')}</p>
      )}

      {summary.kind === 'loading' && (
        <div className="rounded-xl border border-line bg-surface p-3.5">
          <p className="text-sm text-ink-muted">{t(locale, 'wiki.search2.summarizing')}</p>
        </div>
      )}
      {summary.kind === 'error' && (
        <div className="rounded-xl border border-line bg-surface p-3.5">
          <p className="text-sm text-delayed">{t(locale, 'wiki.search2.summarizeFailed')}</p>
        </div>
      )}
      {summary.kind === 'done' && (
        <div className="rounded-xl border border-brand-ring bg-brand-weak p-3.5">
          <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{summary.answer}</p>
        </div>
      )}

      {/* idle 일 때 xl 미만에서는 아무것도 그리지 않는다(히어로 안내가 그 역할) —
          xl 에서만 오른쪽 안내 패널("무엇을 찾을 수 있나")을 보여준다(U2). */}
      <div className={`items-start gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)] ${state.kind === 'idle' ? 'hidden' : 'grid'}`}>
        {/* ── 왼쪽: 결과 목록 ── */}
        <div className="min-w-0" aria-live="polite">
          {state.kind === 'idle' && (
            <div className="rounded-2xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-subtle">
              {t(locale, 'wiki.pane.placeholder')}
            </div>
          )}

          {state.kind === 'loading' && (
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-md)]">
              <p className="text-sm text-ink-muted">{t(locale, 'wiki.ask.working')}</p>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-md)]">
              <p className="text-sm text-delayed">{t(locale, 'wiki.search2.error')}</p>
            </div>
          )}

          {state.kind === 'done' && state.hits.length === 0 && (
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-md)]">
              {state.degraded && (
                <p className="mb-2 text-sm text-ink-muted">{t(locale, 'wiki.search2.degraded')}</p>
              )}
              <p className="text-sm text-ink-muted">{t(locale, 'wiki.search2.empty')}</p>
            </div>
          )}

          {state.kind === 'done' && state.hits.length > 0 && (
            <ol className="flex flex-col gap-2">
                {hits.map((hit, index) => {
                  const current = selected === index
                  return (
                    <li key={`${hit.domain}:${hit.entityId}`} className="relative">
                      <button
                        type="button"
                        onClick={() => setSelected(index)}
                        aria-current={current}
                        className={`w-full rounded-xl border bg-surface px-3.5 py-3 pr-20 text-left transition ${
                          current
                            ? 'border-brand-ring border-l-[3px] border-l-brand shadow-[var(--shadow-sm)]'
                            : 'border-line hover:border-line-strong hover:shadow-[var(--shadow-sm)]'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="shrink-0 text-xs font-semibold text-ink-subtle">[{index + 1}]</span>
                          <span className="chip bg-brand-weak text-brand">{sourceLabel(locale, hit.domain)}</span>
                          {hit.occurredOn && (
                            <span className="text-[11px] text-ink-subtle">{hit.occurredOn}</span>
                          )}
                        </span>
                        <span className="mt-1 block truncate text-sm font-semibold text-ink">{hit.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-5 text-ink-muted">
                          {marked(snippetOf(hit.content, 200, query), query)}
                        </span>
                      </button>
                      {/* 버튼 안에 링크를 중첩할 수 없어 형제로 띄운다 — xl 미만에서 원문 이동의 유일한 통로(C6). */}
                      <a
                        href={hit.href}
                        className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-brand transition hover:border-brand-ring"
                      >
                        {t(locale, 'wiki.pane.source')}
                        <ArrowRight className="h-3 w-3" aria-hidden />
                      </a>
                    </li>
                  )
                })}
            </ol>
          )}
        </div>

        {/* ── 오른쪽: 읽기 패널 (xl 전용, sticky) ── */}
        {/* 검색 카드가 ProjectPageShell 고정 히어로로 빠져 스크롤 영역 위엔 아무것도 없다 —
            top-0 이면 왼쪽 첫 카드와 윗변이 정확히 맞는다. */}
        <aside className="hidden min-w-0 self-start xl:sticky xl:top-0 xl:block">
          <div className="flex min-h-[380px] flex-col gap-3 rounded-2xl border border-line bg-surface p-5 text-ink shadow-[var(--shadow-md)]">
            {selectedHit
              ? (
                <>
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                    <BookOpen className="h-3.5 w-3.5" aria-hidden />
                    {t(locale, 'wiki.pane.reading')}
                  </div>
                  <h3 className="text-base font-bold leading-6 text-ink">{selectedHit.title}</h3>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-subtle">
                    <span>{sourceLabel(locale, selectedHit.domain)}</span>
                    {selectedHit.occurredOn && <span>{selectedHit.occurredOn}</span>}
                    {selectedHit.matchedBy.length > 0 && <span>{selectedHit.matchedBy.join(' · ')}</span>}
                  </div>
                  <div className="border-t border-line" />
                  <div className="max-h-[26rem] overflow-y-auto whitespace-pre-wrap text-[13.5px] leading-7 text-ink-muted">
                    {marked(selectedHit.content, query)}
                  </div>
                  <div className="mt-auto pt-2">
                    <a href={selectedHit.href} className="btn btn-primary h-9 px-4 text-sm">
                      {t(locale, 'wiki.pane.open')}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </a>
                  </div>
                </>
              )
              : (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                    {t(locale, 'wiki.pane.guide.eyebrow')}
                  </div>
                  {state.kind === 'done' && state.hits.length > 0 && (
                    <p className="text-sm text-ink">{t(locale, 'wiki.pane.pick')}</p>
                  )}
                  <p className="text-sm leading-6 text-ink-muted">{t(locale, 'wiki.pane.guide.desc')}</p>
                  {corpus.kind === 'error' && (
                    <p className="text-xs text-ink-subtle">{t(locale, 'wiki.pane.guide.statsFailed')}</p>
                  )}
                  {corpus.kind === 'done' && (
                    <div className="mt-1 flex flex-col gap-2">
                      {(() => {
                        const max = Math.max(1, ...corpus.domains.map(row => row.docs))
                        return corpus.domains.filter(row => row.docs > 0).map(row => (
                          <div key={row.domain} className="flex items-center gap-2.5 text-[13px]">
                            <span className="w-16 shrink-0 text-ink-muted">{sourceLabel(locale, row.domain)}</span>
                            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                              <span
                                className="block h-full rounded-full bg-brand"
                                style={{ width: `${Math.max(4, Math.round((row.docs / max) * 100))}%` }}
                              />
                            </span>
                            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-ink-subtle">
                              {t(locale, 'wiki.pane.guide.docs').replace('{n}', String(row.docs))}
                            </span>
                          </div>
                        ))
                      })()}
                    </div>
                  )}
                </>
              )}
          </div>
        </aside>
      </div>
    </div>
  )
}
