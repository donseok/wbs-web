'use client'
import { useMemo, useState } from 'react'
import type { ComputedItem } from '@/lib/domain/types'
import { buildGanttScale, collectPlannedDates } from '@/lib/domain/ganttScale'
import { Icon } from '@/components/ui/Icon'
import { StatusChip, OwnerBadges, STATUS, TEAM, fmtDate } from '@/components/wbs/shared'

const LEFT_W = 320
const ROW_H = 36

function flatten(items: ComputedItem[], collapsed: Set<string>): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) =>
    ns.forEach(n => {
      out.push(n)
      if (!collapsed.has(n.id)) walk(n.children)
    })
  walk(items)
  return out
}

/** 간트 전용 뷰 — 좁은 좌측 작업 목록 + 넓은 타임라인. 시각화 전용(편집은 WBS 화면). */
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
  const [dayPx, setDayPx] = useState(24)

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

  const collapsibleIds = useMemo(() => {
    const s = new Set<string>()
    const walk = (ns: ComputedItem[]) =>
      ns.forEach(n => {
        if (n.children.length) {
          s.add(n.id)
          walk(n.children)
        }
      })
    walk(items)
    return s
  }, [items])

  const flatRows = useMemo(() => flatten(items, collapsed), [items, collapsed])
  const scale = useMemo(
    () => buildGanttScale(collectPlannedDates(items), today, dayPx),
    [items, today, dayPx],
  )
  const holSet = useMemo(() => new Set(holidays), [holidays])

  const allCollapsed = collapsibleIds.size > 0 && [...collapsibleIds].every(id => collapsed.has(id))
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(collapsibleIds))
  const toggle = (id: string) =>
    setCollapsed(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const rowsH = flatRows.length * ROW_H
  const HEAD_H = 58

  return (
    <div className="relative w-full min-w-0 max-w-full">
      {/* 툴바 */}
      <div className="card mb-3 flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 overflow-hidden p-2.5">
        <div className="mr-2 flex items-center gap-2 px-1 text-sm font-semibold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-weak text-brand"><Icon name="calendar" className="h-4 w-4" /></span>
          <span>간트 타임라인</span>
        </div>
        <button onClick={toggleAll} className="btn btn-ghost h-9 px-3 text-xs">
          {allCollapsed ? '전체 펼치기' : '전체 접기'}
        </button>
        <span className="hidden rounded-lg bg-surface-2 px-2.5 py-2 text-[10px] tabular-nums text-ink-muted xl:inline">
          {fmtDate(scale.rangeStart)} – {fmtDate(scale.rangeEnd)} · {flatRows.length}행
        </span>
        <div className="seg ml-auto inline-flex h-9 gap-0.5 p-0.5" aria-label="간트 배율">
          {([['축소', 16], ['기본', 24], ['확대', 36]] as const).map(([label, px]) => (
            <button
              key={px}
              onClick={() => setDayPx(px)}
              aria-pressed={dayPx === px}
              className={`seg-item px-2.5 py-1 text-[12px] ${dayPx === px ? 'seg-item-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 스크롤 컨테이너 */}
      <div className="card w-full max-w-full overflow-auto" style={{ maxHeight: 'max(440px, calc(100dvh - 360px))' }}>
        <div className="relative" style={{ width: LEFT_W + scale.ganttW }}>
          {/* 배경 주말/공휴일 */}
          <div className="pointer-events-none absolute z-0" style={{ left: LEFT_W, top: HEAD_H, width: scale.ganttW, height: rowsH }}>
            {scale.days.map((d, i) => {
              const hol = holSet.has(d)
              const off = hol || scale.isWeekend(d)
              return (
                <div
                  key={d}
                  className="absolute top-0 box-border border-r border-grid"
                  style={{
                    left: i * dayPx,
                    width: dayPx,
                    height: rowsH,
                    background: hol ? 'var(--color-holiday-band)' : off ? 'var(--color-weekend)' : undefined,
                  }}
                />
              )
            })}
          </div>

          {/* 헤더 */}
          <div className="sticky top-0 z-40 flex w-max">
            <div
              className="freeze-edge box-border flex items-center bg-sheet-head px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted"
              style={{ width: LEFT_W, height: HEAD_H, position: 'sticky', left: 0, zIndex: 50, borderBottom: '2px solid var(--color-grid-strong)' }}
            >
              작업
            </div>
            <div className="relative box-border shrink-0 border-b-2 border-grid-strong bg-sheet-head" style={{ width: scale.ganttW, height: HEAD_H }}>
              {scale.months.map(m => (
                <div key={m.left} className="absolute top-0 box-border flex h-5 items-center border-r border-grid px-1.5 text-[10px] font-semibold text-ink-muted" style={{ left: m.left, width: m.width }}>
                  {m.label}
                </div>
              ))}
              {scale.weeks.map(w => (
                <div key={w.left} className="absolute box-border flex h-[19px] items-center gap-1 border-r border-grid px-1.5 text-[9.5px] font-medium text-ink-subtle" style={{ top: 20, left: w.left, width: w.width }}>
                  <span className="font-semibold text-ink-muted">{w.label}</span>
                  <span>{w.sub}</span>
                </div>
              ))}
              {dayPx >= 24 && scale.days.map((d, i) => (
                <div
                  key={d}
                  className={`absolute box-border border-r border-grid text-center text-[9px] leading-[18px] ${holSet.has(d) || scale.isWeekend(d) ? 'text-delayed/70' : 'text-ink-subtle'}`}
                  style={{ top: 39, left: i * dayPx, width: dayPx, height: 19 }}
                >
                  {new Date(d + 'T00:00:00Z').getUTCDate()}
                </div>
              ))}
            </div>
          </div>

          {/* 행 */}
          {flatRows.map(n => {
            const depth = depthMap.get(n.id) ?? 0
            const hasChildren = n.children.length > 0
            const isCollapsed = collapsed.has(n.id)
            const rowBg = n.level === 'phase' ? 'bg-[#f1f4f9]' : n.level === 'task' ? 'bg-[#f8faff]' : 'bg-surface'
            const nameWeight = n.level === 'phase' ? 'font-semibold text-ink' : n.level === 'task' ? 'font-medium text-ink' : 'text-ink'
            return (
              <div key={n.id} className="group relative z-10 box-border flex w-max" style={{ height: ROW_H }}>
                {/* 좌측 작업 정보 */}
                <div
                  className={`freeze-edge box-border flex items-center gap-2 border-b border-grid px-2 ${rowBg} group-hover:bg-brand-weak`}
                  style={{ width: LEFT_W, position: 'sticky', left: 0, zIndex: 20 }}
                >
                  <div className="flex min-w-0 flex-1 items-center" style={{ paddingLeft: depth * 12 }}>
                    {hasChildren ? (
                      <button onClick={() => toggle(n.id)} aria-label={isCollapsed ? '펼치기' : '접기'} aria-expanded={!isCollapsed} className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] text-ink-subtle hover:bg-line hover:text-ink">
                        {isCollapsed ? '▸' : '▾'}
                      </button>
                    ) : (
                      <span className="mr-1 w-4 shrink-0" />
                    )}
                    <span className={`truncate text-[12.5px] ${nameWeight}`} title={n.name}>{n.name}</span>
                  </div>
                  <div className="hidden shrink-0 sm:block"><OwnerBadges owners={n.owners} /></div>
                  <div className="shrink-0"><StatusChip status={n.status} /></div>
                </div>
                {/* 타임라인 바 */}
                <div className="relative box-border h-full shrink-0 border-b border-grid" style={{ width: scale.ganttW }}>
                  {n.plannedStart && n.plannedEnd && <Bar n={n} xOf={scale.xOf} dayPx={dayPx} />}
                </div>
              </div>
            )
          })}

          {flatRows.length === 0 && (
            <div className="sticky left-0 z-10 flex flex-col items-center justify-center gap-1.5 py-20 text-center" style={{ width: 'min(560px, 100vw)' }} role="status">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-weak text-brand" aria-hidden><Icon name="calendar" /></span>
              <span className="text-sm font-medium text-ink-muted">표시할 작업이 없습니다</span>
              <span className="text-[12px] text-ink-subtle">WBS 엑셀을 업로드하면 일정이 간트로 표시됩니다.</span>
            </div>
          )}

          {/* 오늘 세로선 */}
          {scale.todayX != null && (
            <div className="pointer-events-none absolute z-30" style={{ left: LEFT_W, top: HEAD_H, width: scale.ganttW, height: rowsH }}>
              <div className="absolute top-0 w-0.5 -translate-x-1/2 bg-today" style={{ left: scale.todayX, height: rowsH }} />
              <div className="absolute -translate-x-1/2 rounded-sm bg-today px-1 py-0.5 text-[8px] font-bold leading-none text-white" style={{ left: scale.todayX, top: 0 }}>오늘</div>
            </div>
          )}
        </div>
      </div>

      {/* 범례 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-line/70 bg-surface/70 px-3 py-2 text-[11px] text-ink-subtle">
        <span className="inline-flex items-center gap-2">
          {(['done', 'in_progress', 'delayed', 'not_started'] as const).map(s => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${STATUS[s].dot}`} />{STATUS[s].label}
            </span>
          ))}
        </span>
        <span className="inline-flex items-center gap-2">
          {(['PMO', 'DT', 'ERP', 'MES'] as const).map(t => (
            <span key={t} className="inline-flex items-center gap-0.5"><span className={`${TEAM[t].fg} text-[9px]`}>●</span>{t}</span>
          ))}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-sm" style={{ background: 'var(--color-weekend)' }} />주말
          <span className="ml-1 h-3 w-3 rounded-sm" style={{ background: 'var(--color-holiday-band)' }} />공휴일
        </span>
        <span className="text-ink-muted">실적% 편집은 WBS 화면에서 합니다.</span>
      </div>
    </div>
  )
}

