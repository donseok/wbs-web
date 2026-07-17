'use client'

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ExternalLink,
  RefreshCw,
  Sparkles,
  XCircle,
} from 'lucide-react'
import {
  extractMinuteCommitmentsAction,
  reviewMinuteCommitmentAction,
} from '@/app/actions/minute-commitments'
import { useLocale } from '@/components/providers/LocaleProvider'
import { TEAM_CODES } from '@/lib/domain/minutes'
import type { MinuteCommitment, TeamCode } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { groupMinuteCommitments, isCurrentMinuteCommitment } from '@/lib/minutes/commitments'
import type { MinuteBlock } from '@/lib/minutes/blocks'

type ReviewTab = 'pending' | 'completed'
type Notice = { key: CommitmentKey; count?: number }

type CommitmentKey =
  | 'min.commit.title'
  | 'min.commit.subtitle'
  | 'min.commit.tab.pending'
  | 'min.commit.tab.completed'
  | 'min.commit.extract'
  | 'min.commit.reextract'
  | 'min.commit.extracting'
  | 'min.commit.extractFailed'
  | 'min.commit.extractSuccess'
  | 'min.commit.empty.pending'
  | 'min.commit.empty.completed'
  | 'min.commit.readOnly'
  | 'min.commit.stale.title'
  | 'min.commit.stale.desc'
  | 'min.commit.status.pending'
  | 'min.commit.status.confirmed'
  | 'min.commit.status.rejected'
  | 'min.commit.field.text'
  | 'min.commit.field.owner'
  | 'min.commit.field.team'
  | 'min.commit.field.due'
  | 'min.commit.field.dueText'
  | 'min.commit.missing.owner'
  | 'min.commit.missing.due'
  | 'min.commit.source'
  | 'min.commit.source.open'
  | 'min.commit.source.unavailable'
  | 'min.commit.action.confirm'
  | 'min.commit.action.reject'
  | 'min.commit.action.reopen'
  | 'min.commit.action.saving'
  | 'min.commit.choice.ownerUnassigned'
  | 'min.commit.choice.dueUndecided'
  | 'min.commit.value.ownerUnassigned'
  | 'min.commit.value.dueUndecided'
  | 'min.commit.reviewFailed'
  | 'min.commit.reviewConfirmed'
  | 'min.commit.reviewRejected'
  | 'min.commit.reviewReopened'

