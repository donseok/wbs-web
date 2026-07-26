import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  CircleHelp,
  GitCompareArrows,
  Info,
  ListTodo,
  ShieldAlert,
} from 'lucide-react'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import {
  type WikiItem,
  type WikiTopicDetailData,
} from '@/lib/data/wiki'
import {
  isActiveWikiDecision,
  isClosedByPersonWikiItem,
  isCurrentWikiKnowledge,
  isOpenWikiItem,
  isUnsettledWikiKnowledge,
} from '@/lib/domain/wikiView'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionCard } from '@/components/ui/SectionCard'
import { formatWikiDate, WikiChangeList, WikiItemCard } from './WikiShared'

function currentKnowledge(items: WikiItem[]): WikiItem[] {
  return items.filter(isCurrentWikiKnowledge)
}

function OpenGroup({
  kind,
  items,
  locale,
  curateProjectId,
}: {
  kind: 'action' | 'question' | 'risk'
  items: WikiItem[]
  locale: Locale
  curateProjectId?: string
}) {
  const meta = {
    action: {
      icon: ListTodo,
      title: t(locale, 'wiki.kind.action'),
      wrap: 'bg-progress-weak text-progress',
    },
    question: {
      icon: CircleHelp,
      title: t(locale, 'wiki.kind.question'),
      wrap: 'bg-pending-weak text-pending',
    },
    risk: {
      icon: AlertTriangle,
      title: t(locale, 'wiki.kind.risk'),
      wrap: 'bg-delayed-weak text-delayed',
    },
  }[kind]
  const Icon = meta.icon
  const grouped = items.filter((item) => item.kind === kind)

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${meta.wrap}`}>
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold text-ink">{meta.title}</h3>
        <span className="ml-auto text-xs font-semibold tabular-nums text-ink-subtle">{grouped.length}</span>
      </div>
      <div className="mt-3 space-y-3">
        {grouped.length > 0 ? grouped.map((item) => (
          <WikiItemCard key={item.id} item={item} locale={locale} showEvidence curateProjectId={curateProjectId} />
        )) : (
          <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-ink-muted">
            {t(locale, 'wiki.noItems')}
          </p>
        )}
      </div>
    </section>
  )
}

export function WikiTopicDetail({
  projectId,
  data,
  locale,
  canCurate = false,
}: {
  projectId: string
  data: WikiTopicDetailData
  locale: Locale
  /** 큐레이션 버튼 노출 여부. 서버에서 멤버십으로 판정한다 — 실제 권한은 RPC가 다시 막는다. */
  canCurate?: boolean
}) {
  if (!data.topic) {
    return (
      <div className="space-y-4">
        <Link
          href={`/p/${projectId}/wiki`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-hover"
        >
          <ArrowLeft className="h-4 w-4" />
          {t(locale, 'wiki.backHome')}
        </Link>
        <EmptyState
          icon={BookOpenText}
          title={data.available ? t(locale, 'wiki.topic.notFound') : t(locale, 'wiki.empty.title')}
          description={data.available ? t(locale, 'wiki.topic.notFoundDesc') : t(locale, 'wiki.empty.desc')}
          action={
            <Link href={`/p/${projectId}/wiki`} className="btn btn-ghost">
              <ArrowLeft className="h-4 w-4" />
              {t(locale, 'wiki.backHome')}
            </Link>
          }
        />
      </div>
    )
  }

  const topic = data.topic
  // 사람이 완료 처리하거나 숨긴 항목은 이 화면의 어떤 섹션에도 넣지 않는다.
  // 되돌리기는 홈 탐색기의 '완료'·'숨김' 뷰가 담당한다 — 여기서 함께 렌더하면
  // 숨김을 눌러도 카드가 그대로 남아 "숨김이 안 먹는다"로 보인다.
  const items = data.items.filter((item) => !isClosedByPersonWikiItem(item))
  const decisions = items
    .filter((item) => item.kind === 'decision')
    .sort((a, b) => Number(isActiveWikiDecision(b)) - Number(isActiveWikiDecision(a)))
  const knowledge = currentKnowledge(items)
  // 결정·현재 지식·열린 항목 어디에도 안 걸리는 잠정 사실/제약을 담는 그룹.
  // 이 섹션이 없으면 조회는 되는데 화면에는 없는 항목이 생긴다.
  const unsettled = items.filter(isUnsettledWikiKnowledge)
  const openItems = items.filter(isOpenWikiItem)
  const curateProjectId = canCurate ? projectId : undefined

  return (
    <div className="space-y-5">
      <Link
        href={`/p/${projectId}/wiki`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-hover"
      >
        <ArrowLeft className="h-4 w-4" />
        {t(locale, 'wiki.backHome')}
      </Link>

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {topic.type !== 'general' && (
                <span className="chip bg-brand-weak text-brand">{topic.type}</span>
              )}
              {topic.conflictCount > 0 && (
                <span className="chip bg-delayed-weak text-delayed">
                  <AlertTriangle className="h-3 w-3" />
                  {t(locale, 'wiki.topic.conflictCount').replace('{n}', String(topic.conflictCount))}
                </span>
              )}
            </div>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-ink">{topic.title}</h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              {topic.ownerTeam ?? t(locale, 'wiki.noOwner')}
              <span className="mx-2 text-line-strong">·</span>
              {t(locale, 'wiki.updatedAt')} {formatWikiDate(topic.lastChangedAt, locale)}
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-3 gap-2">
            <div className="rounded-xl bg-surface-2 px-3 py-2 text-center">
              <div className="text-lg font-bold tabular-nums text-ink">{topic.itemCount}</div>
              <div className="text-[10px] text-ink-subtle">{t(locale, 'wiki.kind.other')}</div>
            </div>
            <div className="rounded-xl bg-done-weak px-3 py-2 text-center">
              <div className="text-lg font-bold tabular-nums text-done">{topic.activeDecisionCount}</div>
              <div className="text-[10px] text-done">{t(locale, 'wiki.kind.decision')}</div>
            </div>
            <div className="rounded-xl bg-pending-weak px-3 py-2 text-center">
              <div className="text-lg font-bold tabular-nums text-pending">{topic.openItemCount}</div>
              <div className="text-[10px] text-pending">{t(locale, 'wiki.state.open')}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <div className="space-y-5">
          <SectionCard
            eyebrow={t(locale, 'wiki.section.current.eyebrow')}
            title={t(locale, 'wiki.section.current.title')}
            icon={Info}
          >
            <p className="-mt-2 mb-3 text-xs text-ink-muted">
              {t(locale, 'wiki.section.current.desc')}
            </p>
            {knowledge.length > 0 ? (
              <div className="space-y-3">
                {knowledge.map((item) => (
                  <WikiItemCard key={item.id} item={item} locale={locale} showEvidence curateProjectId={curateProjectId} />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
                {t(locale, 'wiki.noItems')}
              </p>
            )}
          </SectionCard>

          <SectionCard
            eyebrow={t(locale, 'wiki.section.decisions.eyebrow')}
            title={t(locale, 'wiki.section.decisions.title')}
            icon={CheckCircle2}
          >
            <p className="-mt-2 mb-3 text-xs text-ink-muted">
              {t(locale, 'wiki.section.decisions.desc')}
            </p>
            {decisions.length > 0 ? (
              <div className="space-y-3">
                {decisions.map((item) => (
                  <WikiItemCard key={item.id} item={item} locale={locale} showEvidence curateProjectId={curateProjectId} />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
                {t(locale, 'wiki.topic.noDecision')}
              </p>
            )}
          </SectionCard>

          {unsettled.length > 0 && (
            <SectionCard
              eyebrow={t(locale, 'wiki.section.unsettled.eyebrow')}
              title={t(locale, 'wiki.section.unsettled.title')}
              icon={CircleHelp}
            >
              <p className="-mt-2 mb-3 text-xs text-ink-muted">
                {t(locale, 'wiki.section.unsettled.desc')}
              </p>
              <div className="space-y-3">
                {unsettled.map((item) => (
                  <WikiItemCard key={item.id} item={item} locale={locale} showEvidence curateProjectId={curateProjectId} />
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        <SectionCard
          eyebrow={t(locale, 'wiki.section.timeline.eyebrow')}
          title={t(locale, 'wiki.section.timeline.title')}
          icon={GitCompareArrows}
          className="xl:sticky xl:top-0"
        >
          <p className="-mt-2 mb-3 text-xs text-ink-muted">
            {t(locale, 'wiki.section.timeline.desc')}
          </p>
          <WikiChangeList changes={data.changes} locale={locale} />
        </SectionCard>
      </div>

      <SectionCard
        eyebrow={t(locale, 'wiki.section.open.eyebrow')}
        title={t(locale, 'wiki.section.open.title')}
        icon={ShieldAlert}
      >
        <p className="-mt-2 mb-3 text-xs text-ink-muted">
          {t(locale, 'wiki.section.open.desc')}
        </p>
        {openItems.length > 0 ? (
          <div className="grid items-start gap-3 xl:grid-cols-3">
            <OpenGroup kind="action" items={openItems} locale={locale} curateProjectId={curateProjectId} />
            <OpenGroup kind="question" items={openItems} locale={locale} curateProjectId={curateProjectId} />
            <OpenGroup kind="risk" items={openItems} locale={locale} curateProjectId={curateProjectId} />
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
            {t(locale, 'wiki.topic.noOpen')}
          </p>
        )}
      </SectionCard>
    </div>
  )
}
