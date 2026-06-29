'use client'
import { useState, useMemo } from 'react'
import type { ComputedItem } from '@/lib/domain/types'
import { TreeTable } from './TreeTable'
import { GanttChart, flatten } from './GanttChart'

export function WbsBoard({ items, holidays, today }: {
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

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-3">
      <div className="overflow-auto">
        <TreeTable items={items} selectedId={selectedId} onSelect={setSelectedId} collapsed={collapsed} onToggle={onToggle} />
      </div>
      <div className="overflow-auto">
        <GanttChart rows={flatRows} holidays={holidays} rangeStart={rangeStart} rangeEnd={rangeEnd} today={today} />
      </div>
    </div>
  )
}
