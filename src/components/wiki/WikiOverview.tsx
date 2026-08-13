import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FileCheck2,
  GitCompareArrows,
  LibraryBig,
  PauseCircle,
  Search,
  Tags,
} from 'lucide-react'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import type { WikiItem, WikiOverviewData } from '@/lib/data/wiki'
import type { WikiView } from '@/lib/domain/wikiView'
import {
  isActiveWikiDecision,
  isConflictedWikiItem,
} from '@/lib/domain/wikiView'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionCard } from '@/components/ui/SectionCard'
import { formatWikiDate, WikiChangeList, WikiSourceLinks } from './WikiShared'
import { WikiExplorer, type WikiExplorerItem } from './WikiExplorer'
import { WikiTopicGrid } from './WikiTopicGrid'
import { WikiMergeTopics } from './WikiMergeTopics'
import { WikiAskPanel } from './WikiAskPanel'
import { WikiCreateDocumentButton } from './WikiDocumentEditor'
import { WikiProposalActions } from './WikiProposalActions'
import { WikiQuestionAnswerForm } from './WikiQuestionAnswerForm'

type MemoryQuestion = {
  id: string
  topicId?: string | null
  question: string
  answer?: string | null
  status: string
  createdAt: string
  answeredAt?: string | null
}

type MemoryOverviewData = WikiOverviewData & {
  readState?: 'ready' | 'schema_missing' | 'error'
  automationState?: 'active' | 'paused'
  questions?: MemoryQuestion[]
  proposals?: WikiItem[]
  changesTruncated?: boolean
}

function itemReviewState(item: WikiItem): string {
  return (item as WikiItem & { reviewState?: string }).reviewState ?? 'accepted'
}

function isAccepted(item: WikiItem): boolean {
  return itemReviewState(item) === 'accepted'
}

function topicHasDocument(topic: WikiOverviewData['topics'][number]): boolean {
  const body = (topic as typeof topic & { bodyMd?: string | null }).bodyMd
  return typeof body === 'string' && body.trim().length > 0
}

function isReviewDue(value: string | null | undefined): boolean {
  if (!value) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && time <= Date.now()
}

