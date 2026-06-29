'use client'
import type { ComputedItem } from '@/lib/domain/types'

export function flatten(items: ComputedItem[], collapsed: Set<string>): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach(n => {
    out.push(n)
    if (!collapsed.has(n.id)) walk(n.children)
  })
  walk(items)
  return out
}

const DAY = 18 // px per day
function iso(d: Date) { return d.toISOString().slice(0, 10) }

export function GanttChart({ rows, holidays, rangeStart, rangeEnd, today }: {
  rows: ComputedItem[]; holidays: string[]; rangeStart: string; rangeEnd: string; today: string
}) {
  const start = new Date(rangeStart + 'T00:00:00Z')
  const end = new Date(rangeEnd + 'T00:00:00Z')
  const days: string[] = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(iso(d))
  const holSet = new Set(holidays)
  const xOf = (date: string) => (new Date(date + 'T00:00:00Z').getTime() - start.getTime()) / 86400000 * DAY

  return (
    <div className="relative" style={{ width: days.length * DAY }}>
      {/* 배경: 주말/공휴일 음영 */}
      <div className="absolute inset-0">
        {days.map((d, i) => {
          const dow = new Date(d + 'T00:00:00Z').getUTCDay()
          const off = dow === 0 || dow === 6 || holSet.has(d)
          return <div key={d} className={off ? 'bg-gray-100' : ''} style={{ position: 'absolute', left: i * DAY, width: DAY, top: 0, bottom: 0 }} />
        })}
        <div className="absolute top-0 bottom-0 w-px bg-red-500" style={{ left: xOf(today) }} />
      </div>
      {/* 막대 행 */}
      <div className="relative">
        {rows.map(n => {
          if (!n.plannedStart || !n.plannedEnd) return <div key={n.id} className="h-6" />
          const left = xOf(n.plannedStart)
          const width = xOf(n.plannedEnd) + DAY - left
          return (
            <div key={n.id} className="relative h-6">
              <div className="absolute top-1 h-3 rounded bg-gray-300" style={{ left, width }}>
                <div className={`h-3 rounded ${n.status === 'delayed' ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${n.rolledActualPct}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
