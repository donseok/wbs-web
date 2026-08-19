'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Search, Send, Sparkles } from 'lucide-react'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { WikiSearchResults } from './WikiSearchResults'
import { useWikiSearchQuery } from './useWikiSearchQuery'
import { toSearchViewState, type SearchViewState } from '@/lib/domain/searchView'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

// 사용자가 지정한 옛 WikiAskPanel 디자인의 추천 칩과 같은 자리 — 문구만 검색용으로 바꿨다.
const CHIP_KEYS: DictKey[] = ['wiki.search2.chip1', 'wiki.search2.chip2', 'wiki.search2.chip3']

export function WikiSearch({ projectId, locale, initialQuery, pageHero, adminSlot }: {
  projectId: string
  locale: Locale
  initialQuery: string
  /** 화면 제목 히어로. 검색 카드와 함께 고정 영역에 얹으려고 서버 페이지에서 받아 온다. */
  pageHero?: ReactNode
  /** 히어로 카드 우상단 빈 공간에 앉힐 관리 도구(색인 갱신 스트립). 슈퍼유저에게만 내려온다. */
  adminSlot?: ReactNode
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
  // "한 번뿐" 플래그(boolean ref)가 아니라 "마지막으로 자동 실행한 값"을 기억한다 —
  // Next.js 라우터가 같은 페이지 인스턴스를 재사용하며 searchParams 만 바뀌는 경우
  // (리마운트 없음) boolean 이면 최초 1회 이후의 새 ?q= 딥링크가 조용히 무시된다
  // (운영 실측 회귀: 딥링크 진입 시 자동 검색이 안 돎).
  const lastAutoQuery = useRef<string | null>(null)
  useEffect(() => {
    const trimmed = initialQuery.trim()
    if (!trimmed || lastAutoQuery.current === trimmed) return
    lastAutoQuery.current = trimmed
    void run(trimmed)
  }, [initialQuery, run])

  // 입력을 비우면 검색 이전으로 되돌린다. 빈 질의에서는 제출 버튼이 비활성이라 run('') 이
  // 불릴 길이 없어, 이 처리가 없으면 지운 질의의 결과가 그대로 남는다
  // (type="search" 의 네이티브 × 를 눌러도 마찬가지).
  const changeQuery = useCallback((value: string) => {
    setQuery(value)
    if (value.trim()) return
    seq.current++   // 진행 중인 응답이 도착해도 되살아나지 않게 무효화한다
    setState({ kind: 'idle' })
    setSubmittedQuery('')
  }, [setQuery])

  function runChip(label: string) {
    setQuery(label)
    void run(label)
  }

  const busy = state.kind === 'loading'

  // 검색 카드는 ProjectPageShell 의 고정 히어로 슬롯에 얹는다 — 스크롤에서 아예 빠지므로
  // 질문을 던진 뒤에도 카드가 그대로 남고, 결과만 아래에서 스크롤된다.
  // sticky 로 흉내내지 않는 이유: sticky 면 읽기 패널의 top 오프셋을 카드 높이에 맞춰
  // 하드코딩해야 하는데, 그 높이는 폭·번역어에 따라 바뀌어 금세 어긋난다.
  const head = (
    <div className="flex flex-col gap-3">
      {pageHero}
      <section className="hero-card hero-glow overflow-hidden px-5 py-4 sm:px-7 sm:py-5" aria-labelledby="wiki-search-title">
        {/* 2분할 개편(2026-08-17): 결과 그리드가 카드 전폭을 쓰도록 max-w-3xl 을 풀었다.
            높이 압축(2026-08-19): 이 카드는 c635f14 이후 고정 히어로라 화면에서 차지한
            높이만큼 결과·읽기 패널이 영구히 줄어든다. 아이브로우·제목·설명 3단 세로
            스택을 한 줄 baseline 정렬로 눕혀 카드를 약 1/3 낮췄다. 좁은 폭에서는
            flex-wrap 으로 종전처럼 접히므로 모바일 가독성은 그대로다. */}
        <div className="relative z-10">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="inline-flex shrink-0 translate-y-px items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-hero-ink-muted">
              <Sparkles className="h-3.5 w-3.5 text-[#3fd8c6]" aria-hidden />
              {t(locale, 'wiki.ask.eyebrow')}
            </span>
            <h2 id="wiki-search-title" className="text-lg font-bold tracking-tight text-hero-ink sm:text-xl">
              {t(locale, 'wiki.ask.title')}
            </h2>
            <p className="min-w-0 text-[13px] leading-5 text-hero-ink-muted">{t(locale, 'wiki.search2.idle.desc')}</p>
          </div>

          <form
            role="search"
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={event => { event.preventDefault(); void run(query) }}
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={event => changeQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
                }}
                placeholder={t(locale, 'wiki.search2.placeholder')}
                aria-label={t(locale, 'wiki.search2.placeholder')}
                disabled={busy}
                className="h-11 w-full rounded-2xl border border-white/15 bg-surface pl-11 pr-4 text-sm text-ink shadow-[var(--shadow-sm)] outline-none transition placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand-ring disabled:opacity-70"
              />
            </div>
            <button type="submit" disabled={busy || !query.trim()} className="btn btn-primary h-11 rounded-2xl px-5">
              {busy ? t(locale, 'wiki.ask.working') : t(locale, 'wiki.ask.submit')}
              <Send className="h-4 w-4" aria-hidden />
            </button>
          </form>

          {/* 칩(좌) + 색인 갱신 스트립(우) 한 줄 — 우상단 절대배치는 2분할 읽기 패널과
              겹쳐서(C1) 검색바 아래 정적 배치로 회수했다. */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap gap-1.5">
              {CHIP_KEYS.map(key => {
                const label = t(locale, key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => runChip(label)}
                    disabled={busy}
                    className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs text-hero-ink-muted transition hover:bg-white/[0.11] hover:text-hero-ink disabled:opacity-50"
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {adminSlot && <div className="flex justify-end">{adminSlot}</div>}
          </div>
        </div>
      </section>
    </div>
  )

  return (
    // 결과 그리드는 히어로 카드 밖(캔버스)에 둔다 — hero-card 의 overflow-hidden 이
    // 조상에 있으면 읽기 패널의 position:sticky 가 뷰포트에 붙지 못한다(운영 실측).
    <ProjectPageShell hero={head}>
      <WikiSearchResults state={state} locale={locale} query={submittedQuery} projectId={projectId} />
    </ProjectPageShell>
  )
}
