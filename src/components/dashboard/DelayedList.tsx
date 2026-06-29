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
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">지연 작업</h3>
        <span className="badge bg-delayed-weak text-delayed">{delayed.length}</span>
      </div>
      {delayed.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-subtle">지연된 작업이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {delayed.slice(0, 10).map(n => (
            <li key={n.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex items-center gap-2 truncate text-ink">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-delayed" />
                <span className="truncate">{n.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-ink-muted">
                계획 {n.plannedPct}% <span className="text-ink-subtle">/</span> 실적 <span className="font-semibold text-delayed">{n.rolledActualPct}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
