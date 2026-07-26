'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { CircleAlert, ExternalLink, Highlighter, Users } from 'lucide-react'
import type { InsightKind } from '@/lib/domain/types'
import type { MinuteLinkedIssue } from '@/lib/domain/issueMinuteSource'
import { ISSUE_STATUS_META } from '@/lib/domain/issues'
import { useLocale } from '@/components/providers/LocaleProvider'

const KIND_CHIP: Record<InsightKind, string> = {
  decision: 'bg-done-weak text-done',
  action: 'bg-progress-weak text-progress',
  deadline: 'bg-accent-warning/15 text-accent-warning',
  risk: 'bg-delayed-weak text-delayed',
}

export interface PopoverState {
  blockIndex: number
  rect: { top: number; bottom: number; left: number; width: number }  // getBoundingClientRect 스냅샷
}

/** 블록 팝오버 — fixed 배치(블록 하단 우선·상단 플립·좌우 클램프), 스크롤/리사이즈/외부 클릭 시 닫힘. 스펙 §6.4. */
export function MinuteBlockPopover({
  state, mine, names, insKinds, busy, linkedIssues, issueBusy = false,
  canCreateIssue = true, onToggle, onCreateIssue, onClose,
}: {
  state: PopoverState
  mine: boolean
  names: string[]
  insKinds: InsightKind[]
  busy: boolean
  linkedIssues: MinuteLinkedIssue[]
  issueBusy?: boolean
  canCreateIssue?: boolean
  onToggle: () => void
  onCreateIssue: () => void
  onClose: () => void
}) {
  const { t } = useLocale()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // capture — 본문 카드 내부 스크롤도 감지. 단, 팝오버 내부 스크롤(긴 명단)은 닫지 않는다.
    const close = (e: Event) => {
      if (e.target instanceof Node && boxRef.current?.contains(e.target)) return
      onClose()
    }
    const closeAll = () => onClose()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', closeAll)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', closeAll)
    }
  }, [onClose])

  const W = 300
  // 연결 이슈가 붙으면 내용이 늘어난다. 화면 밖 플립 기준은 최대 높이로 잡고 카드 자체는 스크롤한다.
  const H = Math.min(linkedIssues.length > 0 ? 440 : 320, window.innerHeight - 16)
  const left = Math.min(Math.max(8, state.rect.left), window.innerWidth - W - 8)
  const below = state.rect.bottom + H < window.innerHeight
  const pos = below
    ? { top: state.rect.bottom + 6, left }
    : { top: Math.max(8, state.rect.top - 6 - H), left }

  return (
    <>
      <button className="fixed inset-0 z-[90] cursor-default" aria-label="닫기" onClick={onClose} />
      <div ref={boxRef} style={{ position: 'fixed', width: W, ...pos }}
        className="z-[95] max-h-[calc(100vh-16px)] overflow-y-auto rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-lg)]">
        {insKinds.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {insKinds.map(k => (
              <span key={k} className={`chip ${KIND_CHIP[k]}`}>{t(`min.insight.kind.${k}`)}</span>
            ))}
          </div>
        )}
        <button onClick={onToggle} disabled={busy}
          className={`btn h-9 w-full ${mine ? 'bg-accent-warning/15 text-accent-warning' : 'btn-ghost'}`}>
          <Highlighter className="h-4 w-4" />
          {mine ? t('min.hl.remove') : t('min.hl.add')}
        </button>
        <div className="mt-2 border-t border-line pt-2">
          {linkedIssues.length > 0 && (
            <div className="mb-2">
              <p className="mb-1.5 text-[11px] font-semibold text-ink-subtle">{t('min.issue.linked')}</p>
              <div className="space-y-1.5">
                {linkedIssues.slice(0, 2).map(issue => {
                  const meta = ISSUE_STATUS_META[issue.status]
                  return (
                    <Link
                      key={issue.linkId}
                      href={`/p/${issue.projectId}/issues?focus=${encodeURIComponent(issue.issueId)}`}
                      onClick={onClose}
                      className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-2.5 py-2 text-xs text-ink transition hover:border-brand/40 hover:text-brand"
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {t('min.issue.open').replace('{n}', String(issue.issueNo))}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
                          {issue.title}
                        </span>
                      </span>
                      <span className={`chip shrink-0 ${meta.chip}`}>{t(meta.labelKey)}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </Link>
                  )
                })}
                {linkedIssues.length > 2 && (
                  <p className="px-1 text-[11px] text-ink-subtle">
                    {t('min.issue.more').replace('{n}', String(linkedIssues.length - 2))}
                  </p>
                )}
              </div>
            </div>
          )}
          <button
            onClick={onCreateIssue}
            disabled={issueBusy || !canCreateIssue}
            className="btn btn-primary h-9 w-full"
          >
            <CircleAlert className="h-4 w-4" />
            {linkedIssues.length > 0 ? t('min.issue.createAnother') : t('min.issue.create')}
          </button>
        </div>
        {names.length > 0 && (
          <div className="mt-2 border-t border-line pt-2">
            <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold text-ink-subtle">
              <Users className="h-3 w-3" />{t('min.hl.people')}
            </p>
            <p className="max-h-28 overflow-y-auto overscroll-contain text-xs leading-relaxed text-ink-muted">{names.join(', ')}</p>
          </div>
        )}
      </div>
    </>
  )
}
