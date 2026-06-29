import type { ComputedItem } from '@/lib/domain/types'

export function DelayedList({ items }: { items: ComputedItem[] }) {
  const delayed: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach(n => {
    if (n.children.length === 0 && n.status === 'delayed') delayed.push(n)
    walk(n.children)
  })
  walk(items)
  delayed.sort((a, b) => (a.plannedPct - a.rolledActualPct) - (b.plannedPct - b.rolledActualPct)).reverse()
  return (
    <div className="rounded border p-3">
      <h3 className="mb-2 font-semibold">지연 작업 ({delayed.length})</h3>
      <ul className="space-y-1 text-sm">
        {delayed.slice(0, 10).map(n => (
          <li key={n.id} className="flex justify-between">
            <span>{n.name}</span>
            <span className="text-red-600 tabular-nums">계획 {n.plannedPct}% / 실적 {n.rolledActualPct}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
