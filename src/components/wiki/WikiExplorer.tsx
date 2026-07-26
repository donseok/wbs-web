'use client'
// 지식 탐색기 — Wiki 홈에서 모든 항목에 실제로 도달하기 위한 단일 진입점.
// 이전 홈은 결정 5건·열린 항목 6건만 티저로 보여주고 나머지는 154장 주제 카드를 뒤져야
// 닿을 수 있었고, 잠정 사실·제약과 미확정 결정은 어떤 화면에도 나타나지 않았다.
// 필터·정렬 규칙은 lib/domain/wikiView가 정본이며 여기서는 상태와 표시만 담당한다.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ListFilter, Search, X } from 'lucide-react'
import type { DictKey, Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import { WIKI_ITEM_KINDS } from '@/lib/domain/wiki'
import {
  countWikiViews,
  filterWikiEntries,
  WIKI_VIEWS,
  type WikiView,
} from '@/lib/domain/wikiView'
import type { WikiItem } from '@/lib/data/wiki'
import { WikiItemCard } from './WikiShared'

export interface WikiExplorerItem extends WikiItem {
  topicTitle: string
}

const PAGE_SIZE = 12

const VIEW_LABEL: Record<WikiView, DictKey> = {
  all: 'wiki.view.all',
  decision: 'wiki.view.decision',
  open: 'wiki.view.open',
  discussing: 'wiki.view.discussing',
  conflict: 'wiki.view.conflict',
  resolved: 'wiki.view.resolved',
  archived: 'wiki.view.archived',
}

const VIEW_HINT: Record<WikiView, DictKey> = {
  all: 'wiki.view.allHint',
  decision: 'wiki.view.decisionHint',
  open: 'wiki.view.openHint',
  discussing: 'wiki.view.discussingHint',
  conflict: 'wiki.view.conflictHint',
  resolved: 'wiki.view.resolvedHint',
  archived: 'wiki.view.archivedHint',
}

export function WikiExplorer({
  projectId,
  items,
  locale,
  initialView = 'all',
  canCurate = false,
}: {
  projectId: string
  items: WikiExplorerItem[]
  locale: Locale
  initialView?: WikiView
  canCurate?: boolean
}) {
  const [view, setView] = useState<WikiView>(initialView)
  const [kind, setKind] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const counts = useMemo(() => countWikiViews(items), [items])
  const filtered = useMemo(
    () => filterWikiEntries(items, { view, kind, query }),
    [items, view, kind, query],
  )
  const shown = filtered.slice(0, visible)

  // 필터가 바뀌면 항상 첫 페이지부터 본다. 이전 "더 보기" 깊이가 남아 있으면
  // 결과 2건짜리 필터에서도 스크롤이 아래에 머물러 빈 화면처럼 보인다.
  function apply(next: () => void) {
    next()
    setVisible(PAGE_SIZE)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => apply(() => setQuery(event.target.value))}
            placeholder={t(locale, 'wiki.search.placeholder')}
            aria-label={t(locale, 'wiki.search.placeholder')}
            className="app-input pl-9"
          />
        </div>
        <div className="seg flex-wrap" role="tablist" aria-label={t(locale, 'wiki.view.label')}>
          {WIKI_VIEWS.map((key) => {
            const active = key === view
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                title={t(locale, VIEW_HINT[key])}
                onClick={() => apply(() => setView(key))}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition duration-150 ${active ? 'seg-item-active' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'}`}
              >
                {t(locale, VIEW_LABEL[key])}
                <span className={`tabular-nums ${active ? 'text-white/80' : 'text-ink-subtle'}`}>
                  {counts[key]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <ListFilter className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
        <button
          type="button"
          onClick={() => apply(() => setKind('all'))}
          aria-pressed={kind === 'all'}
          className={`chip cursor-pointer transition ${kind === 'all' ? 'bg-brand-weak text-brand' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}
        >
          {t(locale, 'wiki.filter.allKinds')}
        </button>
        {WIKI_ITEM_KINDS.map((itemKind) => {
          const available = items.some((item) => item.kind === itemKind)
          if (!available) return null
          const active = kind === itemKind
          return (
            <button
              key={itemKind}
              type="button"
              onClick={() => apply(() => setKind(itemKind))}
              aria-pressed={active}
              className={`chip cursor-pointer transition ${active ? 'bg-brand-weak text-brand' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}
            >
              {t(locale, `wiki.kind.${itemKind}` as DictKey)}
            </button>
          )
        })}
        {(query || kind !== 'all' || view !== 'all') && (
          <button
            type="button"
            onClick={() => apply(() => { setQuery(''); setKind('all'); setView('all') })}
            className="chip cursor-pointer bg-surface-2 text-ink-subtle transition hover:text-ink"
          >
            <X className="h-3 w-3" aria-hidden />
            {t(locale, 'wiki.filter.reset')}
          </button>
        )}
      </div>

      <p className="mt-3 text-xs text-ink-muted">
        {t(locale, VIEW_HINT[view])}
        <span className="mx-2 text-line-strong">·</span>
        {t(locale, 'wiki.resultCount')
          .replace('{shown}', String(shown.length))
          .replace('{total}', String(filtered.length))}
      </p>

      {shown.length > 0 ? (
        <>
          <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
            {shown.map((item) => (
              <div key={item.id} className="flex min-w-0 flex-col">
                <Link
                  href={`/p/${projectId}/wiki/topics/${item.topicId}`}
                  className="group mb-1 inline-flex max-w-full items-center gap-1 self-start text-[11px] font-medium text-ink-subtle transition hover:text-brand"
                >
                  <span className="truncate">{item.topicTitle}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 transition group-hover:translate-x-0.5" aria-hidden />
                </Link>
                <WikiItemCard item={item} locale={locale} showEvidence curateProjectId={canCurate ? projectId : undefined} />
              </div>
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
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-muted">
          {query || kind !== 'all'
            ? t(locale, 'wiki.search.noResult')
            : t(locale, 'wiki.noItems')}
        </p>
      )}
    </div>
  )
}
