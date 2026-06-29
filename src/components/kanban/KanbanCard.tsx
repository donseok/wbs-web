import type { DragEvent } from 'react'
import { CalendarRange } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { OwnerBadges, STATUS, fmtDate } from '@/components/wbs/shared'

/** 칸반 카드 — 작업명(2줄)·기간·진척바·상태·담당팀. 왼쪽에 상태색 액센트. */
export function KanbanCard({
  card, draggable = false, dragging = false, onDragStart, onDragEnd,
}: {
  card: ComputedItem
  draggable?: boolean
  dragging?: boolean
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void
}) {
  const accent = STATUS[card.status].bar
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative overflow-hidden rounded-xl border border-line bg-surface p-3.5 shadow-sm transition
        ${draggable ? 'cursor-grab select-none hover:border-line-strong hover:shadow-md active:cursor-grabbing' : ''}
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
          <ProgressBar value={card.rolledActualPct} tone={accent} height="h-1.5" label={`${card.name} 실적`} />
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink-muted">{card.rolledActualPct}%</span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <StatusPill status={card.status} />
          <OwnerBadges owners={card.owners} />
        </div>
      </div>
    </div>
  )
}
