'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Search, Send, Sparkles } from 'lucide-react'
import { WikiSearchResults } from './WikiSearchResults'
import { useWikiSearchQuery } from './useWikiSearchQuery'
import { toSearchViewState, type SearchViewState } from '@/lib/domain/searchView'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

// 사용자가 지정한 옛 WikiAskPanel 디자인의 추천 칩과 같은 자리 — 문구만 검색용으로 바꿨다.
const CHIP_KEYS: DictKey[] = ['wiki.search2.chip1', 'wiki.search2.chip2', 'wiki.search2.chip3']

/**
 * 검색 입력 한 벌 — 펼친 히어로와 고정 압축 바가 같은 폼을 공유한다.
 * compact 는 크기만 바꾼다. 동작(제출·조합중 Enter 무시·busy 잠금)은 한 곳뿐이어야
 * 두 모양이 갈라지지 않는다.
 */
function SearchForm({ compact, locale, query, setQuery, busy, onSubmit }: {
  compact: boolean
  locale: Locale
  query: string
  setQuery: (value: string) => void
  busy: boolean
  onSubmit: () => void
}) {
  return (
    <form
      role="search"
      className={compact ? 'flex min-w-0 flex-1 items-center gap-2' : 'mt-5 flex flex-col gap-2 sm:flex-row'}
      onSubmit={event => { event.preventDefault(); onSubmit() }}
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
          className={`${compact ? 'h-11' : 'h-12'} w-full rounded-2xl border border-white/15 bg-surface pl-11 pr-4 text-sm text-ink shadow-[var(--shadow-sm)] outline-none transition placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand-ring disabled:opacity-70`}
        />
      </div>
      <button
        type="submit"
        disabled={busy || !query.trim()}
        className={`btn btn-primary rounded-2xl ${compact ? 'h-11 shrink-0 px-4' : 'h-12 px-5'}`}
      >
        {busy ? t(locale, 'wiki.ask.working') : t(locale, 'wiki.ask.submit')}
        <Send className="h-4 w-4" aria-hidden />
      </button>
    </form>
  )
}

export function WikiSearch({ projectId, locale, initialQuery, adminSlot }: {
  projectId: string
  locale: Locale
  initialQuery: string
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

  // 입력을 비우면 검색 이전 상태로 되돌린다. 안 그러면 압축 바에 갇힌다 — 제출 버튼은
  // 빈 질의에서 비활성이라 run('') 이 호출될 길이 없고, 옛 결과만 남은 채 히어로로
  // 돌아갈 방법이 사라진다(type="search" 의 네이티브 × 를 눌러도 마찬가지).
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
  // 검색을 한 번이라도 실행하면 히어로를 접고 입력줄만 스크롤 영역 상단에 고정한다.
  // 결과를 훑는 동안 질의를 고쳐 다시 던지는 게 이 화면의 주 동선인데, 종전엔
  // 검색창이 결과와 함께 위로 밀려나 매번 맨 위로 되돌아가야 했다.
  const collapsed = state.kind !== 'idle'

  if (collapsed) {
    return (
      <>
      {/* 고정 바 — 스크롤 컨테이너는 ProjectPageShell 의 [data-project-scroll-region] 이라
          top-0 은 히어로 바로 아래에 붙는다. 아래로 지나가는 결과가 모서리 틈으로 비치지
          않도록 바깥 래퍼가 캔버스색 배경을 깔고, 가로 넘침을 만들지 않으려고 음수 마진은
          쓰지 않는다(스크롤 영역이 overflow-y-auto = overflow-x 도 auto). */}
      <div className="sticky top-0 z-30 bg-canvas/85 pb-3 pt-1 backdrop-blur-md">
        <div className="hero-card flex items-center gap-3 px-3 py-2.5 sm:px-4">
          <SearchForm
            compact
            locale={locale}
            query={query}
            setQuery={changeQuery}
            busy={busy}
            onSubmit={() => void run(query)}
          />
          {/* 색인 스트립은 다크 히어로 위 색을 쓴다 — 좁은 폭에선 바가 두 줄이 되므로 숨긴다. */}
          {adminSlot && <div className="hidden shrink-0 lg:flex">{adminSlot}</div>}
        </div>
      </div>

      <WikiSearchResults state={state} locale={locale} query={submittedQuery} projectId={projectId} />
      </>
    )
  }

  return (
    <>
    <section className="hero-card hero-glow overflow-hidden px-5 py-6 sm:px-7 sm:py-7" aria-labelledby="wiki-search-title">
      {/* 2분할 개편(2026-08-17): 결과 그리드가 카드 전폭을 쓰도록 max-w-3xl 을 풀었다.
          제목·설명만 max-w-2xl 로 따로 묶는다 — 한 줄이 지나치게 길어지지 않게(C2). */}
      <div className="relative z-10">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-hero-ink-muted">
            <Sparkles className="h-4 w-4 text-[#3fd8c6]" aria-hidden />
            {t(locale, 'wiki.ask.eyebrow')}
          </div>
          <h2 id="wiki-search-title" className="mt-2 text-xl font-bold tracking-tight text-hero-ink sm:text-2xl">
            {t(locale, 'wiki.ask.title')}
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-hero-ink-muted">{t(locale, 'wiki.search2.idle.desc')}</p>
        </div>

        <SearchForm
          compact={false}
          locale={locale}
          query={query}
          setQuery={changeQuery}
          busy={busy}
          onSubmit={() => void run(query)}
        />

        {/* 칩(좌) + 색인 갱신 스트립(우) 한 줄 — 우상단 절대배치는 2분할 읽기 패널과
            겹쳐서(C1) 검색바 아래 정적 배치로 회수했다. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap gap-1.5">
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
          {adminSlot && <div className="flex justify-end">{adminSlot}</div>}
        </div>
      </div>
    </section>

    {/* 결과 그리드는 히어로 카드 밖(캔버스)에 둔다 — hero-card 의 overflow-hidden 이
        조상에 있으면 읽기 패널의 position:sticky 가 뷰포트에 붙지 못한다(운영 실측). */}
    <WikiSearchResults state={state} locale={locale} query={submittedQuery} projectId={projectId} />
    </>
  )
}
