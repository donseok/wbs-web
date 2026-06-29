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

const DAY = 20 // px per day
function iso(d: Date) { return d.toISOString().slice(0, 10) }

const BAR: Record<string, string> = {
  not_started: 'bg-pending',
  in_progress: 'bg-progress',
  delayed: 'bg-delayed',
  done: 'bg-done',
}

export function GanttChart({ rows, holidays, rangeStart, rangeEnd, today }: {
  rows: ComputedItem[]; holidays: string[]; rangeStart: string; rangeEnd: string; today: string
}) {
  const start = new Date(rangeStart + 'T00:00:00Z')
  const end = new Date(rangeEnd + 'T00:00:00Z')
  const days: string[] = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(iso(d))
  const holSet = new Set(holidays)
  const xOf = (date: string) => (new Date(date + 'T00:00:00Z').getTime() - start.getTime()) / 86400000 * DAY
  const isOff = (d: string) => { const dow = new Date(d + 'T00:00:00Z').getUTCDay(); return dow === 0 || dow === 6 || holSet.has(d) }

  // 주 단위 헤더 그룹
  const weeks: { label: string; left: number; width: number }[] = []
  for (let i = 0; i < days.length; i += 7) {
    const w = Math.min(7, days.length - i)
    weeks.push({ label: 'W' + String(weeks.length + 1).padStart(2, '0'), left: i * DAY, width: w * DAY })
  }

  const width = days.length * DAY

  return (
    <div className="border-l border-t border-grid" style={{ width }}>
      {/* ── 헤더: 주 / 날짜 2단 (총 48px, 트리 헤더와 정렬) ── */}
      <div className="sticky top-0 z-10">
        <div className="relative box-border h-6 bg-sheet-head">
          {weeks.map(w => (
            <div
              key={w.left}
              className="absolute box-border flex h-6 items-center border-r border-b border-grid px-1.5 text-[10px] font-semibold text-ink-muted"
              style={{ left: w.left, width: w.width }}
            >
              {w.label}
            </div>
          ))}
        </div>
        <div className="relative box-border h-6 border-b-2 border-grid-strong bg-sheet-head">
          {days.map((d, i) => (
            <div
              key={d}
              className={`absolute box-border h-6 border-r border-grid text-center text-[9px] leading-6 ${isOff(d) ? 'bg-pending-weak text-ink-subtle' : 'text-ink-muted'}`}
              style={{ left: i * DAY, width: DAY }}
            >
              {new Date(d + 'T00:00:00Z').getUTCDate()}
            </div>
          ))}
        </div>
      </div>

      {/* ── 바디: 음영 + 격자 + 오늘선 + 막대 ── */}
      <div className="relative">
        {/* 배경: 세로 격자 + 주말/공휴일 음영 */}
        <div className="pointer-events-none absolute inset-0">
          {days.map((d, i) => (
            <div
              key={d}
              className={`absolute top-0 bottom-0 box-border border-r border-grid ${isOff(d) ? 'bg-pending-weak/60' : ''}`}
              style={{ left: i * DAY, width: DAY }}
            />
          ))}
          {/* 오늘 세로선 */}
          <div className="absolute top-0 bottom-0 z-10 w-0.5 -translate-x-1/2 bg-delayed" style={{ left: xOf(today) }} />
        </div>

        {/* 막대 행 (각 24px box-border, 트리 행과 1:1 정렬) */}
        <div className="relative">
          {rows.map(n => {
            if (!n.plannedStart || !n.plannedEnd) return <div key={n.id} className="box-border h-6 border-b border-grid" />
            const left = xOf(n.plannedStart)
            const w = xOf(n.plannedEnd) + DAY - left
            return (
              <div key={n.id} className="relative box-border h-6 border-b border-grid">
                <div
                  className="absolute top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full bg-line-strong/60 shadow-sm ring-1 ring-grid"
                  style={{ left, width: w }}
                >
                  <div
                    className={`h-full rounded-full ${BAR[n.status] ?? 'bg-progress'}`}
                    style={{ width: `${n.rolledActualPct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
