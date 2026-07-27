'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Clock3, LoaderCircle } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

export type MinuteWikiSyncStatus =
  | 'unlinked'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'partial'
  | 'failed'

export type MinuteWikiImpactCounts = {
  created: number
  changed: number
  reaffirmed: number
  conflicted: number
}

export type MinuteWikiImpactItem = {
  id: string
  title: string
  href: string
  kindLabel?: string | null
  change: keyof MinuteWikiImpactCounts
}

export type MinuteWikiImpactCardProps = {
  status: MinuteWikiSyncStatus
  counts: MinuteWikiImpactCounts
  items: MinuteWikiImpactItem[]
  wikiHref?: string | null
  projectName?: string | null
  processedAt?: string | null
  embedded?: boolean
}

const COUNT_STYLE: Record<keyof MinuteWikiImpactCounts, string> = {
  created: 'bg-done-weak text-done',
  changed: 'bg-progress-weak text-progress',
  reaffirmed: 'bg-surface-2 text-ink-muted',
  conflicted: 'bg-delayed-weak text-delayed',
}

function statusStyle(status: MinuteWikiSyncStatus) {
  switch (status) {
    case 'ready':
      return {
        chip: 'bg-done-weak text-done',
        dot: 'bg-done',
        icon: CheckCircle2,
        label: 'min.wiki.status.ready' as const,
      }
    case 'partial':
      return {
        chip: 'bg-accent-warning/15 text-accent-warning',
        dot: 'bg-accent-warning',
        icon: AlertTriangle,
        label: 'min.wiki.status.partial' as const,
      }
    case 'failed':
      return {
        chip: 'bg-delayed-weak text-delayed',
        dot: 'bg-delayed',
        icon: AlertTriangle,
        label: 'min.wiki.status.failed' as const,
      }
    case 'processing':
      return {
        chip: 'bg-progress-weak text-progress',
        dot: 'bg-progress',
        icon: LoaderCircle,
        label: 'min.wiki.status.processing' as const,
      }
    case 'queued':
      return {
        chip: 'bg-surface-2 text-ink-muted',
        dot: 'bg-ink-subtle',
        icon: Clock3,
        label: 'min.wiki.status.queued' as const,
      }
    default:
      return {
        chip: 'bg-surface-2 text-ink-muted',
        dot: 'bg-ink-subtle',
        icon: BookOpen,
        label: 'min.wiki.status.unlinked' as const,
      }
  }
}

function countLabel(change: keyof MinuteWikiImpactCounts) {
  switch (change) {
    case 'created': return 'min.wiki.count.created' as const
    case 'changed': return 'min.wiki.count.changed' as const
    case 'reaffirmed': return 'min.wiki.count.reaffirmed' as const
    case 'conflicted': return 'min.wiki.count.conflicted' as const
  }
}

function statusDescription(status: MinuteWikiSyncStatus) {
  switch (status) {
    case 'unlinked': return 'min.wiki.desc.unlinked' as const
    case 'queued': return 'min.wiki.desc.queued' as const
    case 'processing': return 'min.wiki.desc.processing' as const
    case 'failed': return 'min.wiki.desc.failed' as const
    default: return 'min.wiki.desc.ready' as const
  }
}

function processedDate(value: string, locale: 'ko' | 'en') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function MinuteWikiImpactCard({
  status,
  counts,
  items,
  wikiHref,
  projectName,
  processedAt,
  embedded = false,
}: MinuteWikiImpactCardProps) {
  const { locale, t } = useLocale()
  const meta = statusStyle(status)
  const StatusIcon = meta.icon
  const countEntries = (Object.keys(counts) as (keyof MinuteWikiImpactCounts)[])

  return (
    <section className={embedded ? 'min-w-0' : 'card shrink-0 p-4'} aria-labelledby="minute-wiki-title">
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="h-4 w-4 text-brand" aria-hidden />
        <h2 id="minute-wiki-title" className="text-sm font-bold text-ink">
          {t('min.wiki.title')}
        </h2>
        {projectName && <span className="text-xs text-ink-muted">{projectName}</span>}
        <span className={`chip ${meta.chip}`}>
          <StatusIcon
            className={`h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`}
            aria-hidden
          />
          {t(meta.label)}
        </span>
        {wikiHref && (
          <Link href={wikiHref} className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover">
            {t('min.wiki.open')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>

      <p className="mt-1 text-xs text-ink-muted">{t(statusDescription(status))}</p>

      {status !== 'unlinked' && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {countEntries.map(change => (
            <div key={change} className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="text-[11px] text-ink-subtle">{t(countLabel(change))}</p>
              <p className={`mt-0.5 inline-flex rounded-md px-1.5 py-0.5 text-sm font-bold tabular-nums ${COUNT_STYLE[change]}`}>
                {counts[change]}
              </p>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="eyebrow mb-1">{t('min.wiki.affected')}</p>
          <ul className="space-y-1">
            {items.map(item => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm hover:bg-surface-2"
                >
                  <span className={`chip shrink-0 ${COUNT_STYLE[item.change]}`}>
                    {t(countLabel(item.change))}
                  </span>
                  {item.kindLabel && (
                    <span className="shrink-0 text-xs text-ink-subtle">{item.kindLabel}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-ink">{item.title}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(status === 'ready' || status === 'partial') && items.length === 0 && (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
          {t('min.wiki.noChanges')}
        </p>
      )}

      {processedAt && (
        <p className="mt-2 text-right text-[11px] tabular-nums text-ink-subtle">
          {t('min.wiki.processedAt')} {processedDate(processedAt, locale)}
        </p>
      )}
    </section>
  )
}
