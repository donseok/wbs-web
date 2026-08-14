import { Search } from 'lucide-react'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import { snippetOf, type SearchViewState } from '@/lib/domain/searchView'
import { EmptyState } from '@/components/ui/EmptyState'

const SOURCE_KEYS: Record<string, DictKey> = {
  minutes: 'wiki.search2.source.minutes',
  issues: 'wiki.search2.source.issues',
  wbs: 'wiki.search2.source.wbs',
  announcements: 'wiki.search2.source.announcements',
  meetings: 'wiki.search2.source.meetings',
  weekly: 'wiki.search2.source.weekly',
}

export function WikiSearchResults({ state, locale }: { state: SearchViewState; locale: Locale }) {
  if (state.kind === 'idle') {
    return (
      <EmptyState
        icon={Search}
        title={t(locale, 'wiki.search2.idle.title')}
        description={t(locale, 'wiki.search2.idle.desc')}
      />
    )
  }

  // 뒤에서 임베딩 API 가 429 재시도를 도는 동안 5초 넘게 이어질 수 있다 — 빈 화면은 고장으로
  // 읽힌다(에러 처리 3원칙: 표시 = 로깅).
  if (state.kind === 'loading') {
    return <p className="text-sm text-ink-muted">{t(locale, 'wiki.ask.working')}</p>
  }

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
                  <p className="mt-1 text-sm text-ink-muted line-clamp-2">{snippetOf(hit.content)}</p>
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
