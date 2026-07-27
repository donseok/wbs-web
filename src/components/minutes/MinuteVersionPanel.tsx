'use client'

import Link from 'next/link'
import { Download, FileText, History } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

export type MinuteVersionListItem = {
  id: string
  versionNo: number
  /** 이 버전이 생성될 당시의 불변 회의록 메타데이터. */
  title?: string | null
  minuteDate?: string | null
  createdAt: string
  createdByName?: string | null
  fileName?: string | null
  downloadHref?: string | null
  viewHref?: string | null
}

export type MinuteVersionPanelProps = {
  versions: MinuteVersionListItem[]
  currentVersionNo?: number | null
  selectedVersionNo?: number | null
  embedded?: boolean
}

function versionDate(value: string, locale: 'ko' | 'en') {
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

export function MinuteVersionPanel({
  versions,
  currentVersionNo,
  selectedVersionNo,
  embedded = false,
}: MinuteVersionPanelProps) {
  const { locale, t } = useLocale()
  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo)
  const resolvedCurrent = currentVersionNo ?? ordered[0]?.versionNo ?? null
  const current = ordered.find(version => version.versionNo === resolvedCurrent) ?? ordered[0] ?? null
  const previous = current
    ? ordered.filter(version => version.id !== current.id)
    : []

  if (!current) return null

  const renderVersion = (version: MinuteVersionListItem, isCurrent: boolean) => {
    const isSelected = selectedVersionNo === version.versionNo
    return (
    <li
      key={version.id}
      className={`rounded-lg border p-3 ${
        isCurrent || isSelected ? 'border-brand/30 bg-brand-weak/40' : 'border-line bg-surface'
      }`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {version.viewHref ? (
          <Link href={version.viewHref} className="inline-flex items-center gap-1.5 text-sm font-bold text-ink hover:text-brand">
            <FileText className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
            v{version.versionNo}
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-ink">
            <FileText className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
            v{version.versionNo}
          </span>
        )}
        {isCurrent && (
          <span className="chip bg-progress-weak text-progress">
            <span className="h-1.5 w-1.5 rounded-full bg-progress" />
            {t('min.version.current')}
          </span>
        )}
        {isSelected && !isCurrent && (
          <span className="chip bg-brand-weak text-brand">{t('min.version.viewing')}</span>
        )}
        <span className="text-xs tabular-nums text-ink-subtle">
          {versionDate(version.createdAt, locale)}
        </span>
        {version.createdByName && (
          <span className="text-xs text-ink-muted">{version.createdByName}</span>
        )}
        {version.downloadHref && (
          <a
            href={version.downloadHref}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex max-w-full items-center gap-1 text-xs text-brand hover:text-brand-hover"
          >
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="max-w-48 truncate">
              {version.fileName || t('min.version.download')}
            </span>
          </a>
        )}
      </div>
      {!version.downloadHref && (
        <p className="mt-1 text-xs text-ink-subtle">{t('min.version.noFile')}</p>
      )}
    </li>
    )
  }

  return (
    <section className={embedded ? 'min-w-0' : 'card shrink-0 p-4'} aria-labelledby="minute-version-title">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-brand" aria-hidden />
        <h2 id="minute-version-title" className="text-sm font-bold text-ink">
          {t('min.version.title')}
        </h2>
        <span className="ml-auto text-xs text-ink-subtle">
          {t('min.version.total').replace('{n}', String(ordered.length))}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-muted">{t('min.version.desc')}</p>

      <ul className="mt-3 space-y-2">
        {renderVersion(current, true)}
      </ul>

      {previous.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="eyebrow mb-2">{t('min.version.previous')}</p>
          <ul className="space-y-2">
            {previous.map(version => renderVersion(version, false))}
          </ul>
        </div>
      )}
    </section>
  )
}
