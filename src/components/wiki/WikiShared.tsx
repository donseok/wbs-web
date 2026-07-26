import Link from 'next/link'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  FileText,
  Info,
  Lightbulb,
  ListTodo,
  LockKeyhole,
  Scale,
  ShieldAlert,
  UserRoundCog,
  type LucideIcon,
} from 'lucide-react'
import type { DictKey, Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
// 상태 판정은 순수 도메인 모듈에서 직접 가져온다. lib/data/wiki를 값으로 import하면
// 클라이언트 번들에 서버 전용 supabase 클라이언트가 딸려 들어와 빌드가 깨진다.
import { isConflictedWikiItem } from '@/lib/domain/wikiView'
import type {
  WikiChangeEvent,
  WikiItem,
  WikiItemKind,
  WikiSource,
} from '@/lib/data/wiki'
import { WikiItemActions } from './WikiItemActions'

/**
 * 회의록 원문 블록 링크. lib/minutes/source의 minuteSourceHref와 같은 형식이지만 직접 만든다.
 *
 * 이 파일은 WikiExplorer/WikiTopicGrid(둘 다 'use client')가 import하면서 클라이언트 모듈
 * 그래프에 들어간다. minutes/source는 blocks.ts를 값으로 가져오고 blocks.ts는 unified·remark-parse·
 * remark-gfm을 끌어오므로, 링크 문자열 몇 줄 때문에 마크다운 파서 100KB가 Wiki 홈 번들에 실린다.
 * 형식이 갈리지 않도록 tests/ui/wiki-safety.test.tsx가 두 구현의 결과를 대조한다.
 */
export function wikiMinuteSourceHref(
  minuteId: string,
  source: { blockIndex: number; blockHash: string; bodyHash: string },
  minuteVersionId?: string | null,
): string {
  const params = new URLSearchParams({
    block: String(source.blockIndex),
    hash: source.blockHash,
    body: source.bodyHash,
  })
  if (minuteVersionId) params.set('version', minuteVersionId)
  return `/minutes/${minuteId}?${params.toString()}`
}

interface KindMeta {
  icon: LucideIcon
  labelKey: DictKey
  chip: string
  iconWrap: string
}

const KIND_META: Record<string, KindMeta> = {
  decision: {
    icon: CheckCircle2,
    labelKey: 'wiki.kind.decision',
    chip: 'bg-done-weak text-done',
    iconWrap: 'bg-done-weak text-done',
  },
  fact: {
    icon: Info,
    labelKey: 'wiki.kind.fact',
    chip: 'bg-progress-weak text-progress',
    iconWrap: 'bg-progress-weak text-progress',
  },
  action: {
    icon: ListTodo,
    labelKey: 'wiki.kind.action',
    chip: 'bg-progress-weak text-progress',
    iconWrap: 'bg-progress-weak text-progress',
  },
  question: {
    icon: CircleHelp,
    labelKey: 'wiki.kind.question',
    chip: 'bg-pending-weak text-pending',
    iconWrap: 'bg-pending-weak text-pending',
  },
  risk: {
    icon: AlertTriangle,
    labelKey: 'wiki.kind.risk',
    chip: 'bg-delayed-weak text-delayed',
    iconWrap: 'bg-delayed-weak text-delayed',
  },
  constraint: {
    icon: ShieldAlert,
    labelKey: 'wiki.kind.constraint',
    chip: 'bg-accent-warning/15 text-accent-warning',
    iconWrap: 'bg-accent-warning/15 text-accent-warning',
  },
  rationale: {
    icon: Lightbulb,
    labelKey: 'wiki.kind.rationale',
    chip: 'bg-brand-weak text-brand',
    iconWrap: 'bg-brand-weak text-brand',
  },
}

const KNOWN_STATES = new Set([
  'active',
  'archived',
  'closed',
  'confirmed',
  'conflict',
  'conflicted',
  'disputed',
  'done',
  'on_hold',
  'open',
  'proposed',
  'reversed',
  'resolved',
  'superseded',
  'tentative',
  'withdrawn',
])

const CHANGE_KEYS = new Set([
  'new',
  'created',
  'reconfirmed',
  'confirmed',
  'reaffirm',
  'refined',
  'refine',
  'updated',
  'superseded',
  'supersede',
  'withdrawn',
  'reverse',
  'conflict',
  'conflicted',
  'resolved',
  'resolve',
  'retract',
  'curate',
])

const TERMINAL_LIFECYCLE_STATES = new Set([
  'conflicted',
  'superseded',
  'resolved',
  'archived',
])

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function kindMeta(kind: WikiItemKind): KindMeta {
  return KIND_META[kind] ?? {
    icon: FileText,
    labelKey: 'wiki.kind.other',
    chip: 'bg-surface-2 text-ink-muted',
    iconWrap: 'bg-surface-2 text-ink-muted',
  }
}

/**
 * 결정 상태는 결정의 의미를, lifecycle은 항목 자체의 현재 유효성을 나타낸다.
 * 이미 충돌·대체·해결·보관된 항목을 과거 decisionState="confirmed" 때문에
 * 여전히 "확정"으로 보이지 않게 종료 lifecycle을 우선한다.
 */
const KNOWLEDGE_KINDS = new Set(['fact', 'constraint', 'rationale'])

function displayedState(item: WikiItem): string {
  const lifecycle = normalized(item.lifecycleState)
  if (TERMINAL_LIFECYCLE_STATES.has(lifecycle)) return lifecycle
  const decision = normalized(item.decisionState)
  if (decision) return decision
  // 사실·제약·근거는 결정 상태가 없어 lifecycle만으로 표시되는데, 잠정 지식까지
  // "현재 유효"로 보이면 논의 중인 내용을 확정 사실로 읽게 된다.
  // (액션·질문·리스크는 '열림'이 그 자체로 미결 신호라 그대로 둔다.)
  if (KNOWLEDGE_KINDS.has(item.kind) && normalized(item.certainty) === 'tentative') {
    return 'tentative'
  }
  return lifecycle
}

function stateLabel(locale: Locale, item: WikiItem): string {
  const state = displayedState(item)
  if (!KNOWN_STATES.has(state)) return state || t(locale, 'wiki.state.unknown')
  return t(locale, `wiki.state.${state}` as DictKey)
}

function stateChip(item: WikiItem): string {
  const state = displayedState(item)
  if (isConflictedWikiItem(item)) return 'bg-delayed-weak text-delayed'
  if (['resolved', 'done', 'confirmed'].includes(state)) return 'bg-done-weak text-done'
  if (state === 'reversed') return 'bg-delayed-weak text-delayed'
  if (['superseded', 'withdrawn', 'archived', 'closed'].includes(state)) return 'bg-surface-2 text-ink-subtle'
  if (['tentative', 'proposed', 'on_hold'].includes(state)) return 'bg-pending-weak text-pending'
  return 'bg-brand-weak text-brand'
}

export function formatWikiDate(
  value: string | null | undefined,
  locale: Locale,
  includeTime = false,
): string {
  if (!value) return ''
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: dateOnly ? 'UTC' : 'Asia/Seoul',
  }).format(parsed)
}

