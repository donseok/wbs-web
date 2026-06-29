'use client'
import { useState, useMemo } from 'react'
import type { ComputedItem } from '@/lib/domain/types'
import { TreeTable } from './TreeTable'
import { GanttChart, flatten } from './GanttChart'
import { DetailPanel } from './DetailPanel'

function findItem(items: ComputedItem[], id: string | null): ComputedItem | null {
  if (!id) return null
  for (const n of items) {
    if (n.id === id) return n
    const found = findItem(n.children, id)
    if (found) return found
  }
  return null
}

export function WbsBoard({ items, holidays, today, membership }: {
  items: ComputedItem[]; holidays: string[]; today: string
  membership: { role: string; teamCode: string; teamId: string } | null
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const onToggle = (id: string) => setCollapsed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const flatRows = useMemo(() => flatten(items, collapsed), [items, collapsed])
  const allDates = items.flatMap(function dates(n): string[] {
    return [n.plannedStart, n.plannedEnd, ...n.children.flatMap(dates)].filter(Boolean) as string[]
  })
  const rangeStart = allDates.length ? allDates.reduce((a, b) => a < b ? a : b) : today
  const rangeEnd = allDates.length ? allDates.reduce((a, b) => a > b ? a : b) : today

  const selected = useMemo(() => findItem(items, selectedId), [items, selectedId])
  const canEdit = (item: ComputedItem): boolean =>
    membership?.role === 'pmo_admin' || (!!membership && item.owners.some(o => o.team === membership.teamCode))

  return (
    <div className="grid grid-cols-[1fr_1fr_280px] gap-3">
      <div className="overflow-auto">
        <TreeTable items={items} selectedId={selectedId} onSelect={setSelectedId} collapsed={collapsed} onToggle={onToggle} />
      </div>
      <div className="overflow-auto">
        <GanttChart rows={flatRows} holidays={holidays} rangeStart={rangeStart} rangeEnd={rangeEnd} today={today} />
      </div>
      <DetailPanel item={selected} canEdit={selected ? canEdit(selected) : false} />
    </div>
  )
}
