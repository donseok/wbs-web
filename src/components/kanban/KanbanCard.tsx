'use client'

import type { DragEvent, KeyboardEvent } from 'react'
import { CalendarRange } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { OwnerBadges, STATUS, fmtDate } from '@/components/wbs/shared'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

/** 칸반 카드 — 작업명(2줄)·기간·진척바·상태·담당팀. 왼쪽에 상태색 액센트.
 *  status 모드에서 편집 가능하면 드래그 + 키보드(Enter/Space로 완료 토글)로 조작한다. */
export function KanbanCard({
  card, draggable = false, dragging = false, interactive = false,
  onDragStart, onDragEnd, onActivate,
}: {
  card: ComputedItem
  draggable?: boolean
  dragging?: boolean
  interactive?: boolean
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void
  onActivate?: () => void
}) {
  const { t } = useLocale()
  const accent = STATUS[card.status].bar
  const done = card.status === 'done'
  const handleKeyDown = interactive && onActivate
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate()
        }
      }
    : undefined
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      aria-roledescription={interactive ? t('kanban.card.roleDesc') : undefined}
      aria-label={interactive ? `${card.name} — ${t('kanban.card.actual')} ${Math.round(card.rolledActualPct)}%, ${t(`status.${card.status}` as DictKey)}. ${done ? t('kanban.card.enterClear') : t('kanban.card.enterDone')}` : undefined}
      onKeyDown={handleKeyDown}
      className={`group relative shrink-0 overflow-hidden rounded-xl border border-line bg-surface p-3.5 shadow-sm transition
        ${draggable ? 'cursor-grab select-none hover:border-line-strong hover:shadow-md active:cursor-grabbing' : ''}
        ${interactive ? 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring' : ''}
        ${dragging ? 'opacity-40' : ''}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} aria-hidden />
      <div className="pl-1.5">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink" title={card.name}>{card.name}</p>

        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-subtle">
          <CalendarRange className="h-3 w-3 shrink-0" />
          <span className="tabular-nums">{fmtDate(card.plannedStart)} ~ {fmtDate(card.plannedEnd)}</span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <ProgressBar value={card.rolledActualPct} tone={accent} height="h-1.5" label={`${card.name} ${t('kanban.card.actual')}`} />
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink-muted">{Math.round(card.rolledActualPct)}%</span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <StatusPill status={card.status} />
          <OwnerBadges owners={card.owners} />
        </div>
      </div>
    </div>
  )
}
