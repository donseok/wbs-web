'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Link2, Sparkles, Unlink } from 'lucide-react'
import type { InsightKind, MinuteHighlight, MinuteInsight } from '@/lib/domain/types'
import type { MinuteBlock } from '@/lib/minutes/blocks'
import {
  INS_PRIORITY, insightCardState, topHighlightedBlocks, visibleInsights,
} from '@/lib/minutes/annotations'
import { ensureMinuteInsightsAction, linkMinuteInsightToWbsAction, searchWbsForMinuteAction, unlinkMinuteInsightFromWbsAction } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'

/** kind 칩 색 — 결정=done/액션=progress/기한=accent-warning/리스크=delayed (스펙 §6.2, StatusPill 패턴). */
const KIND_CHIP: Record<InsightKind, { chip: string; dot: string }> = {
  decision: { chip: 'bg-done-weak text-done', dot: 'bg-done' },
  action: { chip: 'bg-progress-weak text-progress', dot: 'bg-progress' },
  deadline: { chip: 'bg-accent-warning/15 text-accent-warning', dot: 'bg-accent-warning' },
  risk: { chip: 'bg-delayed-weak text-delayed', dot: 'bg-delayed' },
}

export function MinuteInsightCard({
  minuteId, projectId, insights, highlights, blocks, bodyHash, onJump,
}: {
  minuteId: string
  projectId: string | null
  insights: MinuteInsight[]
  highlights: MinuteHighlight[]
  blocks: MinuteBlock[]
  bodyHash: string
  onJump: (blockIndex: number) => void
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

  async function linkAction(i: MinuteInsight) {
    if (!projectId) return
    const query = window.prompt('연결할 WBS 작업명 검색')?.trim()
    if (!query) return
    const matches = await searchWbsForMinuteAction(projectId, query)
    if (!matches.length) { window.alert('검색 결과가 없습니다.'); return }
    const choice = window.prompt(matches.map((x, n) => `${n + 1}. ${x.name}`).join('\n') + '\n번호를 입력하세요', '1')
    const selected = matches[Number(choice) - 1]
    if (!selected) return
    const result = await linkMinuteInsightToWbsAction(i.id, selected.id)
    if (result.ok) router.refresh(); else window.alert(result.error ?? '연결에 실패했습니다.')
  }

  // 표시할 것이 전무하면(빈 본문 등) 카드 자체를 숨김
  if (blocks.length === 0) return null

  const counts = INS_PRIORITY.map(k => [k, items.filter(i => i.kind === k).length] as const)
    .filter(([, n]) => n > 0)

  return (
    <div className="card shrink-0 p-4">
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
        </span>
        <button onClick={() => setOpen(o => !o)}
          className="ml-auto inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {open ? t('min.insight.collapse') : t('min.insight.expand')}
        </button>
      </div>

      {open && (
        <div className="mt-2 max-h-60 space-y-2 overflow-y-auto">
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
                    {i.kind === 'action' && projectId && (i.linkedWbsItemId ? (
                      <button title="WBS 연결 해제" className="shrink-0 text-brand" onClick={async e => { e.stopPropagation(); await unlinkMinuteInsightFromWbsAction(i.id); router.refresh() }}>
                        <Unlink className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button title="WBS 연결" className="shrink-0 text-ink-subtle hover:text-brand" onClick={e => { e.stopPropagation(); void linkAction(i) }}>
                        <Link2 className="h-3.5 w-3.5" />
                      </button>
                    ))}
                    {i.linkedWbsItemName && <span className="max-w-32 truncate text-[11px] text-brand">↔ {i.linkedWbsItemName}</span>}
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
        </div>
      )}
    </div>
  )
}
