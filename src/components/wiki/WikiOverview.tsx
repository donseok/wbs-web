import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  CircleAlert,
  GitCompareArrows,
  LibraryBig,
  ListTodo,
  Tags,
} from 'lucide-react'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import {
  isActiveWikiDecision,
  isOpenWikiItem,
  type WikiOverviewData,
} from '@/lib/data/wiki'
import { EmptyState } from '@/components/ui/EmptyState'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { formatWikiDate, WikiChangeList, WikiItemCard } from './WikiShared'

export function WikiOverview({
  projectId,
  data,
  locale,
}: {
  projectId: string
  data: WikiOverviewData
  locale: Locale
}) {
  const currentDecisions = data.items.filter(isActiveWikiDecision).slice(0, 5)
  const openItems = data.items
    .filter(isOpenWikiItem)
    .sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      return b.updatedAt.localeCompare(a.updatedAt)
    })
    .slice(0, 6)
  const hasKnowledge = data.topics.length > 0 || data.items.length > 0 || data.changes.length > 0

  return (
    <div className="space-y-5">
      <section aria-label={t(locale, 'wiki.currentStatus')} className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label={t(locale, 'wiki.kpi.topics')}
          value={data.summary.topicCount}
          sub={t(locale, 'wiki.kpi.topicsSub')}
          icon={Tags}
          tone="brand"
        />
        <KpiCard
          label={t(locale, 'wiki.kpi.decisions')}
          value={data.summary.activeDecisionCount}
          sub={t(locale, 'wiki.kpi.decisionsSub')}
          icon={CheckCircle2}
          tone="success"
        />
        <KpiCard
          label={t(locale, 'wiki.kpi.open')}
          value={data.summary.openItemCount}
          sub={t(locale, 'wiki.kpi.openSub')}
          icon={ListTodo}
          tone="warning"
        />
        <KpiCard
          label={t(locale, 'wiki.kpi.conflicts')}
          value={data.summary.conflictCount}
          sub={t(locale, 'wiki.kpi.conflictsSub')}
          icon={CircleAlert}
          tone={data.summary.conflictCount > 0 ? 'danger' : 'default'}
        />
      </section>

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
          <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
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
                limit={6}
                emptyText={t(locale, 'wiki.noChanges')}
              />
            </SectionCard>

            <SectionCard
              eyebrow={t(locale, 'wiki.section.decisions.eyebrow')}
              title={t(locale, 'wiki.section.decisions.title')}
              icon={CheckCircle2}
            >
              <p className="-mt-2 mb-3 text-xs text-ink-muted">
                {t(locale, 'wiki.section.decisions.desc')}
              </p>
              {currentDecisions.length > 0 ? (
                <div className="space-y-3">
                  {currentDecisions.map((item) => (
                    <WikiItemCard key={item.id} item={item} locale={locale} />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
                  {t(locale, 'wiki.topic.noDecision')}
                </p>
              )}
            </SectionCard>
          </div>

          <SectionCard
            eyebrow={t(locale, 'wiki.section.open.eyebrow')}
            title={t(locale, 'wiki.section.open.title')}
            icon={AlertTriangle}
          >
            <p className="-mt-2 mb-3 text-xs text-ink-muted">
              {t(locale, 'wiki.section.open.desc')}
            </p>
            {openItems.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {openItems.map((item) => (
                  <WikiItemCard key={item.id} item={item} locale={locale} />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
                {t(locale, 'wiki.topic.noOpen')}
              </p>
            )}
          </SectionCard>

          <SectionCard
            eyebrow={t(locale, 'wiki.section.topics.eyebrow')}
            title={t(locale, 'wiki.section.topics.title')}
            icon={Tags}
          >
            <p className="-mt-2 mb-3 text-xs text-ink-muted">
              {t(locale, 'wiki.section.topics.desc')}
            </p>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {data.topics.map((topic) => (
                <Link
                  key={topic.id}
                  href={`/p/${projectId}/wiki/topics/${topic.id}`}
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
          </SectionCard>
        </>
      )}
    </div>
  )
}
