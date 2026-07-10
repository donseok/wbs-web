'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarRange, Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { useLocale } from '@/components/providers/LocaleProvider'
import {
  ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_META, ANNOUNCEMENT_STATUS_META,
  announcementStatus, isPublishedNow, isUnread, sortAnnouncements,
} from '@/lib/domain/announcements'
import {
  createAnnouncement, updateAnnouncement, deleteAnnouncement, markAnnouncementsSeen,
} from '@/app/actions/announcements'
import type { Announcement, AnnouncementCategory } from '@/lib/domain/types'

type CategoryFilter = 'all' | AnnouncementCategory

/** 'YYYY-MM-DD' (Asia/Seoul) — 앱 날짜 표기 관례 */
function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso))
}

/** 오늘 'YYYY-MM-DD' (Asia/Seoul) — publish_from/to(date) 비교·폼 기본값 기준 */
function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export function AnnouncementsView({
  announcements,
  lastSeenAt,
  canEdit,
  projectId,
}: {
  announcements: Announcement[]
  lastSeenAt: string | null
  canEdit: boolean
  projectId: string
}) {
  const { t } = useLocale()
  const today = seoulToday()
  const [filter, setFilter] = useState<CategoryFilter>('all')
  const [reading, setReading] = useState<Announcement | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [deleting, setDeleting] = useState<Announcement | null>(null)

  // 게시 기간 스코프: 관리자는 예정·게시중·만료 전부(상태 배지로 구분), 일반 사용자는
  // 오늘 게시중인 것만 본다. 이후 카테고리 필터·읽음 처리 모두 이 스코프 위에서 동작.
  const scoped = useMemo(
    () => (canEdit ? announcements : announcements.filter((a) => isPublishedNow(a, today))),
    [announcements, canEdit, today],
  )

  // 방문 = 확인 처리: 렌더에 실제로 보인 가장 최신 공지 시각까지 읽음 처리(스냅샷 기준 —
  // 렌더~호출 사이에 도착한 공지는 안읽음 유지). refresh 하지 않음 — NEW 칩은 이번 방문
  // 동안 유지되고, 사이드바 배지는 다음 네비게이션의 재조회에서 사라진다.
  useEffect(() => {
    if (scoped.length === 0) return
    const latest = scoped.reduce((max, a) =>
      Date.parse(a.createdAt) > Date.parse(max.createdAt) ? a : max,
    ).createdAt
    markAnnouncementsSeen(projectId, latest).catch(() => {})
  }, [projectId, scoped])

  const visible = useMemo(() => {
    const base = filter === 'all' ? scoped : scoped.filter((a) => a.category === filter)
    return sortAnnouncements(base)
  }, [scoped, filter])

  function openWrite() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(a: Announcement) {
    setReading(null)
    setEditing(a)
    setFormOpen(true)
  }

  const tabs: { key: CategoryFilter; label: string }[] = [
    { key: 'all', label: t('ann.filter.all') },
    ...ANNOUNCEMENT_CATEGORIES.map((c) => ({ key: c, label: t(ANNOUNCEMENT_META[c].labelKey) })),
  ]

  // 카드가 스크롤 영역을 꽉 채우고(h-full), 헤더는 고정된 채 목록만 내부에서 스크롤된다.
  // MembersBoard와 동일한 "단일 내부 스크롤 컨테이너" 패턴.
  return (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <div className="eyebrow">{t('ann.boardEyebrow')}</div>
          <h2 className="mt-0.5 text-sm font-semibold text-ink">
            {t('ann.boardTitle')} · {scoped.length}{t('ann.unitCount')}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs tabs={tabs} value={filter} onChange={setFilter} size="sm" />
          {canEdit && (
            <button onClick={openWrite} className="btn btn-primary">
              <Plus className="h-4 w-4" />
              {t('ann.write')}
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-5 sm:p-6">
        {visible.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={filter === 'all' ? t('ann.empty.title') : t('ann.empty.filtered')}
            description={filter === 'all' ? t('ann.empty.desc') : undefined}
            action={
              canEdit && filter === 'all' ? (
                <button onClick={openWrite} className="btn btn-primary">
                  <Plus className="h-4 w-4" />
                  {t('ann.write')}
                </button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-3">
            {visible.map((a) => (
              <li key={a.id}>
                <AnnouncementRow
                  item={a}
                  unread={isUnread(a, lastSeenAt)}
                  canEdit={canEdit}
                  today={today}
                  onRead={() => setReading(a)}
                  onEdit={() => openEdit(a)}
                  onDelete={() => setDeleting(a)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ReadModal
        item={reading}
        canEdit={canEdit}
        onClose={() => setReading(null)}
        onEdit={() => reading && openEdit(reading)}
        onDelete={() => {
          if (!reading) return
          setDeleting(reading)
          setReading(null)
        }}
      />
      <AnnouncementFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        projectId={projectId}
        initial={editing}
      />
      <DeleteAnnouncementModal item={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}

function AnnouncementRow({
  item,
  unread,
  canEdit,
  today,
  onRead,
  onEdit,
  onDelete,
}: {
  item: Announcement
  unread: boolean
  canEdit: boolean
  today: string
  onRead: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useLocale()
  const meta = ANNOUNCEMENT_META[item.category]
  const edited = item.updatedAt !== item.createdAt
  // 게시중이 아닌(예정·만료) 공지는 관리자만 보므로, 그 상태를 배지로 알린다.
  const status = announcementStatus(item, today)
  const statusMeta = status !== 'active' ? ANNOUNCEMENT_STATUS_META[status] : null
  const period = item.publishFrom && item.publishTo ? `${item.publishFrom} ~ ${item.publishTo}` : null

  return (
    <div
      className={`group flex items-start gap-3 rounded-2xl border bg-surface p-4 transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--shadow-md)] ${item.isPinned ? 'border-brand/40 bg-brand-weak/30' : 'border-line'} ${status === 'expired' ? 'opacity-60' : ''}`}
    >
      <button onClick={onRead} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`chip ${meta.chip}`}>{t(meta.labelKey)}</span>
            {item.isPinned && (
              <span className="chip bg-pending-weak text-accent-warning">
                <Pin className="h-3 w-3" />
                {t('ann.pinned')}
              </span>
            )}
            {unread && <span className="chip bg-accent-secondary/15 text-accent-secondary">{t('ann.new')}</span>}
            {statusMeta && <span className={`chip ${statusMeta.chip}`}>{t(statusMeta.labelKey)}</span>}
          </span>
          <span className="mt-1.5 block truncate text-[15px] font-semibold text-ink" title={item.title}>
            {item.title}
          </span>
          {item.body && (
            <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-ink-muted">{item.body}</span>
          )}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] tabular-nums text-ink-subtle">
            <span>
              {fmtDate(item.createdAt)}
              {edited && t('ann.updatedSuffix')}
            </span>
            {period && (
              <span className="inline-flex items-center gap-1">
                <CalendarRange className="h-3 w-3" />
                {period}
              </span>
            )}
          </span>
        </span>
      </button>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onEdit}
            aria-label={`${item.title} ${t('common.edit')}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-subtle transition hover:border-line-strong hover:text-ink"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            aria-label={`${item.title} ${t('common.delete')}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-subtle transition hover:border-delayed hover:text-delayed"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function ReadModal({
  item,
  canEdit,
  onClose,
  onEdit,
  onDelete,
}: {
  item: Announcement | null
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useLocale()
  const meta = item ? ANNOUNCEMENT_META[item.category] : null

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      eyebrow="Announcement"
      title={item?.title ?? ''}
      size="lg"
      footer={
        <>
          {canEdit && (
            <button
              onClick={onDelete}
              className="btn bg-delayed text-white shadow-sm transition hover:brightness-105"
            >
              <Trash2 className="h-4 w-4" />
              {t('common.delete')}
            </button>
          )}
          {canEdit && (
            <button onClick={onEdit} className="btn btn-ghost">
              <Pencil className="h-4 w-4" />
              {t('common.edit')}
            </button>
          )}
          <button onClick={onClose} className="btn btn-primary">
            {t('common.close')}
          </button>
        </>
      }
    >
      {item && meta && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`chip ${meta.chip}`}>{t(meta.labelKey)}</span>
            {item.isPinned && (
              <span className="chip bg-pending-weak text-accent-warning">
                <Pin className="h-3 w-3" />
                {t('ann.pinned')}
              </span>
            )}
            <span className="text-[11px] tabular-nums text-ink-subtle">
              {fmtDate(item.createdAt)}
              {item.updatedAt !== item.createdAt && t('ann.updatedSuffix')}
            </span>
          </div>
          {item.publishFrom && item.publishTo && (
            <div className="flex items-center gap-1.5 text-[12px] tabular-nums text-ink-muted">
              <CalendarRange className="h-3.5 w-3.5 text-ink-subtle" />
              <span className="font-medium text-ink-subtle">{t('ann.periodLabel')}</span>
              {item.publishFrom} ~ {item.publishTo}
            </div>
          )}
          <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{item.body || '—'}</p>
        </div>
      )}
    </Modal>
  )
}

function AnnouncementFormModal({
  open,
  onClose,
  projectId,
  initial,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  initial: Announcement | null
}) {
  const router = useRouter()
  const { t } = useLocale()
  const isEdit = !!initial
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<AnnouncementCategory>('general')
  const [isPinned, setIsPinned] = useState(false)
  const [publishFrom, setPublishFrom] = useState('')
  const [publishTo, setPublishTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setBody(initial?.body ?? '')
    setCategory(initial?.category ?? 'general')
    setIsPinned(initial?.isPinned ?? false)
    // 신규·legacy(기간 없음) 공지는 시작일을 오늘로 기본, 종료일은 직접 지정하도록 비운다.
    setPublishFrom(initial?.publishFrom ?? seoulToday())
    setPublishTo(initial?.publishTo ?? '')
    setError(null)
  }, [open, initial])

  function submit() {
    if (!title.trim()) {
      setError(t('ann.err.titleRequired'))
      return
    }
    if (!publishFrom || !publishTo) {
      setError(t('ann.err.periodRequired'))
      return
    }
    if (publishFrom > publishTo) {
      setError(t('ann.err.periodOrder'))
      return
    }
    const input = { title: title.trim(), body, category, isPinned, publishFrom, publishTo }
    startTransition(async () => {
      const res = isEdit
        ? await updateAnnouncement(initial!.id, input)
        : await createAnnouncement(projectId, input)
      if (res.ok) {
        onClose()
        router.refresh()
      } else {
        setError(res.error ?? t('ann.err.saveFailed'))
      }
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={isEdit ? 'Edit announcement' : 'New announcement'}
      title={isEdit ? t('ann.edit') : t('ann.write')}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>
            {t('common.cancel')}
          </button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>
            {pending ? t('ann.saving') : isEdit ? t('common.save') : t('ann.write')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('ann.form.title')}</span>
          <input
            className="app-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('ann.form.titlePh')}
            maxLength={200}
            autoFocus
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('ann.form.category')}</span>
            <select
              className="app-input"
              value={category}
              onChange={(e) => setCategory(e.target.value as AnnouncementCategory)}
            >
              {ANNOUNCEMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(ANNOUNCEMENT_META[c].labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-end gap-2 pb-2.5">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            <span className="inline-flex items-center gap-1 text-sm font-medium text-ink">
              <Pin className="h-3.5 w-3.5 text-ink-subtle" />
              {t('ann.form.pin')}
            </span>
          </label>
        </div>

        <div>
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
            <CalendarRange className="h-3.5 w-3.5" />
            {t('ann.form.period')}
          </span>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-ink-subtle">{t('ann.form.publishFrom')}</span>
              <input
                type="date"
                className="app-input"
                value={publishFrom}
                max={publishTo || undefined}
                onChange={(e) => setPublishFrom(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-ink-subtle">{t('ann.form.publishTo')}</span>
              <input
                type="date"
                className="app-input"
                value={publishTo}
                min={publishFrom || undefined}
                onChange={(e) => setPublishTo(e.target.value)}
              />
            </label>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-ink-subtle">{t('ann.form.periodHint')}</p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('ann.form.body')}</span>
          <textarea
            className="app-textarea"
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('ann.form.bodyPh')}
          />
        </label>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-delayed/40 bg-delayed-weak px-3 py-2.5 text-xs font-medium text-delayed">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

function DeleteAnnouncementModal({ item, onClose }: { item: Announcement | null; onClose: () => void }) {
  const router = useRouter()
  const { t } = useLocale()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (item) setError(null)
  }, [item])

  function confirm() {
    if (!item) return
    startTransition(async () => {
      const res = await deleteAnnouncement(item.id)
      if (res.ok) {
        onClose()
        router.refresh()
      } else {
        setError(res.error ?? t('ann.err.deleteFailed'))
      }
    })
  }

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      eyebrow="Delete announcement"
      title={t('ann.deleteTitle')}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>
            {t('common.cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={pending}
            className="btn bg-delayed text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? t('ann.deleting') : t('common.delete')}
          </button>
        </>
      }
    >
      <p className="text-sm leading-6 text-ink-muted">
        <strong className="text-ink">{item?.title}</strong>
        {t('ann.deleteConfirmSuffix')}
      </p>
      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-delayed/40 bg-delayed-weak px-3 py-2.5 text-xs font-medium text-delayed">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
    </Modal>
  )
}
