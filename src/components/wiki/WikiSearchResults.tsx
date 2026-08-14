import { ArrowRight } from 'lucide-react'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import { snippetOf, type SearchViewState } from '@/lib/domain/searchView'

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

export function WikiSearchResults({ state, locale }: { state: SearchViewState; locale: Locale }) {
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
                <p className="text-sm text-ink-muted">{t(locale, 'wiki.search2.answer.intro')}</p>
                <ol className="mt-3 flex flex-col gap-2.5">
                  {state.hits.slice(0, MAX_BULLETS).map((hit, index) => (
                    <li key={`${hit.domain}:${hit.entityId}`} className="flex gap-2 text-sm leading-6 text-ink">
                      <span className="shrink-0 font-semibold text-ink-subtle">[{index + 1}]</span>
                      <span className="min-w-0">
                        <span className="chip mr-1.5 bg-brand-weak text-brand">
                          {SOURCE_KEYS[hit.domain] ? t(locale, SOURCE_KEYS[hit.domain]) : hit.domain}
                        </span>
                        {snippetOf(hit.content)}
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
