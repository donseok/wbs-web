import { Kpi } from './Kpi'
import { DelayedList } from './DelayedList'
import type { ComputedItem, TeamCode } from '@/lib/domain/types'
import { Icon } from '@/components/ui/Icon'
import { TEAM } from '@/components/wbs/shared'

function avg(ns: number[]): number {
  return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0
}

export function DashboardView({ items }: { items: ComputedItem[] }) {
  const roots = items
  const overallPlanned = avg(roots.map(root => root.plannedPct))
  const overallActual = avg(roots.map(root => root.rolledActualPct))
  const variance = overallActual - overallPlanned
  const teams: TeamCode[] = ['PMO', 'DT', 'ERP', 'MES']
  const leaves: ComputedItem[] = []
  const walk = (nodes: ComputedItem[]) => nodes.forEach(node => { if (!node.children.length) leaves.push(node); walk(node.children) })
  walk(items)
  const delayedCount = leaves.filter(leaf => leaf.status === 'delayed').length
  const teamSummary = (team: TeamCode) => {
    const assigned = leaves.filter(leaf => leaf.owners.some(owner => owner.team === team))
    return { count: assigned.length, pct: assigned.length ? avg(assigned.map(leaf => leaf.rolledActualPct)) : null }
  }

  if (items.length === 0) {
    return (
      <div className="card flex min-h-80 flex-col items-center justify-center px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-weak text-brand"><Icon name="chart" /></span>
        <h2 className="mt-4 text-base font-semibold text-ink">분석할 WBS 데이터가 없습니다</h2>
        <p className="mt-1 max-w-md text-sm leading-6 text-ink-muted">설정에서 WBS 엑셀을 가져오면 진행률, 팀별 현황, 지연 작업을 자동으로 분석합니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div><div className="eyebrow">Performance snapshot</div><h2 className="mt-1 text-lg font-bold tracking-tight text-ink">진행 현황</h2></div>
        <span className="text-xs text-ink-subtle">실적 기준 자동 집계</span>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="전체 실적" value={`${overallActual}%`} sub="Actual" icon="chart" tone="brand" />
        <Kpi label="전체 계획" value={`${overallPlanned}%`} sub="Plan" icon="calendar" tone="neutral" />
        <Kpi label="계획 대비 편차" value={`${variance > 0 ? '+' : ''}${variance}%p`} sub={variance >= 0 ? '계획 이상' : '계획 미달'} icon={variance >= 0 ? 'check' : 'alert'} tone={variance >= 0 ? 'success' : 'danger'} />
        <Kpi label="지연 작업" value={String(delayedCount)} sub={`전체 ${leaves.length}건 중`} icon="alert" tone="danger" />
      </div>

      <DelayedList items={items} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="card p-5" aria-labelledby="phase-title">
          <div className="flex items-center justify-between">
            <div><div className="eyebrow">By phase</div><h3 id="phase-title" className="mt-1 text-sm font-semibold text-ink">Phase별 진척</h3></div>
            <div className="flex items-center gap-3 text-[10px] text-ink-subtle"><span className="inline-flex items-center gap-1"><span className="h-1.5 w-4 rounded-full bg-brand" />실적</span><span className="inline-flex items-center gap-1"><span className="h-3 w-0.5 bg-ink-muted" />계획</span></div>
          </div>
          <div className="mt-5 space-y-5">
            {roots.map(phase => (
              <div key={phase.id}>
                <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-medium text-ink" title={phase.name}>{phase.name}</span>
                  <span className="shrink-0 tabular-nums"><strong className={phase.status === 'delayed' ? 'text-delayed' : 'text-ink'}>{phase.rolledActualPct}%</strong><span className="text-ink-subtle"> / {phase.plannedPct}%</span></span>
                </div>
                <div className="relative h-2.5 rounded-full bg-line" role="progressbar" aria-label={`${phase.name} 실적 ${phase.rolledActualPct}%, 계획 ${phase.plannedPct}%`} aria-valuenow={phase.rolledActualPct} aria-valuemin={0} aria-valuemax={100}>
                  <div className={`h-full rounded-full ${phase.status === 'delayed' ? 'bg-delayed' : phase.status === 'done' ? 'bg-done' : 'bg-brand'}`} style={{ width: `${phase.rolledActualPct}%` }} />
                  <span className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-ink-muted" style={{ left: `${Math.min(100, phase.plannedPct)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5" aria-labelledby="team-title">
          <div><div className="eyebrow">By owner</div><h3 id="team-title" className="mt-1 text-sm font-semibold text-ink">팀별 진척</h3></div>
          <div className="mt-5 space-y-5">
            {teams.map(team => {
              const summary = teamSummary(team)
              return (
                <div key={team}>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-semibold text-ink"><span className={`h-2 w-2 rounded-full ${TEAM[team].bar}`} />{team}<span className="font-normal text-ink-subtle">{summary.count}개 작업</span></span>
                    <span className="tabular-nums font-semibold text-ink">{summary.pct == null ? '배정 없음' : `${summary.pct}%`}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={`${team} 팀 ${summary.pct ?? 0}%`} aria-valuenow={summary.pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
                    <div className={`h-full rounded-full ${TEAM[team].bar}`} style={{ width: `${summary.pct ?? 0}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
