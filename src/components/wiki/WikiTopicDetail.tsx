import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  BookOpenText,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileText,
  GitCompareArrows,
  ShieldAlert,
  UserRound,
} from 'lucide-react'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import type { WikiItem, WikiTopicDetailData } from '@/lib/data/wiki'
import {
  getWikiTopicTrustState,
  isClosedByPersonWikiItem,
  isConflictedWikiItem,
  isOpenWikiItem,
  type WikiTopicTrustState,
} from '@/lib/domain/wikiView'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionCard } from '@/components/ui/SectionCard'
import { formatWikiDate, WikiChangeList, WikiItemCard } from './WikiShared'
import { WikiDocumentEditor } from './WikiDocumentEditor'
import { WikiFeedbackButtons } from './WikiFeedbackButtons'
import { WikiProposalActions } from './WikiProposalActions'
import { WikiTopicContext } from './WikiTopicContext'
import { WikiQuestionAnswerForm } from './WikiQuestionAnswerForm'
import { WikiRevisionRestoreButton } from './WikiRevisionRestoreButton'

type MemoryTopic = NonNullable<WikiTopicDetailData['topic']> & {
  bodyMd?: string | null
  bodyUpdatedAt?: string | null
  bodyUpdatedBy?: string | null
  documentKind?: string | null
  verifiedAt?: string | null
  verifiedBy?: string | null
  reviewDueAt?: string | null
}

type MemoryTopicDetailData = WikiTopicDetailData & {
  proposals?: WikiItem[]
  revisions?: Array<{
    id: string
    versionNo: number
    title: string
    bodyMd: string
    editedByName: string | null
    createdAt: string
  }>
  questions?: Array<{
    id: string
    question: string
    status: string
    createdAt: string
  }>
  feedback?: Array<{
    id: string
    feedbackType: string
    resolution: string | null
    resolvedAt?: string | null
  }>
  dataTruncated?: boolean
  changesTruncated?: boolean
}

function sourceCount(items: WikiItem[]): number {
  return new Set(items.flatMap((item) => item.sources.map((source) => source.id || `${source.minuteId}:${source.blockIndex ?? ''}`))).size
}

function trustStatusMeta(state: WikiTopicTrustState, locale: Locale) {
  if (state === 'conflict') {
    return { label: t(locale, 'wiki.trust.conflict'), wrap: 'bg-delayed-weak text-delayed', icon: AlertTriangle }
  }
  if (state === 'review_due') {
    return { label: t(locale, 'wiki.trust.reviewDue'), wrap: 'bg-pending-weak text-accent-warning', icon: Clock3 }
  }
  if (state === 'verified') {
    return { label: t(locale, 'wiki.trust.verified'), wrap: 'bg-done-weak text-done', icon: BadgeCheck }
  }
  return { label: t(locale, 'wiki.trust.unverified'), wrap: 'bg-surface-2 text-ink-muted', icon: CircleHelp }
}

function kindLabel(kind: string | null | undefined, locale: Locale): string {
  const labels: Record<string, { ko: string; en: string }> = {
    overview: { ko: '프로젝트 개요', en: 'Overview' },
    decision: { ko: '결정 기록', en: 'Decision' },
    how_to: { ko: '사용 방법', en: 'How-to' },
    runbook: { ko: '운영 런북', en: 'Runbook' },
    faq: { ko: '자주 묻는 질문', en: 'FAQ' },
    glossary: { ko: '용어집', en: 'Glossary' },
    reference: { ko: '참조 자료', en: 'Reference' },
  }
  return labels[kind ?? '']?.[locale] ?? t(locale, 'wiki.document.unclassified')
}

