import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import type { SearchViewState } from '@/lib/domain/searchView'

const SOURCE_KEYS: Record<string, DictKey> = {
  minutes: 'wiki.search2.source.minutes',
  issues: 'wiki.search2.source.issues',
  wbs: 'wiki.search2.source.wbs',
  announcements: 'wiki.search2.source.announcements',
  meetings: 'wiki.search2.source.meetings',
  weekly: 'wiki.search2.source.weekly',
}

export function WikiSearchResults({ state, locale }: { state: SearchViewState; locale: Locale }) {
  if (state.kind === 'idle' || state.kind === 'loading') return null

  if (state.kind === 'error') {
    return <p className="text-sm text-delayed">{t(locale, 'wiki.search2.error')}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {state.degraded && (
        <p className="text-sm text-ink-muted">{t(locale, 'wiki.search2.degraded')}</p>
      )}

      {state.hits.length === 0
        ? <p className="text-sm text-ink-muted">{t(locale, 'wiki.search2.empty')}</p>
        : (
          <>
            <p className="text-sm text-ink-muted">
              {t(locale, 'wiki.search2.count').replace('{n}', String(state.hits.length))}
            </p>
            <ul className="flex flex-col gap-3">
              {state.hits.map(hit => (
                <li key={`${hit.domain}:${hit.entityId}`} className="card p-4">
                  <a href={hit.href} className="font-medium text-brand hover:text-brand-hover">
                    {hit.title}
                  </a>
                  <p className="mt-1 text-sm text-ink-muted line-clamp-2">{hit.content}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                    <span className="chip bg-brand-weak text-brand">
                      {SOURCE_KEYS[hit.domain] ? t(locale, SOURCE_KEYS[hit.domain]) : hit.domain}
                    </span>
                    {hit.occurredOn && <span>{hit.occurredOn}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
    </div>
  )
}
