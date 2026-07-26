import Link from 'next/link'
import {
  BookOpenText,
  GitCompareArrows,
  LibraryBig,
  Search,
  Tags,
} from 'lucide-react'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import type { WikiOverviewData } from '@/lib/data/wiki'
import type { WikiView } from '@/lib/domain/wikiView'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionCard } from '@/components/ui/SectionCard'
import { formatWikiDate, WikiChangeList } from './WikiShared'
import { WikiExplorer, type WikiExplorerItem } from './WikiExplorer'
import { WikiTopicGrid } from './WikiTopicGrid'
import { WikiMergeTopics } from './WikiMergeTopics'

export function WikiOverview({
  projectId,
  data,
  locale,
  view = 'all',
  canCurate = false,
  canMergeTopics = false,
}: {
  projectId: string
  data: WikiOverviewData
  locale: Locale
  view?: WikiView
  canCurate?: boolean
  canMergeTopics?: boolean
}) {
  const topicTitleById = new Map(data.topics.map((topic) => [topic.id, topic.title]))
  const entries: WikiExplorerItem[] = data.items.map((item) => ({
    ...item,
    topicTitle: topicTitleById.get(item.topicId) ?? t(locale, 'wiki.kind.other'),
  }))
  // 항목이 하나도 남지 않은 주제는 지도에서 뺀다(빈 카드 102장이 지도를 덮는 실측 사례).
  // topicTitleById는 전체 주제로 만든다 — 숨김 뷰의 항목도 주제 이름을 잃지 않아야 한다.
  const visibleTopics = data.topics.filter((topic) => topic.itemCount > 0)
  const hasKnowledge = data.topics.length > 0 || data.items.length > 0 || data.changes.length > 0

  return (
    <div className="space-y-5">
      {!hasKnowledge ? (
        <div>
          <EmptyState
            icon={LibraryBig}
            title={t(locale, 'wiki.empty.title')}
            description={t(locale, 'wiki.empty.desc')}
            action={
              <Link href="/minutes" className="btn btn-ghost">
                <BookOpenText className="h-4 w-4" />
                {t(locale, 'wiki.viewMinutes')}
              </Link>
            }
          />
          {!data.available && (
            <p className="mt-2 text-center text-xs text-ink-subtle">
              {t(locale, 'wiki.empty.schemaHint')}
            </p>
          )}
        </div>
      ) : (
        <>
          <div id="wiki-explorer" className="scroll-mt-4">
            <SectionCard
              eyebrow={t(locale, 'wiki.section.explorer.eyebrow')}
              title={t(locale, 'wiki.section.explorer.title')}
              icon={Search}
            >
              <p className="-mt-2 mb-3 text-xs text-ink-muted">
                {t(locale, 'wiki.section.explorer.desc')}
              </p>
              <WikiExplorer
                key={view}
                projectId={projectId}
                items={entries}
                locale={locale}
                initialView={view}
                canCurate={canCurate}
              />
            </SectionCard>
          </div>

          <SectionCard
            eyebrow={t(locale, 'wiki.section.changes.eyebrow')}
            title={t(locale, 'wiki.section.changes.title')}
            icon={GitCompareArrows}
            actions={data.summary.lastChangedAt ? (
              <span className="text-[11px] text-ink-subtle">
                {t(locale, 'wiki.updatedAt')} · {formatWikiDate(data.summary.lastChangedAt, locale)}
              </span>
            ) : undefined}
          >
            <p className="-mt-2 mb-3 text-xs text-ink-muted">
              {t(locale, 'wiki.section.changes.desc')}
            </p>
            <WikiChangeList
              changes={data.changes}
              locale={locale}
              limit={8}
              emptyText={t(locale, 'wiki.noChanges')}
            />
          </SectionCard>

          <SectionCard
            eyebrow={t(locale, 'wiki.section.topics.eyebrow')}
            title={t(locale, 'wiki.section.topics.title')}
            icon={Tags}
          >
            <p className="-mt-2 mb-3 text-xs text-ink-muted">
              {t(locale, 'wiki.section.topics.desc')}
            </p>
            {canMergeTopics && (
              <div className="mb-4">
                <WikiMergeTopics projectId={projectId} topics={visibleTopics} locale={locale} />
              </div>
            )}
            <WikiTopicGrid projectId={projectId} topics={visibleTopics} locale={locale} />
          </SectionCard>
        </>
      )}
    </div>
  )
}
