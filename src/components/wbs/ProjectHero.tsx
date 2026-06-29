import type { ComputedItem } from '@/lib/domain/types'
import { Icon, type IconName } from '@/components/ui/Icon'
import { collectLeaves } from './shared'

function avg(ns: number[]): number {
  return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0
}

export function ProjectHero({ projectName, items }: { projectName: string; items: ComputedItem[] }) {
  const leaves = collectLeaves(items)
  const total = leaves.length
  const inProgress = leaves.filter(item => item.status === 'in_progress').length
  const delayed = leaves.filter(item => item.status === 'delayed').length
  const done = leaves.filter(item => item.status === 'done').length
  const overall = avg(items.map(item => item.rolledActualPct))
  const planned = avg(items.map(item => item.plannedPct))
  const gap = overall - planned

  return (
    <section className="hero-glow relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-hero-from via-hero-via to-hero-to text-hero-ink shadow-[0_18px_48px_rgb(15_23_42/0.16)]">
      <div className="relative z-10 flex flex-col gap-5 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#aab8d9]">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 text-[#9cb0ff]"><Icon name="layers" className="h-3.5 w-3.5" /></span>
            Active project
          </div>
          <h1 className="mt-2 break-words text-2xl font-bold tracking-[-0.025em] sm:text-[28px]">{projectName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#b8c4df]">
            <span>{total}개 작업</span>
            <span className="h-1 w-1 rounded-full bg-white/30" />
            <span className={gap < 0 ? 'text-[#ffb4b4]' : 'text-[#8ee0c2]'}>계획 대비 {gap > 0 ? '+' : ''}{gap}%p</span>
            {delayed > 0 && (
              <><span className="h-1 w-1 rounded-full bg-white/30" /><span className="font-semibold text-[#ffb4b4]">지연 {delayed}건</span></>
            )}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 items-center gap-5 sm:min-w-[460px] sm:grid-cols-[minmax(160px,1fr)_auto]">
          <div>
            <div className="flex items-center justify-between text-[11px] text-[#b8c4df]">
              <span>전체 진행률</span>
              <span className="tabular-nums">계획 {planned}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`전체 실적 ${overall}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={overall}>
              <div className="h-full rounded-full bg-gradient-to-r from-[#7690ff] to-white shadow-[0_0_14px_rgb(118_144_255/0.75)]" style={{ width: `${overall}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <MiniStat icon="clock" label="진행" value={inProgress} tone="text-[#aabaff]" />
              <MiniStat icon="alert" label="지연" value={delayed} tone="text-[#ffb4b4]" />
              <MiniStat icon="check" label="완료" value={done} tone="text-[#8ee0c2]" />
            </div>
          </div>
          <div className="hidden border-l border-white/10 pl-5 text-right sm:block">
            <div className="text-4xl font-bold tabular-nums tracking-[-0.04em] sm:text-[44px]">{overall}<span className="text-xl text-[#aab8d9]">%</span></div>
            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#91a1c4]">actual</div>
          </div>
        </div>
      </div>
    </section>
  )
}

function MiniStat({ icon, label, value, tone }: { icon: IconName; label: string; value: number; tone: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2 py-1 text-[10px] text-[#b8c4df]">
      <Icon name={icon} className={`h-3 w-3 ${tone}`} />
      {label} <strong className={`tabular-nums ${tone}`}>{value}</strong>
    </span>
  )
}