function TrustPanel({
  projectId,
  topic,
  items,
  locale,
  canContribute,
  trustState,
}: {
  projectId: string
  topic: MemoryTopic
  items: WikiItem[]
  locale: Locale
  canContribute: boolean
  trustState: WikiTopicTrustState
}) {
  const status = trustStatusMeta(trustState, locale)
  const reviewDue = trustState === 'review_due'
  const StatusIcon = status.icon

  return (
    <SectionCard eyebrow={t(locale, 'wiki.trust.eyebrow')} title={t(locale, 'wiki.trust.title')} icon={BadgeCheck}>
      <div className={`flex items-center gap-2 rounded-xl px-3 py-3 ${status.wrap}`}>
        <StatusIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="text-sm font-semibold">{status.label}</span>
      </div>
      <dl className="mt-4 space-y-3 text-xs">
        <div className="flex items-start gap-2">
          <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
          <dt className="text-ink-subtle">{t(locale, 'wiki.trust.owner')}</dt>
          <dd className="ml-auto text-right font-medium text-ink">{topic.ownerTeam ?? t(locale, 'wiki.noOwner')}</dd>
        </div>
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
          <dt className="text-ink-subtle">{t(locale, 'wiki.trust.type')}</dt>
          <dd className="ml-auto text-right font-medium text-ink">{kindLabel(topic.documentKind, locale)}</dd>
        </div>
        <div className="flex items-start gap-2">
          <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
          <dt className="text-ink-subtle">{t(locale, 'wiki.trust.lastVerified')}</dt>
          <dd className="ml-auto text-right font-medium text-ink">{topic.verifiedAt ? formatWikiDate(topic.verifiedAt, locale) : t(locale, 'wiki.trust.never')}</dd>
        </div>
        <div className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
          <dt className="text-ink-subtle">{t(locale, 'wiki.trust.nextReview')}</dt>
          <dd className={`ml-auto text-right font-medium ${reviewDue ? 'text-accent-warning' : 'text-ink'}`}>{topic.reviewDueAt ? formatWikiDate(topic.reviewDueAt, locale) : t(locale, 'wiki.trust.notScheduled')}</dd>
        </div>
        <div className="flex items-start gap-2">
          <BookOpenText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
          <dt className="text-ink-subtle">{t(locale, 'wiki.trust.sources')}</dt>
          <dd className="ml-auto text-right font-medium text-ink">{sourceCount(items)}</dd>
        </div>
      </dl>
      {canContribute && <div className="mt-4 border-t border-line pt-4"><WikiFeedbackButtons projectId={projectId} topicId={topic.id} locale={locale} /></div>}
    </SectionCard>
  )
}

function OpenLoops({ items, questions, locale, projectId, topicId, canCurate, canAnswer }: { items: WikiItem[]; questions: NonNullable<MemoryTopicDetailData['questions']>; locale: Locale; projectId: string; topicId: string; canCurate: boolean; canAnswer: boolean }) {
  if (items.length === 0 && questions.length === 0) return <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-ink-muted">{t(locale, 'wiki.topic.noOpen')}</p>
  return (
    <div className="space-y-3">
      {questions.map((question) => (
        <article key={question.id} className="rounded-xl border border-line bg-surface px-4 py-3 shadow-[var(--shadow-sm)]">
          <div className="flex items-center gap-2"><CircleHelp className="h-4 w-4 text-pending" aria-hidden /><span className="chip bg-pending-weak text-pending">{t(locale, 'wiki.kind.question')}</span></div>
          <p className="mt-2 text-sm font-medium leading-6 text-ink">{question.question}</p>
          <p className="mt-1 text-[11px] text-ink-subtle">{formatWikiDate(question.createdAt, locale)}</p>
          {canAnswer && <WikiQuestionAnswerForm projectId={projectId} topicId={topicId} questionId={question.id} locale={locale} />}
        </article>
      ))}
      {items.map((item) => <WikiItemCard key={item.id} item={item} locale={locale} showEvidence curateProjectId={canCurate ? projectId : undefined} />)}
    </div>
  )
}

