// src/components/app/InboxPanel.tsx — 벨 패널 본문. 데이터는 HeaderChrome 이 내려준다(패널은 표현만).
'use client'

import Link from 'next/link'
import { AlertTriangle, BellRing, Clock4, Megaphone } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { NotificationItem } from '@/app/actions/notifications'
import type { InboxItem } from '@/app/actions/inbox'

export function InboxPanel({
  items, derived, unreadAnnouncements, projectId, loading, failed, onItemClick, onMarkAllRead,
}: {
  items: InboxItem[]
  derived: NotificationItem[]           // 기존 파생 피드(지연·마감) — 이벤트가 아니라 구획 유지
  unreadAnnouncements: number
  projectId: string | null
  loading: boolean
  failed: boolean
  onItemClick: (item: InboxItem) => void
  onMarkAllRead: () => void
}) {
  const { t } = useLocale()
  const unread = items.filter(i => !i.read).length + derived.length
  const empty = items.length === 0 && derived.length === 0 && unreadAnnouncements === 0

  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-sm font-semibold text-ink">{t('inbox.title')}</span>
        {unread > 0 && (
          <span className="flex items-center gap-2">
            <span className="chip bg-delayed-weak text-delayed">{unread}</span>
            <button onClick={onMarkAllRead} className="text-[11px] font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline">
              {t('inbox.markAllRead')}
            </button>
          </span>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto">
        {failed ? (
          <div className="px-4 py-6 text-center text-xs text-delayed">{t('inbox.loadFailed')}</div>
        ) : loading ? (
          <div className="px-4 py-6 text-center text-xs text-ink-subtle">…</div>
        ) : empty ? (
          <div className="px-4 py-6 text-center text-xs text-ink-subtle">{t('inbox.empty')}</div>
        ) : (
          <>
            {items.length > 0 && (
              <Section label={t('inbox.personal')}>
                {items.map(n => (
                  <li key={n.recipientId}>
                    <button onClick={() => onItemClick(n)} className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-surface-2 ${n.read ? 'opacity-55' : ''}`}>
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted">
                        <BellRing className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink">{n.title}</span>
                        {n.detail && <span className="block text-[11px] text-ink-muted">{n.detail}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </Section>
            )}
            {projectId && unreadAnnouncements > 0 && (
              <Section label={t('inbox.announcements')}>
                <li>
                  <Link href={`/p/${projectId}/announcements`} className="flex gap-3 px-4 py-3 transition hover:bg-surface-2">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-pending-weak text-accent-warning">
                      <Megaphone className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">{unreadAnnouncements} {t('inbox.announceUnread')}</span>
                      <span className="block text-[11px] text-ink-muted">{t('inbox.viewAnnouncements')}</span>
                    </span>
                  </Link>
                </li>
              </Section>
            )}
            {projectId && derived.length > 0 && (
              <Section label={t('inbox.derived')}>
                {derived.map(n => (
                  <li key={n.id}>
                    <Link href={`/p/${projectId}/kanban`} className="flex gap-3 px-4 py-3 transition hover:bg-surface-2">
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${n.severity === 'danger' ? 'bg-delayed-weak text-delayed' : 'bg-pending-weak text-accent-warning'}`}>
                        {n.type === 'delayed' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock4 className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink">{n.title}</span>
                        <span className="block text-[11px] text-ink-muted">{n.detail}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="border-b border-line bg-surface-2/60 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">{label}</div>
      <ul className="divide-y divide-line">{children}</ul>
    </div>
  )
}