function Bar({ n, xOf, dayPx }: { n: ComputedItem; xOf: (d: string) => number; dayPx: number }) {
  const left = xOf(n.plannedStart!)
  const width = Math.max(dayPx * 0.5, xOf(n.plannedEnd!) + dayPx - left)
  const pct = Math.min(100, Math.max(0, n.rolledActualPct))
  const showOutside = n.status !== 'done'

  if (n.level === 'phase') {
    return (
      <div className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[3px] bg-phasebar" style={{ left, width }}>
        <div className="h-full rounded-[3px] bg-phasebar-fill opacity-60" style={{ width: `${pct}%` }} />
        {showOutside && (
          <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1 text-[9px] tabular-nums text-ink-muted" style={{ left: width }}>{pct}%</span>
        )}
      </div>
    )
  }

  return (
    <div className="absolute top-1/2 h-3.5 -translate-y-1/2 overflow-visible rounded-full" style={{ left, width }}>
      <div className="h-full overflow-hidden rounded-full bg-plan-track ring-1 ring-grid">
        <div className={`h-full rounded-full ${STATUS[n.status].bar}`} style={{ width: `${pct}%` }} />
      </div>
      {showOutside && (
        <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1 text-[9px] tabular-nums text-ink-muted" style={{ left: width }}>{pct}%</span>
      )}
    </div>
  )
}
