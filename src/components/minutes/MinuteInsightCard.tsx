'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, ChevronUp, CircleAlert, ExternalLink, Sparkles } from 'lucide-react'
import type { InsightKind, MinuteHighlight, MinuteInsight } from '@/lib/domain/types'
import type { MinuteBlock } from '@/lib/minutes/blocks'
import type { MinuteLinkedIssue } from '@/lib/domain/issueMinuteSource'
import { ISSUE_STATUS_META } from '@/lib/domain/issues'
import {
  INS_PRIORITY, insightCardState, topHighlightedBlocks, visibleInsights,
} from '@/lib/minutes/annotations'
import { ensureMinuteInsightsAction } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'

/** kind 칩 색 — 결정=done/액션=progress/기한=accent-warning/리스크=delayed (스펙 §6.2, StatusPill 패턴). */
const KIND_CHIP: Record<InsightKind, { chip: string; dot: string }> = {
  decision: { chip: 'bg-done-weak text-done', dot: 'bg-done' },
  action: { chip: 'bg-progress-weak text-progress', dot: 'bg-progress' },
  deadline: { chip: 'bg-accent-warning/15 text-accent-warning', dot: 'bg-accent-warning' },
  risk: { chip: 'bg-delayed-weak text-delayed', dot: 'bg-delayed' },
}

export function MinuteInsightCard({
  minuteId, insights, highlights, blocks, bodyHash, onJump, linkedIssues = [], details,
}: {
  minuteId: string
  insights: MinuteInsight[]
  highlights: MinuteHighlight[]
  blocks: MinuteBlock[]
  bodyHash: string
  onJump: (blockIndex: number) => void
  linkedIssues?: MinuteLinkedIssue[]
  details?: ReactNode
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [healState, setHealState] = useState<'idle' | 'running' | 'failed'>('idle')
  const cardState = insightCardState(insights, bodyHash)
  const items = visibleInsights(insights, blocks, bodyHash)
  const attention = topHighlightedBlocks(highlights, blocks)
  const healRan = useRef(false)

  const runHeal = useCallback(() => {
    setHealState('running')
    ensureMinuteInsightsAction(minuteId).then(({ status }) => {
      // 'ready'도 refresh — runHeal은 pending(props가 낡음)에서만 불리므로 DB가 신선하면 재수화 필요(경합 고착 방지)
      if (status === 'generated' || status === 'ready') { setHealState('idle'); router.refresh() }
      else setHealState('failed')
    }).catch(() => setHealState('failed'))
  }, [minuteId, router])

  // self-heal: stale/행0(pending)일 때만 마운트 후 1회 — fresh 면 즉시 렌더(플리커 없음, 스펙 §3.3-1)
  useEffect(() => {
    if (cardState !== 'pending' || healRan.current) return
    healRan.current = true
    runHeal()
  }, [cardState, runHeal])

  // 빈 본문이어도 함께 묶인 버전/Wiki 정보가 있으면 요약 진입점은 유지한다.
  if (blocks.length === 0 && !details) return null

  const counts = INS_PRIORITY.map(k => [k, items.filter(i => i.kind === k).length] as const)
    .filter(([, n]) => n > 0)

  return (
    <div className="card shrink-0 px-4 py-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand" />
        <span className="text-sm font-bold text-ink">{t('min.insight.title')}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {counts.map(([k, n]) => (
            <span key={k} className={`chip ${KIND_CHIP[k].chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${KIND_CHIP[k].dot}`} />
              {t(`min.insight.kind.${k}`)} {n}
            </span>
          ))}
          {linkedIssues.length > 0 && (
            <button onClick={() => setOpen(true)} className="chip bg-progress-weak text-progress">
              <CircleAlert className="h-3 w-3" aria-hidden />
              {t('min.issue.count').replace('{n}', String(linkedIssues.length))}
            </button>
          )}
        </span>
        <button onClick={() => setOpen(o => !o)}
          className="ml-auto inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {open ? t('min.insight.collapse') : t('min.insight.expand')}
        </button>
      </div>

      {open && (
        <div className="mt-2 max-h-96 space-y-3 overflow-y-auto">
          <div className="space-y-2">
            {cardState === 'pending' && healState !== 'failed' && (
              <p className="text-sm text-ink-muted">{t('min.insight.preparing')}</p>
            )}
            {cardState === 'pending' && healState === 'failed' && (
              <p className="text-sm text-ink-muted">
                {t('min.insight.unavailable')}
                <button onClick={runHeal} className="ml-2 text-brand underline underline-offset-2">
                  {t('min.insight.retry')}
                </button>
              </p>
            )}
            {cardState === 'empty' && (
              <p className="text-sm text-ink-muted">{t('min.insight.none')}</p>
            )}
            {cardState === 'ready' && (
              <ul className="space-y-1">
                {INS_PRIORITY.flatMap(k => items.filter(i => i.kind === k)).map(i => (
                  <li key={i.id}>
                    <button onClick={() => onJump(i.blockIndex)}
                      className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-sm text-ink hover:bg-surface-2">
                      <span className={`chip mt-0.5 shrink-0 ${KIND_CHIP[i.kind as InsightKind].chip}`}>
                        {t(`min.insight.kind.${i.kind as InsightKind}`)}
                      </span>
                      {/* 순수 텍스트 렌더 — LLM 산출물 링크화 금지(프롬프트 인젝션 차단, 스펙 §6.2) */}
                      <span className="min-w-0 flex-1">{i.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {attention.length > 0 && (
              <div className="border-t border-line pt-2">
                <p className="eyebrow mb-1">{t('min.insight.attention')}</p>
                <ul className="space-y-1">
                  {attention.map(a => (
                    <li key={a.blockIndex}>
                      <button onClick={() => onJump(a.blockIndex)}
                        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm text-ink-muted hover:bg-surface-2">
                        <span className="min-w-0 flex-1 truncate">“{a.excerpt}”</span>
                        <span className="chip shrink-0 bg-accent-warning/15 text-accent-warning">👤 {a.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {linkedIssues.length > 0 && (
              <div className="border-t border-line pt-2">
                <p className="eyebrow mb-1.5">{t('min.issue.linked')}</p>
                <ul className="space-y-1.5">
                  {linkedIssues.map(issue => {
                    const meta = ISSUE_STATUS_META[issue.status]
                    return (
                      <li key={issue.linkId} className="flex items-center gap-1.5">
                        <button
                          onClick={() => onJump(issue.blockIndex)}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs text-ink hover:bg-surface-2"
                        >
                          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-progress" aria-hidden />
                          <span className="shrink-0 font-semibold text-progress">
                            {issue.piIssueCode ?? t('min.issue.open').replace('{n}', String(issue.issueNo))}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                          <span className={`chip shrink-0 ${meta.chip}`}>{t(meta.labelKey)}</span>
                          <span className="shrink-0 text-[11px] text-brand">{t('min.issue.jump')}</span>
                        </button>
                        <Link
                          href={`/p/${issue.projectId}/issues?focus=${encodeURIComponent(issue.issueId)}`}
                          title={t('min.issue.openManagement')}
                          aria-label={t('min.issue.openManagement')}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-2 hover:text-brand"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
          {details && (
            <div className="grid gap-4 border-t border-line pt-3 xl:grid-cols-2">
              {details}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
