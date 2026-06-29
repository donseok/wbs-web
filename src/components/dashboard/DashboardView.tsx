import { Kpi } from './Kpi'
import { DelayedList } from './DelayedList'
import type { ComputedItem, TeamCode } from '@/lib/domain/types'

function avg(ns: number[]): number {
  return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0
}

export function DashboardView({ items }: { items: ComputedItem[] }) {
  const roots = items
  const overallPlanned = avg(roots.map(r => r.plannedPct))
  const overallActual = avg(roots.map(r => r.rolledActualPct))

  // 팀별 진행률: 해당 팀이 owner인 leaf의 단순 평균
  const teams: TeamCode[] = ['PMO', 'DT', 'ERP', 'MES']
  const leaves: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach(n => { if (!n.children.length) leaves.push(n); walk(n.children) })
  walk(items)
  const teamPct = (t: TeamCode) => {
    const own = leaves.filter(l => l.owners.some(o => o.team === t))
    return own.length ? Math.round(avg(own.map(l => l.rolledActualPct))) : 0
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="전체 계획" value={`${overallPlanned}%`} />
        <Kpi label="전체 실적" value={`${overallActual}%`} />
        <Kpi label="달성율" value={overallPlanned ? `${Math.round(overallActual / overallPlanned * 100)}%` : '-'} />
        <Kpi label="지연 작업" value={String(leaves.filter(l => l.status === 'delayed').length)} sub="건" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-semibold text-ink">Phase별 진행</h3>
          <div className="space-y-3.5">
            {roots.map(p => (
              <div key={p.id} className="text-sm">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-ink">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-muted">
                    <span className={p.status === 'delayed' ? 'font-semibold text-delayed' : 'font-semibold text-ink'}>{p.rolledActualPct}%</span>
                    <span className="text-ink-subtle"> / {p.plannedPct}%</span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                  <div className={`h-full rounded-full ${p.status === 'delayed' ? 'bg-delayed' : p.status === 'done' ? 'bg-done' : 'bg-progress'}`} style={{ width: `${p.rolledActualPct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-semibold text-ink">팀별 진행</h3>
          <div className="space-y-3.5">
            {teams.map(t => (
              <div key={t} className="text-sm">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-medium text-ink">{t}</span>
                  <span className="tabular-nums font-semibold text-ink">{teamPct(t)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${teamPct(t)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <DelayedList items={items} />
    </div>
  )
}