function EvidenceAccordion({ items, locale, projectId, canCurate }: { items: WikiItem[]; locale: Locale; projectId: string; canCurate: boolean }) {
  return (
    <details className="card group overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 marker:hidden sm:px-6">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-weak text-brand"><BookOpenText className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">{t(locale, 'wiki.evidence.eyebrow')}</div>
          <h3 className="mt-0.5 text-sm font-semibold text-ink">{t(locale, 'wiki.evidence.title')}</h3>
        </div>
        <span className="chip bg-surface-2 text-ink-muted">{items.length}</span>
        <ChevronDown className="h-4 w-4 text-ink-subtle transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line px-5 py-5 sm:px-6">
        <p className="mb-3 text-xs leading-5 text-ink-muted">{t(locale, 'wiki.evidence.desc')}</p>
        {items.length > 0
          ? <div className="space-y-3">{items.map((item) => <WikiItemCard key={item.id} item={item} locale={locale} showEvidence curateProjectId={canCurate ? projectId : undefined} />)}</div>
          : <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">{t(locale, 'wiki.noItems')}</p>}
      </div>
    </details>
  )
}

export function WikiTopicDetail({
  projectId,
  data: rawData,
  locale,
  canCurate = false,
  canEditDocuments = canCurate,
  canVerifyDocuments = canEditDocuments,
}: {
  projectId: string
  data: WikiTopicDetailData
  locale: Locale
  canCurate?: boolean
  canEditDocuments?: boolean
  canVerifyDocuments?: boolean
}) {
  const data = rawData as MemoryTopicDetailData
  if (!data.topic) {
    return (
      <div className="space-y-4">
        <Link href={`/p/${projectId}/wiki`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-hover"><ArrowLeft className="h-4 w-4" />{t(locale, 'wiki.backHome')}</Link>
        <EmptyState icon={BookOpenText} title={data.available ? t(locale, 'wiki.topic.notFound') : t(locale, 'wiki.empty.title')} description={data.available ? t(locale, 'wiki.topic.notFoundDesc') : t(locale, 'wiki.empty.desc')} action={<Link href={`/p/${projectId}/wiki`} className="btn btn-ghost"><ArrowLeft className="h-4 w-4" />{t(locale, 'wiki.backHome')}</Link>} />
      </div>
    )
  }

  const topic = data.topic as MemoryTopic
  const items = data.items.filter((item) => !isClosedByPersonWikiItem(item))
  const openItems = items.filter(isOpenWikiItem)
  const evidenceItems = items.filter((item) => !isOpenWikiItem(item))
  const proposals = (data.proposals ?? []).filter((item) => item.reviewState === 'pending')
  const questions = (data.questions ?? []).filter((question) => !['answered', 'resolved', 'closed'].includes(question.status))
  const outdatedFlagged = (data.feedback ?? []).some((feedback) => (
    feedback.feedbackType === 'outdated'
    && !feedback.resolvedAt
    && !['resolved', 'dismissed', 'closed'].includes(feedback.resolution ?? '')
  ))
  const conflict = topic.conflictCount > 0 || items.some(isConflictedWikiItem)
  const conflictCount = Math.max(topic.conflictCount, conflict ? 1 : 0)
  const trustState = getWikiTopicTrustState({
    verifiedAt: topic.verifiedAt,
    reviewDueAt: topic.reviewDueAt,
    hasConflict: conflict,
    hasUnresolvedOutdatedFeedback: outdatedFlagged,
  })
  const trustStatus = trustStatusMeta(trustState, locale)
  const TrustStatusIcon = trustStatus.icon
  const extensionReady = data.readState === 'ready'
  const canWriteMemory = extensionReady && canEditDocuments
  // 0079 신규 기능(AI 제안 검토)만 스키마 준비를 기다린다.
  const canReviewMemory = extensionReady && canCurate
  // 항목 큐레이션(보관·해결·잠금·확정)은 0048/0053 RPC 라 이미 운영에 있다. WikiOverview
  // 의 같은 주석 참조 — 0079 미적용 기간에 기존 기능까지 막지 않는다.
  const canCurateLegacy = canCurate
  const canVerifyMemory = extensionReady && canVerifyDocuments

  return (
    <div className="space-y-5">
      <WikiTopicContext topicId={topic.id} />
      <Link href={`/p/${projectId}/wiki`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-hover"><ArrowLeft className="h-4 w-4" />{t(locale, 'wiki.backHome')}</Link>

      {!extensionReady && (
        <div className="flex items-start gap-3 rounded-2xl border border-delayed/25 bg-delayed-weak/45 px-4 py-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-delayed" aria-hidden />
          <div>
            <div className="font-semibold text-ink">{data.readState === 'error' ? t(locale, 'wiki.read.errorTitle') : t(locale, 'wiki.read.schemaTitle')}</div>
            <p className="mt-0.5 leading-5 text-ink-muted">{data.readState === 'error' ? t(locale, 'wiki.read.errorDesc') : t(locale, 'wiki.read.schemaDesc')}</p>
          </div>
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {topic.documentKind && <span className="chip bg-brand-weak text-brand">{kindLabel(topic.documentKind, locale)}</span>}
              <span className={`chip ${trustStatus.wrap}`}><TrustStatusIcon className="h-3 w-3" />{trustStatus.label}</span>
            </div>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-ink sm:text-2xl">{topic.title}</h2>
            <p className="mt-1.5 text-sm text-ink-muted">{topic.ownerTeam ?? t(locale, 'wiki.noOwner')}<span className="mx-2 text-line-strong">·</span>{t(locale, 'wiki.updatedAt')} {formatWikiDate(topic.bodyUpdatedAt ?? topic.lastChangedAt, locale)}</p>
          </div>
          <div className="grid shrink-0 grid-cols-3 gap-2">
            <div className="rounded-xl bg-surface-2 px-3 py-2 text-center"><div className="text-lg font-bold tabular-nums text-ink">{sourceCount(items)}</div><div className="text-[10px] text-ink-subtle">{t(locale, 'wiki.trust.sources')}</div></div>
            <div className="rounded-xl bg-pending-weak px-3 py-2 text-center"><div className="text-lg font-bold tabular-nums text-pending">{openItems.length}</div><div className="text-[10px] text-pending">{t(locale, 'wiki.state.open')}</div></div>
            <div className={`rounded-xl px-3 py-2 text-center ${conflictCount > 0 ? 'bg-delayed-weak' : 'bg-done-weak'}`}><div className={`text-lg font-bold tabular-nums ${conflictCount > 0 ? 'text-delayed' : 'text-done'}`}>{conflictCount}</div><div className={`text-[10px] ${conflictCount > 0 ? 'text-delayed' : 'text-done'}`}>{t(locale, 'wiki.state.conflict')}</div></div>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <SectionCard eyebrow={t(locale, 'wiki.document.eyebrow')} title={t(locale, 'wiki.document.canonicalTitle')} icon={FileText}>
            <WikiDocumentEditor
              key={topic.bodyUpdatedAt ?? 'empty-document'}
              projectId={projectId}
              locale={locale}
              topic={{
                id: topic.id,
                title: topic.title,
                bodyMd: topic.bodyMd,
                bodyUpdatedAt: topic.bodyUpdatedAt,
                documentKind: topic.documentKind,
              }}
              canEdit={canWriteMemory}
              canVerify={canVerifyMemory}
            />
          </SectionCard>

          {proposals.length > 0 && (
            <SectionCard eyebrow={t(locale, 'wiki.proposal.eyebrow')} title={t(locale, 'wiki.proposal.title')} icon={AlertTriangle} actions={<span className="chip bg-pending-weak text-pending">{proposals.length}</span>}>
              <p className="-mt-2 mb-3 text-xs leading-5 text-ink-muted">{t(locale, 'wiki.proposal.desc')}</p>
              <div className="space-y-3">
                {proposals.map((item) => (
                  <div key={item.id}>
                    <WikiItemCard item={item} locale={locale} showEvidence />
                    {canReviewMemory && <WikiProposalActions projectId={projectId} topicId={item.topicId} itemId={item.id} locale={locale} />}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          <EvidenceAccordion items={evidenceItems} locale={locale} projectId={projectId} canCurate={canCurateLegacy} />
        </div>

        <div className="space-y-5 xl:sticky xl:top-0">
          <TrustPanel projectId={projectId} topic={topic} items={items} locale={locale} canContribute={canWriteMemory} trustState={trustState} />
          <SectionCard eyebrow={t(locale, 'wiki.section.open.eyebrow')} title={t(locale, 'wiki.section.open.memoryTitle')} icon={ShieldAlert} actions={<span className="chip bg-pending-weak text-pending">{openItems.length + questions.length}</span>}>
            <p className="-mt-2 mb-3 text-xs text-ink-muted">{t(locale, 'wiki.section.open.memoryDesc')}</p>
            <OpenLoops items={openItems} questions={questions} locale={locale} projectId={projectId} topicId={topic.id} canCurate={canCurateLegacy} canAnswer={canWriteMemory} />
          </SectionCard>
        </div>
      </div>

      <details className="card group overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 marker:hidden sm:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-weak text-brand"><GitCompareArrows className="h-4 w-4" aria-hidden /></span>
          <div className="min-w-0 flex-1"><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">{t(locale, 'wiki.section.timeline.eyebrow')}</div><h3 className="mt-0.5 text-sm font-semibold text-ink">{t(locale, 'wiki.section.timeline.memoryTitle')}</h3></div>
          <span className="chip bg-surface-2 text-ink-muted">{data.changes.length}</span><ChevronDown className="h-4 w-4 text-ink-subtle transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="border-t border-line px-5 py-5 sm:px-6">
          {(data.revisions ?? []).length > 0 && (
            <div className="mb-5">
              <h4 className="text-xs font-semibold text-ink">{t(locale, 'wiki.history.documentRevisions')}</h4>
              <ol className="mt-2 space-y-2">
                {(data.revisions ?? []).map((revision) => (
                  <li key={revision.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-surface-2/55 px-3 py-2 text-xs">
                    <span className="font-semibold text-ink">v{revision.versionNo} · {revision.title}</span>
                    {revision.editedByName && <span className="text-ink-muted">{revision.editedByName}</span>}
                    <time className={canWriteMemory ? 'text-ink-subtle' : 'ml-auto text-ink-subtle'}>{formatWikiDate(revision.createdAt, locale, true)}</time>
                    {canWriteMemory
                      && (revision.title !== topic.title || revision.bodyMd !== (topic.bodyMd ?? ''))
                      && (
                      <WikiRevisionRestoreButton
                        projectId={projectId}
                        topicId={topic.id}
                        revisionId={revision.id}
                        versionNo={revision.versionNo}
                        expectedUpdatedAt={topic.bodyUpdatedAt ?? null}
                        locale={locale}
                      />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <WikiChangeList changes={data.changes} locale={locale} />
          {(data.changesTruncated || data.dataTruncated) && <p className="mt-3 rounded-lg bg-pending-weak px-3 py-2 text-xs text-pending">{t(locale, 'wiki.changes.truncated')}</p>}
        </div>
      </details>
    </div>
  )
}
