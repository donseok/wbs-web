'use client'
import { useState, useMemo } from 'react'
import type { ComputedItem } from '@/lib/domain/types'
import { GanttChart, flatten } from './GanttChart'
import { STATUS } from './shared'

export function GanttView({
  items,
  holidays,
  today,
}: {
  items: ComputedItem[]
  holidays: string[]
  today: string
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setCollapsed(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const flatRows = useMemo(() => flatten(items, collapsed), [items, collapsed])
  const depthMap = useMemo(() => {
    const m = new Map<string, number>()
    const walk = (ns: ComputedItem[], d: number) =>
      ns.forEach(n => {
        m.set(n.id, d)
        walk(n.children, d + 1)
      })
    walk(items, 0)
    return m
  }, [items])

  const allDates = items.flatMap(function dates(n): string[] {
    return [n.plannedStart, n.plannedEnd, ...n.children.flatMap(dates)].filter(Boolean) as string[]
  })
  const rangeStart = allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)) : today
  const rangeEnd = allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : today

  return (
    <div className="card overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
      <div className="grid grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        {/* ── 슬림 트리 (작업명 + 실적%) ── */}
        <div className="sticky left-0 z-20 border-r border-grid-strong bg-surface">
          <div className="sticky top-0 z-10 box-border flex h-12 items-end border-b-2 border-grid-strong bg-sheet-head px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            <span className="flex-1">작업명</span>
            <span className="w-12 text-right">실적%</span>
          </div>
          {flatRows.map(n => {
            const depth = depthMap.get(n.id) ?? 0
            const hasChildren = n.children.length > 0
            const isCollapsed = collapsed.has(n.id)
            const rowBg =
              n.level === 'phase' ? 'bg-sheet-head' : n.level === 'task' ? 'bg-surface-2' : 'bg-surface'
            const nameWeight =
              n.level === 'phase'
                ? 'font-semibold text-ink'
                : n.level === 'task'
                  ? 'font-medium text-ink'
                  : 'text-ink'
            return (
              <div
                key={n.id}
                className={`box-border flex h-6 items-center border-b border-grid px-3 text-[13px] ${rowBg}`}
              >
                <div className="flex min-w-0 flex-1 items-center" style={{ paddingLeft: depth * 12 }}>
                  {hasChildren ? (
                    <button
                      onClick={() => toggle(n.id)}
                      className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] text-ink-subtle hover:bg-line hover:text-ink"
                      aria-label={isCollapsed ? '펼치기' : '접기'}
                    >
                      {isCollapsed ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span className="mr-1 w-4 shrink-0" />
                  )}
                  <span className={`mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS[n.status].dot}`} />
                  <span className={`truncate ${nameWeight}`} title={n.name}>
                    {n.name}
                  </span>
                </div>
                <span
                  className={`w-12 shrink-0 text-right tabular-nums ${
                    n.status === 'delayed' ? 'font-semibold text-delayed' : 'text-ink-muted'
                  }`}
                >
                  {n.rolledActualPct}%
                </span>
              </div>
            )
          })}
        </div>

        {/* ── 간트 타임라인 ── */}
        <div>
          <GanttChart
            rows={flatRows}
            holidays={holidays}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            today={today}
          />
        </div>
      </div>
    </div>
  )
}