export function MinuteCommitmentPanel({
  minuteId,
  commitments,
  blocks,
  bodyHash,
  contextHash,
  sourceRevision,
  canManage,
  onJump,
}: {
  minuteId: string
  commitments: MinuteCommitment[]
  blocks: MinuteBlock[]
  bodyHash: string
  contextHash: string
  sourceRevision: number
  canManage: boolean
  onJump: (blockIndex: number) => void
}) {
  const { t } = useLocale()
  const router = useRouter()
  const tr = (key: CommitmentKey) => t(key as DictKey)
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<ReviewTab>('pending')
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const grouped = useMemo(
    () => groupMinuteCommitments(commitments, blocks, bodyHash, contextHash, sourceRevision),
    [commitments, blocks, bodyHash, contextHash, sourceRevision],
  )
  const pending = grouped.pending
  const completed = useMemo(
    () => [...grouped.confirmed, ...grouped.rejected],
    [grouped.confirmed, grouped.rejected],
  )
  const staleCount = useMemo(
    () => pending.filter(commitment => !isCurrentMinuteCommitment(
      commitment, blocks, bodyHash, contextHash, sourceRevision,
    )).length,
    [pending, blocks, bodyHash, contextHash, sourceRevision],
  )
  const visible = tab === 'pending' ? pending : completed

  useEffect(() => { setExtracting(false) }, [commitments])

  async function extract() {
    if (extracting || !canManage) return
    setExtracting(true)
    setError(null)
    setNotice(null)
    let succeeded = false
    try {
      const result = await extractMinuteCommitmentsAction(minuteId)
      if (!result.ok) {
        setError(result.error ?? tr('min.commit.extractFailed'))
        return
      }
      succeeded = true
      setNotice({ key: 'min.commit.extractSuccess', count: result.count })
      router.refresh()
    } catch {
      setError(tr('min.commit.extractFailed'))
    } finally { if (!succeeded) setExtracting(false) }
  }

  const panelId = `minute-commitments-${minuteId}`
  const pendingTabId = `${panelId}-tab-pending`
  const completedTabId = `${panelId}-tab-completed`

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next: ReviewTab = event.key === 'ArrowLeft' || event.key === 'Home' ? 'pending' : 'completed'
    setTab(next)
    document.getElementById(next === 'pending' ? pendingTabId : completedTabId)?.focus()
  }

  if (!canManage && commitments.length === 0) return null

  return (
    <section className="card flex shrink-0 flex-col overflow-hidden xl:max-h-[22rem]" aria-labelledby={`${panelId}-title`}>
      <header className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ClipboardCheck className="h-4 w-4 shrink-0 text-brand" />
          <span id={`${panelId}-title`} className="text-sm font-bold text-ink">{tr('min.commit.title')}</span>
          <span className="chip bg-brand-weak text-brand">{pending.length}</span>
          {staleCount > 0 && (
            <span className="chip bg-accent-warning/15 text-accent-warning">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {staleCount}
            </span>
          )}
          {open
            ? <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-ink-subtle" />
            : <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-ink-subtle" />}
        </button>

        {canManage && (
          <button
            type="button"
            onClick={() => void extract()}
            disabled={extracting}
            className="btn btn-ghost h-8 shrink-0 px-2.5 text-xs"
          >
            {extracting
              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            {extracting
              ? tr('min.commit.extracting')
              : tr(commitments.length > 0 ? 'min.commit.reextract' : 'min.commit.extract')}
          </button>
        )}
      </header>

      {open && (
        <div id={panelId} className="flex min-h-0 flex-col border-t border-line px-4 pb-4 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-xs leading-5 text-ink-muted">{tr('min.commit.subtitle')}</p>
            {!canManage && <span className="chip bg-surface-2 text-ink-muted">{tr('min.commit.readOnly')}</span>}
          </div>

          {staleCount > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-accent-warning/30 bg-accent-warning/10 p-3 text-sm text-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent-warning" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{tr('min.commit.stale.title')}</p>
                <p className="mt-0.5 text-xs leading-5 text-ink-muted">{tr('min.commit.stale.desc')}</p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => void extract()}
                  disabled={extracting}
                  className="btn btn-ghost h-8 shrink-0 px-2.5 text-xs"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${extracting ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {tr('min.commit.reextract')}
                </button>
              )}
            </div>
          )}

          {(error || notice) && (
            <div className="mt-3" aria-live="polite">
              {error && <p role="alert" className="text-xs font-medium text-delayed">{error}</p>}
              {notice && (
                <p role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-done">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {tr(notice.key)}
                  {notice.count !== undefined && <span className="tabular-nums">{notice.count}</span>}
                </p>
              )}
            </div>
          )}

          <div className="mt-3 inline-flex max-w-full items-center gap-1 rounded-xl border border-line bg-surface p-1" role="tablist">
            <button
              id={pendingTabId}
              type="button"
              role="tab"
              aria-selected={tab === 'pending'}
              aria-controls={`${panelId}-tabpanel`}
              tabIndex={tab === 'pending' ? 0 : -1}
              onClick={() => setTab('pending')}
              onKeyDown={onTabKeyDown}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === 'pending' ? 'seg-item-active' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {tr('min.commit.tab.pending')}
              <span className="tabular-nums">{pending.length}</span>
            </button>
            <button
              id={completedTabId}
              type="button"
              role="tab"
              aria-selected={tab === 'completed'}
              aria-controls={`${panelId}-tabpanel`}
              tabIndex={tab === 'completed' ? 0 : -1}
              onClick={() => setTab('completed')}
              onKeyDown={onTabKeyDown}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === 'completed' ? 'seg-item-active' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {tr('min.commit.tab.completed')}
              <span className="tabular-nums">{completed.length}</span>
            </button>
          </div>

          <div
            id={`${panelId}-tabpanel`}
            role="tabpanel"
            aria-labelledby={tab === 'pending' ? pendingTabId : completedTabId}
            className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1 max-xl:max-h-[34rem]"
          >
            {visible.length === 0 ? (
              <div className="panel-soft px-4 py-6 text-center text-sm text-ink-muted">
                {tr(tab === 'pending' ? 'min.commit.empty.pending' : 'min.commit.empty.completed')}
              </div>
            ) : visible.map(commitment => (
              <CommitmentCard
                key={`${commitment.id}:${commitment.updatedAt}`}
                commitment={commitment}
                current={isCurrentMinuteCommitment(
                  commitment, blocks, bodyHash, contextHash, sourceRevision,
                )}
                canManage={canManage}
                onJump={onJump}
                onReviewed={(status) => {
                  setError(null)
                  setNotice({
                    key: status === 'confirmed'
                      ? 'min.commit.reviewConfirmed'
                      : status === 'rejected'
                        ? 'min.commit.reviewRejected'
                        : 'min.commit.reviewReopened',
                  })
                  router.refresh()
                }}
                onError={message => { setNotice(null); setError(message) }}
                tr={tr}
                t={t}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function CommitmentCard({
  commitment,
  current,
  canManage,
  onJump,
  onReviewed,
  onError,
  tr,
  t,
}: {
  commitment: MinuteCommitment
  current: boolean
  canManage: boolean
  onJump: (blockIndex: number) => void
  onReviewed: (status: 'pending' | 'confirmed' | 'rejected') => void
  onError: (message: string) => void
  tr: (key: CommitmentKey) => string
  t: (key: DictKey) => string
}) {
  const [commitmentText, setCommitmentText] = useState(commitment.commitmentText)
  const [ownerName, setOwnerName] = useState(commitment.ownerName ?? '')
  const [ownerTeam, setOwnerTeam] = useState<TeamCode | ''>(commitment.ownerTeam ?? '')
  const [ownerUnassigned, setOwnerUnassigned] = useState(commitment.ownerUnassigned)
  const [dueDate, setDueDate] = useState(commitment.dueDate ?? '')
  const [dueUndecided, setDueUndecided] = useState(commitment.dueUndecided)
  const [saving, setSaving] = useState<'pending' | 'confirmed' | 'rejected' | null>(null)
  const pending = commitment.reviewStatus === 'pending'
  const editable = pending && canManage && current
  const textId = `commitment-${commitment.id}-text`
  const ownerId = `commitment-${commitment.id}-owner`
  const teamId = `commitment-${commitment.id}-team`
  const dueId = `commitment-${commitment.id}-due`

  const ownerResolved = !!ownerName.trim() || !!ownerTeam || ownerUnassigned
  const dueResolved = !!dueDate || dueUndecided

  async function review(status: 'pending' | 'confirmed' | 'rejected') {
    if (saving || !canManage) return
    if (status === 'confirmed'
      && (!current || !commitmentText.trim() || !ownerResolved || !dueResolved)) return
    setSaving(status)
    let succeeded = false
    try {
      const result = await reviewMinuteCommitmentAction({
        commitmentId: commitment.id,
        status,
        commitmentText: commitmentText.trim(),
        ownerName: ownerName.trim() || null,
        ownerTeam: ownerTeam || null,
        ownerUnassigned,
        dueDate: dueDate || null,
        dueUndecided,
      })
      if (!result.ok) {
        onError(result.error ?? tr('min.commit.reviewFailed'))
        return
      }
      succeeded = true
      onReviewed(status)
    } catch {
      onError(tr('min.commit.reviewFailed'))
    } finally { if (!succeeded) setSaving(null) }
  }

  const statusMeta = commitment.reviewStatus === 'confirmed'
    ? { label: tr('min.commit.status.confirmed'), cls: 'bg-done-weak text-done', Icon: CheckCircle2 }
    : commitment.reviewStatus === 'rejected'
      ? { label: tr('min.commit.status.rejected'), cls: 'bg-delayed-weak text-delayed', Icon: XCircle }
      : { label: tr('min.commit.status.pending'), cls: 'bg-progress-weak text-progress', Icon: ClipboardCheck }
  const StatusIcon = statusMeta.Icon

  return (
    <article className={`rounded-2xl border p-3.5 ${current ? 'border-line bg-surface' : 'border-accent-warning/35 bg-accent-warning/5'}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`chip ${statusMeta.cls}`}>
          <StatusIcon className="h-3 w-3" aria-hidden="true" />
          {statusMeta.label}
        </span>
        {!current && (
          <span className="chip bg-accent-warning/15 text-accent-warning">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {tr('min.commit.stale.title')}
          </span>
        )}
        {pending && !ownerResolved && (
          <span className="chip bg-accent-warning/15 text-accent-warning">
            {tr('min.commit.missing.owner')}
          </span>
        )}
        {pending && !dueResolved && (
          <span className="chip bg-accent-warning/15 text-accent-warning">
            {tr('min.commit.missing.due')}
          </span>
        )}
      </div>

      {pending ? (
        <div className="space-y-3">
          <label htmlFor={textId} className="block">
            <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{tr('min.commit.field.text')}</span>
            <textarea
              id={textId}
              value={commitmentText}
              onChange={event => setCommitmentText(event.target.value)}
              readOnly={!editable}
              maxLength={500}
              rows={2}
              className="app-textarea min-h-20 resize-y"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label htmlFor={ownerId} className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{tr('min.commit.field.owner')}</span>
              <input
                id={ownerId}
                value={ownerName}
                onChange={event => {
                  setOwnerName(event.target.value)
                  if (event.target.value.trim()) setOwnerUnassigned(false)
                }}
                readOnly={!editable}
                maxLength={120}
                className="app-input"
              />
            </label>
            <label htmlFor={teamId} className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{tr('min.commit.field.team')}</span>
              <select
                id={teamId}
                value={ownerTeam}
                onChange={event => {
                  const value = event.target.value as TeamCode | ''
                  setOwnerTeam(value)
                  if (value) setOwnerUnassigned(false)
                }}
                disabled={!editable}
                className="app-input"
              >
                <option value="">{t('common.none')}</option>
                {TEAM_CODES.map(team => <option key={team} value={team}>{team}</option>)}
              </select>
            </label>
            <label htmlFor={dueId} className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{tr('min.commit.field.due')}</span>
              <input
                id={dueId}
                type="date"
                value={dueDate}
                onChange={event => {
                  setDueDate(event.target.value)
                  if (event.target.value) setDueUndecided(false)
                }}
                readOnly={!editable}
                className="app-input px-2 text-xs"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-muted">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={ownerUnassigned}
                disabled={!editable}
                onChange={event => {
                  setOwnerUnassigned(event.target.checked)
                  if (event.target.checked) { setOwnerName(''); setOwnerTeam('') }
                }}
                className="h-4 w-4 rounded border-line text-brand"
              />
              {tr('min.commit.choice.ownerUnassigned')}
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={dueUndecided}
                disabled={!editable}
                onChange={event => {
                  setDueUndecided(event.target.checked)
                  if (event.target.checked) setDueDate('')
                }}
                className="h-4 w-4 rounded border-line text-brand"
              />
              {tr('min.commit.choice.dueUndecided')}
            </label>
          </div>
          {commitment.dueText && (
            <p className="text-xs text-ink-subtle">
              <span className="font-semibold">{tr('min.commit.field.dueText')}</span>{' '}
              <span>{commitment.dueText}</span>
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-ink">{commitment.commitmentText}</p>
          <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
            <ReadOnlyField label={tr('min.commit.field.owner')}
              value={commitment.ownerUnassigned ? tr('min.commit.value.ownerUnassigned') : commitment.ownerName ?? t('common.none')} />
            <ReadOnlyField label={tr('min.commit.field.team')} value={commitment.ownerTeam ?? t('common.none')} />
            <ReadOnlyField label={tr('min.commit.field.due')}
              value={commitment.dueUndecided ? tr('min.commit.value.dueUndecided') : commitment.dueDate ?? t('common.none')} />
          </dl>
        </div>
      )}

      <div className="mt-3 rounded-xl border border-line bg-surface-2/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-ink-subtle">{tr('min.commit.source')}</span>
          <button
            type="button"
            onClick={() => onJump(commitment.blockIndex)}
            disabled={!current}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline disabled:text-ink-subtle disabled:no-underline"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            {current ? tr('min.commit.source.open') : tr('min.commit.source.unavailable')}
          </button>
        </div>
        <blockquote className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-ink-muted">
          {commitment.sourceQuote}
        </blockquote>
      </div>

      {pending && canManage && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void review('rejected')}
            disabled={saving !== null}
            className="btn btn-ghost h-9 px-3 text-xs text-delayed"
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {saving === 'rejected' ? tr('min.commit.action.saving') : tr('min.commit.action.reject')}
          </button>
          <button
            type="button"
            onClick={() => void review('confirmed')}
            disabled={saving !== null || !current || !commitmentText.trim() || !ownerResolved || !dueResolved}
            aria-describedby={!current ? `commitment-${commitment.id}-stale` : undefined}
            className="btn btn-primary h-9 px-3 text-xs"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {saving === 'confirmed' ? tr('min.commit.action.saving') : tr('min.commit.action.confirm')}
          </button>
          {!current && (
            <p id={`commitment-${commitment.id}-stale`} className="w-full text-right text-xs text-accent-warning">
              {tr('min.commit.stale.desc')}
            </p>
          )}
        </div>
      )}
      {!pending && canManage && (
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={() => void review('pending')} disabled={saving !== null}
            className="btn btn-ghost h-9 px-3 text-xs">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {saving === 'pending' ? tr('min.commit.action.saving') : tr('min.commit.action.reopen')}
          </button>
        </div>
      )}
    </article>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-2">
      <dt className="text-[10px] font-semibold text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-ink-muted">{value}</dd>
    </div>
  )
}
