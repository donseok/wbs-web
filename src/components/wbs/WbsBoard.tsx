'use client'
import { useState } from 'react'
import type { ComputedItem } from '@/lib/domain/types'
import { TreeTable } from './TreeTable'

export function WbsBoard({ projectId, items, holidays, today, membership }: {
  projectId: string; items: ComputedItem[]; holidays: string[]; today: string
  membership: { role: string; teamCode: string; teamId: string } | null
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-3" data-project-id={projectId}
      data-today={today} data-holiday-count={holidays.length} data-role={membership?.role ?? ''}>
      <div className="overflow-auto"><TreeTable items={items} selectedId={selectedId} onSelect={setSelectedId} /></div>
      <div id="gantt-slot" className="overflow-auto" />
      {/* 간트(Task 11), 상세 패널(Task 12)에서 확장 */}
    </div>
  )
}
