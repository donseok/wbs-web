'use client'
// 주제 지도 — 검색 + 점진 노출. 프로젝트 주제가 150장을 넘어가도 한 화면에 전부
// 쏟아내지 않고, 찾는 주제를 이름·본문·문서 유형·담당팀으로 좁힐 수 있게 한다.
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpenText, Search } from 'lucide-react'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import { matchesWikiTopicQuery } from '@/lib/domain/wikiView'
import type { WikiTopicSummary } from '@/lib/data/wiki'
import { formatWikiDate } from './WikiShared'
import { trackWikiEvent } from './wikiAnalytics'

const PAGE_SIZE = 12

type TopicSort = 'recent' | 'items' | 'title'

export function WikiTopicGrid({
  projectId,
  topics,
  locale,
}: {
  projectId: string
  topics: WikiTopicSummary[]
  locale: Locale
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<TopicSort>('recent')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const lastTrackedQuery = useRef('')

  const filtered = useMemo(() => {
    const matched = topics.filter((topic) => matchesWikiTopicQuery(topic, query))
    const sorted = [...matched]
    if (sort === 'items') sorted.sort((a, b) => b.itemCount - a.itemCount)
    else if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, locale === 'ko' ? 'ko' : 'en'))
    else sorted.sort((a, b) => b.lastChangedAt.localeCompare(a.lastChangedAt))
    return sorted
  }, [topics, query, sort, locale])

  const shown = filtered.slice(0, visible)

  function trackSearchIntent() {
    const normalizedQuery = query.trim()
    if (!normalizedQuery || normalizedQuery === lastTrackedQuery.current) return
    lastTrackedQuery.current = normalizedQuery
    trackWikiEvent('wiki_search', `/p/${projectId}/wiki`, {
      source: 'topic_grid',
      result_count: filtered.length,
      query_length: normalizedQuery.length,
    })
  }

  function trackTopicOpen() {
    trackSearchIntent()
    trackWikiEvent('wiki_topic_opened', `/p/${projectId}/wiki`, {
      source: 'topic_grid',
      status: query.trim() ? 'search_result' : 'browse',
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value
              if (!nextQuery.trim()) lastTrackedQuery.current = ''
              setQuery(nextQuery)
              setVisible(PAGE_SIZE)
            }}
            onBlur={trackSearchIntent}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) trackSearchIntent()
            }}
            placeholder={t(locale, 'wiki.topic.searchPlaceholder')}
            aria-label={t(locale, 'wiki.topic.searchPlaceholder')}
            className="app-input pl-9"
          />
        </div>
        <div className="seg" role="tablist" aria-label={t(locale, 'wiki.topic.sortLabel')}>
          {(['recent', 'items', 'title'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={sort === key}
              onClick={() => { setSort(key); setVisible(PAGE_SIZE) }}
              className={`rounded-lg px-3 py-2 text-[13px] font-medium transition duration-150 ${sort === key ? 'seg-item-active' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'}`}
            >
              {t(locale, key === 'recent' ? 'wiki.topic.sortRecent' : key === 'items' ? 'wiki.topic.sortItems' : 'wiki.topic.sortTitle')}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-xs text-ink-muted">
        {t(locale, 'wiki.resultCount')
          .replace('{shown}', String(shown.length))
          .replace('{total}', String(filtered.length))}
      </p>

      {shown.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-muted">
          {t(locale, 'wiki.search.noResult')}
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map((topic) => (
              <Link
                key={topic.id}
                href={`/p/${projectId}/wiki/topics/${topic.id}`}
                onClick={trackTopicOpen}
                className="group rounded-2xl border border-line bg-surface px-4 py-4 shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-2/45 focus-visible:-translate-y-0.5"
                aria-label={`${topic.title} ${t(locale, 'wiki.openTopic')}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-weak text-brand">
                    <BookOpenText className="h-4 w-4" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-ink-subtle transition group-hover:translate-x-0.5 group-hover:text-brand" />
                </div>
                <div className="mt-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-sm font-semibold text-ink">{topic.title}</h3>
                    {topic.type !== 'general' && (
                      <span className="chip bg-surface-2 text-ink-muted">{topic.type}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {topic.ownerTeam ?? t(locale, 'wiki.noOwner')} · {t(locale, 'wiki.updatedAt')} {formatWikiDate(topic.lastChangedAt, locale)}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line/80 pt-3">
                  <span className="chip bg-surface-2 text-ink-muted">
                    {t(locale, 'wiki.topic.itemCount').replace('{n}', String(topic.itemCount))}
                  </span>
                  <span className="chip bg-done-weak text-done">
                    {t(locale, 'wiki.topic.decisionCount').replace('{n}', String(topic.activeDecisionCount))}
                  </span>
                  <span className="chip bg-pending-weak text-pending">
                    {t(locale, 'wiki.topic.openCount').replace('{n}', String(topic.openItemCount))}
                  </span>
                  {topic.conflictCount > 0 && (
                    <span className="chip bg-delayed-weak text-delayed">
                      {t(locale, 'wiki.topic.conflictCount').replace('{n}', String(topic.conflictCount))}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
          {filtered.length > shown.length && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setVisible((current) => current + PAGE_SIZE)}
                className="btn btn-ghost"
              >
                {t(locale, 'wiki.showMore')
                  .replace('{n}', String(Math.min(PAGE_SIZE, filtered.length - shown.length)))}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
