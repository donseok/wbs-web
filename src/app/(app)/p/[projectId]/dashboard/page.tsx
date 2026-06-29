import { getComputedWbs } from '@/lib/data/wbs'
import { Kpi } from '@/components/dashboard/Kpi'
import { DelayedList } from '@/components/dashboard/DelayedList'
import type { ComputedItem, TeamCode } from '@/lib/domain/types'

export default async function Dashboard({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const { items } = await getComputedWbs(projectId)

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
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Kpi label="전체 계획" value={`${overallPlanned}%`} />
        <Kpi label="전체 실적" value={`${overallActual}%`} />
        <Kpi label="달성율" value={overallPlanned ? `${Math.round(overallActual / overallPlanned * 100)}%` : '-'} />
        <Kpi label="지연 작업" value={String(leaves.filter(l => l.status === 'delayed').length)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border p-3">
          <h3 className="mb-2 font-semibold">Phase별 진행</h3>
          {roots.map(p => (
            <div key={p.id} className="mb-1 text-sm">
              <div className="flex justify-between"><span>{p.name}</span><span className="tabular-nums">{p.rolledActualPct}% / {p.plannedPct}%</span></div>
              <div className="h-2 w-full rounded bg-gray-200"><div className={`h-2 rounded ${p.status === 'delayed' ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${p.rolledActualPct}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="rounded border p-3">
          <h3 className="mb-2 font-semibold">팀별 진행</h3>
          {teams.map(t => (
            <div key={t} className="mb-1 text-sm">
              <div className="flex justify-between"><span>{t}</span><span className="tabular-nums">{teamPct(t)}%</span></div>
              <div className="h-2 w-full rounded bg-gray-200"><div className="h-2 rounded bg-blue-500" style={{ width: `${teamPct(t)}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
      <DelayedList items={items} />
    </div>
  )
}

function avg(ns: number[]): number { return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0 }
