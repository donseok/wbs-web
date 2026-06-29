import type { ComputedItem } from '@/lib/domain/types'
import { collectLeaves } from './shared'

function avg(ns: number[]): number {
  return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0
}

export function ProjectHero({
  projectName,
  items,
}: {
  projectName: string
  items: ComputedItem[]
}) {
  const leaves = collectLeaves(items)
  const total = leaves.length
  const inProgress = leaves.filter(l => l.status === 'in_progress').length
  const delayed = leaves.filter(l => l.status === 'delayed').length
  const done = leaves.filter(l => l.status === 'done').length
  const notStarted = leaves.filter(l => l.status === 'not_started').length
  const overall = avg(items.map(r => r.rolledActualPct))
  const planned = avg(items.map(r => r.plannedPct))

  const seg = (n: number) => (total ? (n / total) * 100 : 0)

  return (
    <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-hero-from via-hero-via to-hero-to text-hero-ink shadow-lg">
      <div className="px-7 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hero-line/70 bg-white/[0.07] px-2.5 py-1 text-[11px] font-medium tracking-wide text-hero-ink-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              PROJECT · WBS
            </span>
            <h1 className="mt-2.5 truncate text-2xl font-bold tracking-tight">{projectName}</h1>
            <p className="mt-1 text-sm text-hero-ink-muted">
              작업분해구조(WBS) 기반 진척 관리 · 계획 대비 실적과 지연을 한눈에
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11px] uppercase tracking-wide text-hero-ink-muted">전체 진척률</div>
            <div className="mt-0.5 text-4xl font-bold tabular-nums">{overall}%</div>
            <div className="text-[11px] text-hero-ink-muted">계획 {planned}%</div>
          </div>
        </div>

        {/* KPI 타일 4개 */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile label="전체 작업" value={total} unit="건" accent="text-hero-ink" />
          <KpiTile label="진행중" value={inProgress} unit="건" accent="text-sky-300" />
          <KpiTile label="지연" value={delayed} unit="건" accent="text-rose-300" />
          <KpiTile label="완료" value={done} unit="건" accent="text-emerald-300" />
        </div>

        {/* 작업 상태 분포 막대 */}
        <div className="mt-4">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <span className="bg-emerald-400" style={{ width: `${seg(done)}%` }} />
            <span className="bg-sky-400" style={{ width: `${seg(inProgress)}%` }} />
            <span className="bg-rose-400" style={{ width: `${seg(delayed)}%` }} />
            <span className="bg-white/25" style={{ width: `${seg(notStarted)}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-hero-ink-muted">
            <Legend dot="bg-emerald-400" label={`완료 ${done}`} />
            <Legend dot="bg-sky-400" label={`진행중 ${inProgress}`} />
            <Legend dot="bg-rose-400" label={`지연 ${delayed}`} />
            <Legend dot="bg-white/30" label={`시작전 ${notStarted}`} />
          </div>
        </div>
      </div>
    </section>
  )
}

function KpiTile({
  label,
  value,
  unit,
  accent,
}: {
  label: string
  value: number
  unit: string
  accent: string
}) {
  return (
    <div className="kpi-tile">
      <div className="text-[11px] font-medium uppercase tracking-wide text-hero-ink-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-3xl font-bold tabular-nums ${accent}`}>{value}</span>
        <span className="text-xs text-hero-ink-muted">{unit}</span>
      </div>
    </div>
  )
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
