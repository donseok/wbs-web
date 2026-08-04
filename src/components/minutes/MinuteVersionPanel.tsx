'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Download, FileText, History } from 'lucide-react'
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
  // 독립 카드(과거 버전 열람 화면)에서만 접는다 — embedded 는 핵심 요약 카드의 접힘 영역
  // 안이라 이중 접기가 되고, 그 화면은 이미 기본 접힘이다.
  // 기본값을 접힘으로 두는 이유: 이 카드가 화면 위쪽을 다 먹어 정작 회의록 본문이 밀려났다.
  // 접힌 헤더가 총 개수와 열람 중 버전을 그대로 알리므로 정보는 잃지 않는다.
  const collapsible = !embedded
  const [open, setOpen] = useState(!collapsible)
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
    <section className={embedded ? 'min-w-0' : 'card shrink-0 px-4 py-2'} aria-labelledby="minute-version-title">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-brand" aria-hidden />
        <h2 id="minute-version-title" className="text-sm font-bold text-ink">
          {t('min.version.title')}
        </h2>
        {/* 접힘 상태에서도 '몇 번을 보고 있나'가 남아야 한다 — 없으면 기본 접힘이 위쪽 배너
            (MinuteViewer)가 계속 존재한다는 가정에 기대게 된다. 펼치면 같은 신호가 해당 버전
            항목(위 renderVersion)에 붙으므로 그때는 뺀다 — 중복 표시 방지. */}
        {collapsible && !open && selectedVersionNo != null && (
          <span className="chip bg-brand-weak text-brand">
            v{selectedVersionNo} {t('min.version.viewing')}
          </span>
        )}
        {/* 우측 끝 고정점은 **마지막 요소** 하나뿐이다 — 토글이 있으면 토글이, 없으면(embedded)
            개수가 가져간다. 둘 다 ml-auto 면 맨텍스트 '총 2개'와 '펼치기'가 8px 간격으로 붙어
            한 덩어리로 읽힌다(MinuteInsightCard 는 왼쪽 이웃이 배경 있는 chip 이라 붙어도 구분된다). */}
        <span className={`text-xs text-ink-subtle ${collapsible ? '' : 'ml-auto'}`}>
          {t('min.version.total').replace('{n}', String(ordered.length))}
        </span>
        {collapsible && (
          <button onClick={() => setOpen(o => !o)} aria-expanded={open}
            className="ml-auto inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
            {open
              ? <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            {open ? t('min.version.collapse') : t('min.version.expand')}
          </button>
        )}
      </div>

      {/* 카드 인셋이 py-2 라 아래는 그대로 8px 면 되고(InsightCard 와 동일), 위는 wrapper 4px +
          p 의 mt-1 4px = 8px 로 맞춘다. embedded 는 클래스 없는 통과 div — 간격 무변경.
          max-h-96: 상한이 없으면 버전이 8~10개인 회의록에서 펼침 한 번에 카드가 다시 600px 넘게
          자라 본문을 밀어낸다 — 접기로 없앤 문제가 클릭 한 번 뒤로 미뤄질 뿐이다. embedded 는
          MinuteInsightCard 의 펼침 영역(max-h-96 overflow-y-auto)이 이미 감싸므로 붙이지 않는다. */}
      {open && (
        <div className={collapsible ? 'mt-1 max-h-96 overflow-y-auto' : undefined}>
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
        </div>
      )}
    </section>
  )
}