function WikiKeyDecisions({
  projectId,
  items,
  topicTitleById,
  locale,
}: {
  projectId: string
  items: WikiItem[]
  topicTitleById: Map<string, string>
  locale: Locale
}) {
  const decisions = items.filter((item) => isAccepted(item) && isActiveWikiDecision(item)).slice(0, 6)
  if (decisions.length === 0) {
    return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">{t(locale, 'wiki.topic.noDecision')}</p>
  }
  return (
    <ul className="divide-y divide-line/80">
      {decisions.map((item) => (
        <li key={item.id} className="py-3 first:pt-0 last:pb-0">
          <Link href={`/p/${projectId}/wiki/topics/${item.topicId}#wiki-item-${item.id}`} className="group block rounded-xl p-2 transition hover:bg-surface-2/65">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-done-weak text-done">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-6 text-ink">{item.statement}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-subtle">
                  <span>{topicTitleById.get(item.topicId) ?? t(locale, 'wiki.kind.other')}</span>
                  {item.ownerTeam && <><span>·</span><span>{item.ownerTeam}</span></>}
                  {item.sources.length > 0 && <><span>·</span><span>{t(locale, 'wiki.sourceCount').replace('{n}', String(item.sources.length))}</span></>}
                </div>
              </div>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-subtle transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function WikiAttentionPanel({
  projectId,
  proposals,
  conflicts,
  questions,
  reviewDueTopics,
  locale,
  canCurate,
  canAnswer,
}: {
  projectId: string
  proposals: WikiItem[]
  conflicts: WikiItem[]
  questions: MemoryQuestion[]
  reviewDueTopics: WikiOverviewData['topics']
  locale: Locale
  canCurate: boolean
  canAnswer: boolean
}) {
  const total = proposals.length + conflicts.length + questions.length + reviewDueTopics.length
  if (total === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-done-weak px-4 py-4 text-sm text-done">
        <FileCheck2 className="h-5 w-5 shrink-0" aria-hidden />
        <span className="font-medium">{t(locale, 'wiki.attention.clear')}</span>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {proposals.slice(0, 4).map((item) => (
        <article key={`proposal-${item.id}`} className="rounded-xl border border-pending/25 bg-pending-weak/55 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip bg-pending-weak text-pending">{t(locale, 'wiki.attention.proposal')}</span>
            <span className="text-[11px] text-ink-subtle">{t(locale, `wiki.kind.${item.kind}` as Parameters<typeof t>[1])}</span>
          </div>
          <p className="mt-2 text-sm font-medium leading-6 text-ink">{item.statement}</p>
          <WikiSourceLinks sources={item.sources} locale={locale} />
          {canCurate && <WikiProposalActions projectId={projectId} topicId={item.topicId} itemId={item.id} locale={locale} />}
        </article>
      ))}
      {conflicts.slice(0, 3).map((item) => (
        <Link key={`conflict-${item.id}`} href={`/p/${projectId}/wiki/topics/${item.topicId}#wiki-item-${item.id}`} className="flex items-start gap-3 rounded-xl border border-delayed/25 bg-delayed-weak/55 px-4 py-3 transition hover:border-delayed/45">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-delayed" aria-hidden />
          <div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-delayed">{t(locale, 'wiki.attention.conflict')}</div><p className="mt-1 text-sm leading-5 text-ink">{item.statement}</p></div>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
        </Link>
      ))}
      {questions.slice(0, 4).map((question) => (
        <article id={`wiki-question-${question.id}`} key={`question-${question.id}`} className="flex scroll-mt-4 items-start gap-3 rounded-xl border border-line bg-surface-2/55 px-4 py-3">
          <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-pending" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-ink-subtle">{t(locale, 'wiki.attention.unanswered')}</div>
            <p className="mt-1 text-sm leading-5 text-ink">{question.question}</p>
            <p className="mt-1 text-[11px] text-ink-subtle">{t(locale, 'wiki.attention.anonymous')} · {formatWikiDate(question.createdAt, locale)}</p>
            {canAnswer && <WikiQuestionAnswerForm projectId={projectId} topicId={question.topicId ?? null} questionId={question.id} locale={locale} />}
          </div>
        </article>
      ))}
      {reviewDueTopics.slice(0, 3).map((topic) => (
        <Link key={`review-${topic.id}`} href={`/p/${projectId}/wiki/topics/${topic.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-brand-ring">
          <Clock3 className="h-4 w-4 shrink-0 text-accent-warning" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{topic.title}</span>
          <span className="text-[11px] text-accent-warning">{t(locale, 'wiki.attention.reviewDue')}</span>
        </Link>
      ))}
      {total > 14 && <p className="text-center text-xs text-ink-subtle">{t(locale, 'wiki.attention.more').replace('{n}', String(total - 14))}</p>}
    </div>
  )
}

function WikiAnsweredQuestions({
  projectId,
  questions,
  topicTitleById,
  locale,
  highlightQuestionId,
}: {
  projectId: string
  questions: MemoryQuestion[]
  topicTitleById: Map<string, string>
  locale: Locale
  highlightQuestionId?: string | null
}) {
  const highlighted = highlightQuestionId
    ? questions.find((question) => question.id === highlightQuestionId)
    : undefined
  const shownQuestions = highlighted
    ? [highlighted, ...questions.filter((question) => question.id !== highlighted.id).slice(0, 9)]
    : questions.slice(0, 10)
  const hiddenCount = questions.length - shownQuestions.length
  return (
    <section className="card p-5 sm:p-6" aria-labelledby="wiki-answered-questions-title">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-weak text-brand">
            <CircleHelp className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">{t(locale, 'wiki.section.answers.eyebrow')}</div>
            <h3 id="wiki-answered-questions-title" className="mt-0.5 text-sm font-semibold text-ink">{t(locale, 'wiki.section.answers.title')}</h3>
          </div>
        </div>
        <span className="chip bg-done-weak text-done">{questions.length}</span>
      </div>
      <p className="mt-3 text-xs leading-5 text-ink-muted">{t(locale, 'wiki.section.answers.desc')}</p>
      <ol className="mt-4 divide-y divide-line/80">
        {shownQuestions.map((question) => {
          const questionLabelId = `wiki-question-${question.id}-label`
          const topicTitle = question.topicId ? topicTitleById.get(question.topicId) : null
          return (
            <li key={question.id} className="py-4 first:pt-0 last:pb-0">
              <article id={`wiki-question-${question.id}`} aria-labelledby={questionLabelId} className="scroll-mt-4 rounded-xl bg-surface-2/55 px-4 py-3">
                <h4 id={questionLabelId} className="text-sm font-semibold leading-6 text-ink">{question.question}</h4>
                <div className="mt-2 border-l-2 border-brand/35 pl-3">
                  <span className="sr-only">{t(locale, 'wiki.question.answerLabel')}: </span>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-ink-muted">{question.answer}</p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-subtle">
                  {question.answeredAt && <time dateTime={question.answeredAt}>{formatWikiDate(question.answeredAt, locale)}</time>}
                  {question.topicId && topicTitle && (
                    <Link href={`/p/${projectId}/wiki/topics/${question.topicId}`} className="font-medium text-brand hover:text-brand-hover">
                      {topicTitle}<ArrowRight className="ml-0.5 inline h-3 w-3" aria-hidden />
                    </Link>
                  )}
                </div>
              </article>
            </li>
          )
        })}
      </ol>
      {hiddenCount > 0 && (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-center text-xs text-ink-muted">
          {t(locale, 'wiki.section.answers.more').replace('{n}', String(hiddenCount))}
        </p>
      )}
    </section>
  )
}

export function WikiOverview({
  projectId,
  data: rawData,
  locale,
  view = 'all',
  canCurate = false,
  canMergeTopics = false,
  canEditDocuments = canCurate,
  highlightQuestionId = null,
  initialQuery = '',
  viewerId = null,
}: {
  projectId: string
  data: WikiOverviewData
  locale: Locale
  view?: WikiView
  canCurate?: boolean
  canMergeTopics?: boolean
  canEditDocuments?: boolean
  highlightQuestionId?: string | null
  initialQuery?: string
  viewerId?: string | null
}) {
  const data = rawData as MemoryOverviewData
  const acceptedItems = data.items.filter(isAccepted)
  const topicTitleById = new Map(data.topics.map((topic) => [topic.id, topic.title]))
  const entries: WikiExplorerItem[] = acceptedItems.map((item) => ({
    ...item,
    topicTitle: topicTitleById.get(item.topicId) ?? t(locale, 'wiki.kind.other'),
  }))
  const visibleTopics = data.topics.filter((topic) => topic.itemCount > 0 || topicHasDocument(topic))
  const proposals = (data.proposals ?? data.items.filter((item) => itemReviewState(item) === 'pending'))
    .filter((item) => itemReviewState(item) === 'pending')
  const conflicts = acceptedItems.filter(isConflictedWikiItem)
  const questions = (data.questions ?? []).filter((question) => !['answered', 'resolved', 'closed'].includes(question.status))
  const answeredQuestions = (data.questions ?? []).filter((question) => (
    ['answered', 'resolved', 'closed'].includes(question.status)
    && typeof question.answer === 'string'
    && question.answer.trim().length > 0
  ))
  const reviewDueTopics = data.topics.filter((topic) => isReviewDue((topic as typeof topic & { reviewDueAt?: string | null }).reviewDueAt))
  const hasKnowledge = visibleTopics.length > 0 || acceptedItems.length > 0 || data.changes.length > 0 || answeredQuestions.length > 0
  const readState = data.readState ?? (data.available ? 'ready' : 'schema_missing')
  const extensionReady = readState === 'ready'
  const canWriteMemory = extensionReady && canEditDocuments
  // 0079 신규 기능(제안 검토·문서 편집·질문·피드백)만 스키마 준비를 기다린다.
  const canReviewMemory = extensionReady && canCurate
  // 항목 큐레이션(보관·해결·잠금·확정)과 주제 병합은 0048/0053 RPC 라 이미 운영에 있다.
  // extensionReady 로 함께 묶으면 0079 미적용 기간 내내 관리자가 기존 지식을 정리하지
  // 못하면서 화면에는 '문서 기능 준비 중' 이라고만 떠서 원인을 오진하게 된다.
  const canCurateLegacy = canCurate

  return (
    <div className="space-y-5">
      <WikiAskPanel projectId={projectId} locale={locale} canLeaveQuestion={canWriteMemory} searchHref={`/p/${projectId}/wiki`} />

      {data.automationState === 'paused' && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-warning/30 bg-accent-warning/10 px-4 py-3 text-sm" role="status">
          <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-warning" aria-hidden />
          <div><div className="font-semibold text-ink">{t(locale, 'wiki.automation.pausedTitle')}</div><p className="mt-0.5 leading-5 text-ink-muted">{t(locale, 'wiki.automation.pausedDesc')}</p></div>
        </div>
      )}

      {readState !== 'ready' && (
        <div className="flex items-start gap-3 rounded-2xl border border-delayed/25 bg-delayed-weak/45 px-4 py-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-delayed" aria-hidden />
          <div><div className="font-semibold text-ink">{readState === 'error' ? t(locale, 'wiki.read.errorTitle') : t(locale, 'wiki.read.schemaTitle')}</div><p className="mt-0.5 leading-5 text-ink-muted">{readState === 'error' ? t(locale, 'wiki.read.errorDesc') : t(locale, 'wiki.read.schemaDesc')}</p></div>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-5">
          <SectionCard
            eyebrow={t(locale, 'wiki.section.attention.eyebrow')}
            title={t(locale, 'wiki.section.attention.title')}
            icon={AlertTriangle}
            actions={<span className="chip bg-pending-weak text-pending">{proposals.length + conflicts.length + questions.length + reviewDueTopics.length}</span>}
          >
            <p className="-mt-2 mb-3 text-xs leading-5 text-ink-muted">{t(locale, 'wiki.section.attention.desc')}</p>
            <WikiAttentionPanel projectId={projectId} proposals={proposals} conflicts={conflicts} questions={questions} reviewDueTopics={reviewDueTopics} locale={locale} canCurate={canReviewMemory} canAnswer={canWriteMemory} />
          </SectionCard>

          <SectionCard
            eyebrow={t(locale, 'wiki.section.decisions.eyebrow')}
            title={t(locale, 'wiki.section.decisions.title')}
            icon={CheckCircle2}
            actions={<Link href={`/p/${projectId}/wiki?view=decision#wiki-explorer`} className="text-xs font-medium text-brand hover:text-brand-hover">{t(locale, 'wiki.viewAll')} <ArrowRight className="inline h-3.5 w-3.5" /></Link>}
          >
            <p className="-mt-2 mb-3 text-xs text-ink-muted">{t(locale, 'wiki.section.decisions.desc')}</p>
            <WikiKeyDecisions projectId={projectId} items={acceptedItems} topicTitleById={topicTitleById} locale={locale} />
          </SectionCard>
        </div>

        <SectionCard
          eyebrow={t(locale, 'wiki.section.changes.eyebrow')}
          title={t(locale, 'wiki.section.changes.title')}
          icon={GitCompareArrows}
          actions={data.summary.lastChangedAt ? <span className="text-[11px] text-ink-subtle">{formatWikiDate(data.summary.lastChangedAt, locale)}</span> : undefined}
        >
          <p className="-mt-2 mb-3 text-xs text-ink-muted">{t(locale, 'wiki.section.changes.memoryDesc')}</p>
          <WikiChangeList changes={data.changes} locale={locale} limit={7} emptyText={t(locale, 'wiki.noChanges')} />
          {(data.changesTruncated || data.dataTruncated) && <p className="mt-3 rounded-lg bg-pending-weak px-3 py-2 text-xs text-pending">{t(locale, 'wiki.changes.truncated')}</p>}
        </SectionCard>
      </div>

      {answeredQuestions.length > 0 && (
        <WikiAnsweredQuestions
          projectId={projectId}
          questions={answeredQuestions}
          topicTitleById={topicTitleById}
          locale={locale}
          highlightQuestionId={highlightQuestionId}
        />
      )}

      {!hasKnowledge ? (
        <EmptyState
          icon={LibraryBig}
          title={t(locale, 'wiki.empty.memoryTitle')}
          description={t(locale, 'wiki.empty.memoryDesc')}
          action={canWriteMemory
            ? <WikiCreateDocumentButton projectId={projectId} locale={locale} />
            : <Link href="/minutes" className="btn btn-ghost"><BookOpenText className="h-4 w-4" />{t(locale, 'wiki.viewMinutes')}</Link>}
        />
      ) : (
        <div id="wiki-explorer" className="scroll-mt-4 space-y-5">
          <SectionCard
            eyebrow={t(locale, 'wiki.section.explorer.eyebrow')}
            title={t(locale, 'wiki.section.explorer.memoryTitle')}
            icon={Search}
            actions={canWriteMemory ? <WikiCreateDocumentButton projectId={projectId} locale={locale} /> : undefined}
          >
            <p className="-mt-2 mb-3 text-xs text-ink-muted">{t(locale, 'wiki.section.explorer.memoryDesc')}</p>
            <WikiExplorer
              key={`${view}:${initialQuery}`}
              projectId={projectId}
              items={entries}
              locale={locale}
              initialView={view}
              initialQuery={initialQuery}
              canCurate={canCurateLegacy}
            />
          </SectionCard>

          <SectionCard eyebrow={t(locale, 'wiki.section.topics.eyebrow')} title={t(locale, 'wiki.section.topics.memoryTitle')} icon={Tags}>
            <p className="-mt-2 mb-3 text-xs text-ink-muted">{t(locale, 'wiki.section.topics.memoryDesc')}</p>
            {canMergeTopics && <div className="mb-4"><WikiMergeTopics projectId={projectId} topics={visibleTopics.filter((topic) => topic.origin !== 'manual' && !topic.bodyMd?.trim())} locale={locale} /></div>}
            <WikiTopicGrid
              key={initialQuery}
              projectId={projectId}
              topics={visibleTopics}
              locale={locale}
              initialQuery={initialQuery}
              viewerId={viewerId}
            />
          </SectionCard>
        </div>
      )}
    </div>
  )
}