function sourceHref(source: WikiSource): string {
  if (
    source.bodyHash
    && source.blockHash
    && source.blockIndex !== null
  ) {
    return wikiMinuteSourceHref(source.minuteId, {
      blockIndex: source.blockIndex,
      blockHash: source.blockHash,
      bodyHash: source.bodyHash,
    }, source.minuteVersionId)
  }
  return source.minuteVersionId
    ? `/minutes/${source.minuteId}?version=${encodeURIComponent(source.minuteVersionId)}`
    : `/minutes/${source.minuteId}`
}

function changeSourceHref(change: WikiChangeEvent): string {
  if (
    change.minuteId
    && change.sourceBodyHash
    && change.sourceBlockHash
    && change.sourceBlockIndex !== null
    && change.sourceBlockIndex !== undefined
  ) {
    return wikiMinuteSourceHref(change.minuteId, {
      blockIndex: change.sourceBlockIndex,
      blockHash: change.sourceBlockHash,
      bodyHash: change.sourceBodyHash,
    }, change.minuteVersionId)
  }
  return change.minuteVersionId
    ? `/minutes/${change.minuteId}?version=${encodeURIComponent(change.minuteVersionId)}`
    : `/minutes/${change.minuteId}`
}

export function WikiSourceLinks({
  sources,
  locale,
  showEvidence = false,
}: {
  sources: WikiSource[]
  locale: Locale
  showEvidence?: boolean
}) {
  if (sources.length === 0) return null
  return (
    <div className="mt-3 space-y-2 border-t border-line/80 pt-3">
      {sources.slice(0, showEvidence ? 4 : 2).map((source, index) => (
        <div key={source.id || `${source.minuteId}-${source.blockIndex ?? index}`}>
          <Link
            href={sourceHref(source)}
            className="group/source inline-flex max-w-full items-center gap-1.5 text-xs font-medium text-brand hover:text-brand-hover"
            aria-label={`${source.minuteTitle ?? t(locale, 'wiki.viewSource')} ${t(locale, 'wiki.viewSource')}`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {source.minuteDate ? `${formatWikiDate(source.minuteDate, locale)} · ` : ''}
              {source.minuteTitle ?? t(locale, 'wiki.viewSource')}
            </span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-60 transition group-hover/source:opacity-100" />
          </Link>
          {showEvidence && source.evidenceExcerpt && (
            <blockquote className="mt-1.5 border-l-2 border-line-strong pl-3 text-xs leading-5 text-ink-muted">
              {source.evidenceExcerpt}
            </blockquote>
          )}
        </div>
      ))}
      {sources.length > (showEvidence ? 4 : 2) && (
        <span className="text-[11px] text-ink-subtle">
          {t(locale, 'wiki.sourceCount').replace('{n}', String(sources.length))}
        </span>
      )}
    </div>
  )
}

export function WikiItemCard({
  item,
  locale,
  showEvidence = false,
  curateProjectId,
}: {
  item: WikiItem
  locale: Locale
  showEvidence?: boolean
  /** 넘기면 큐레이션 버튼이 붙는다. 읽기 전용 문맥(회의록 영향 카드 등)에서는 생략한다. */
  curateProjectId?: string
}) {
  const meta = kindMeta(item.kind)
  const Icon = meta.icon
  const date = item.dueDate ?? item.observedAt ?? item.validFrom
  const ownerName = typeof item.structuredData.owner_name === 'string'
    ? item.structuredData.owner_name.trim()
    : ''
  const owner = [item.ownerTeam, ownerName].filter(Boolean).join(' · ')

  return (
    <article id={`wiki-item-${item.id}`} className="scroll-mt-6 rounded-2xl border border-line bg-surface px-4 py-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.iconWrap}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`chip ${meta.chip}`}>{t(locale, meta.labelKey)}</span>
            <span className={`chip ${stateChip(item)}`}>{stateLabel(locale, item)}</span>
            {item.autoUpdateLocked && (
              <span className="chip bg-surface-2 text-ink-muted">
                <LockKeyhole className="h-3 w-3" />
                {t(locale, 'wiki.locked')}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium leading-6 text-ink">{item.statement}</p>
          {(owner || date) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-subtle">
              {owner && <span>{t(locale, 'wiki.ownerTeam')} · {owner}</span>}
              {date && (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" />
                  {item.dueDate
                    ? t(locale, 'wiki.dueDate').replace('{date}', formatWikiDate(date, locale))
                    : t(locale, 'wiki.observedAt').replace('{date}', formatWikiDate(date, locale))}
                </span>
              )}
            </div>
          )}
          <WikiSourceLinks sources={item.sources} locale={locale} showEvidence={showEvidence} />
          {curateProjectId && (
            <WikiItemActions item={item} projectId={curateProjectId} locale={locale} />
          )}
        </div>
      </div>
    </article>
  )
}

function snapshotString(snapshot: Record<string, unknown> | null, keys: string[]): string | null {
  if (!snapshot) return null
  for (const key of keys) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function changeStatement(change: WikiChangeEvent): string | null {
  return snapshotString(change.afterSnapshot, ['statement', 'title', 'topic_title', 'topicTitle'])
    ?? snapshotString(change.beforeSnapshot, ['statement', 'title', 'topic_title', 'topicTitle'])
}

function changeLabel(locale: Locale, type: string): string {
  const key = normalized(type)
  return CHANGE_KEYS.has(key)
    ? t(locale, `wiki.change.${key}` as DictKey)
    : t(locale, 'wiki.change.other')
}

function changeTone(type: string): { dot: string; badge: string; icon: LucideIcon } {
  const key = normalized(type)
  if (key === 'retract') {
    return { dot: 'bg-ink-subtle', badge: 'bg-surface-2 text-ink-subtle', icon: FileText }
  }
  if (key === 'curate') {
    return { dot: 'bg-accent-warning', badge: 'bg-accent-warning/15 text-accent-warning', icon: UserRoundCog }
  }
  if (['conflict', 'conflicted', 'withdrawn', 'reverse'].includes(key)) {
    return { dot: 'bg-delayed', badge: 'bg-delayed-weak text-delayed', icon: AlertTriangle }
  }
  if (['resolved', 'resolve', 'confirmed', 'reconfirmed', 'reaffirm'].includes(key)) {
    return { dot: 'bg-done', badge: 'bg-done-weak text-done', icon: CheckCircle2 }
  }
  if (['superseded', 'supersede', 'updated', 'refined', 'refine'].includes(key)) {
    return { dot: 'bg-progress', badge: 'bg-progress-weak text-progress', icon: Scale }
  }
  return { dot: 'bg-brand', badge: 'bg-brand-weak text-brand', icon: Lightbulb }
}

export function WikiChangeList({
  changes,
  locale,
  limit,
  emptyText,
}: {
  changes: WikiChangeEvent[]
  locale: Locale
  limit?: number
  emptyText?: string
}) {
  const visible = typeof limit === 'number' ? changes.slice(0, limit) : changes
  if (visible.length === 0) {
    return <p className="py-5 text-center text-sm text-ink-muted">{emptyText ?? t(locale, 'wiki.noTimeline')}</p>
  }

  return (
    <ol className="relative space-y-0 before:absolute before:bottom-4 before:left-[7px] before:top-4 before:w-px before:bg-line">
      {visible.map((change) => {
        const tone = changeTone(change.changeType)
        const Icon = tone.icon
        const statement = changeStatement(change)
        return (
          <li key={change.id} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0">
            <span className={`relative z-10 mt-1.5 h-[15px] w-[15px] rounded-full border-[4px] border-surface ${tone.dot}`} />
            <div className="min-w-0 rounded-xl border border-line/80 bg-surface-2/55 px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`chip ${tone.badge}`}>
                  <Icon className="h-3 w-3" />
                  {changeLabel(locale, change.changeType)}
                </span>
                <time className="text-[11px] tabular-nums text-ink-subtle">
                  {formatWikiDate(change.createdAt, locale, true)}
                </time>
              </div>
              {statement && <p className="mt-2 text-sm font-medium leading-5 text-ink">{statement}</p>}
              <p className="mt-1 text-xs leading-5 text-ink-muted">
                {change.reason ?? t(locale, 'wiki.change.noReason')}
              </p>
              {change.minuteId && (
                <Link
                  href={changeSourceHref(change)}
                  className="mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px] font-medium text-brand hover:text-brand-hover"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {change.minuteDate ? `${formatWikiDate(change.minuteDate, locale)} · ` : ''}
                    {change.minuteTitle ?? t(locale, 'wiki.viewSource')}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </Link>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
