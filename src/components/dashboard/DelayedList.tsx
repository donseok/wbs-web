import type { ComputedItem } from '@/lib/domain/types'
import { Icon } from '@/components/ui/Icon'
import { fmtDate } from '@/components/wbs/shared'

export function DelayedList({ items }: { items: ComputedItem[] }) {
  const delayed: ComputedItem[] = []
  const walk = (nodes: ComputedItem[]) => nodes.forEach(node => {
    if (node.children.length === 0 && node.status === 'delayed') delayed.push(node)
    walk(node.children)
  })
  walk(items)
  delayed.sort((a, b) => (b.plannedPct - b.rolledActualPct) - (a.plannedPct - a.rolledActualPct))

  return (
    <section className="card overflow-hidden" aria-labelledby="delayed-title">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-delayed-weak text-delayed"><Icon name="alert" className="h-4 w-4" /></span>
            <h3 id="delayed-title" className="text-sm font-semibold text-ink">주의가 필요한 작업</h3>
            <span className="badge bg-delayed-weak text-delayed">{delayed.length}</span>
          </div>
          <p className="mt-1 pl-10 text-xs text-ink-muted">계획 대비 실적 격차가 큰 순서입니다.</p>
        </div>
        <span className="hidden text-xs text-ink-subtle sm:block">최대 10개 표시</span>
      </div>
      {delayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-done-weak text-done"><Icon name="check" /></span>
          <p className="mt-3 text-sm font-semibold text-ink">현재 지연 작업이 없습니다</p>
          <p className="mt-1 text-xs text-ink-muted">모든 작업이 계획 범위 안에 있습니다.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-[minmax(260px,1fr)_120px_90px_100px] gap-4 bg-surface-2 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
              <span>작업명</span><span>담당</span><span>종료일</span><span className="text-right">계획 / 실적</span>
            </div>
            <ul className="divide-y divide-line">
              {delayed.slice(0, 10).map(node => {
                const gap = Math.max(0, node.plannedPct - node.rolledActualPct)
                return (
                  <li key={node.id} className="grid grid-cols-[minmax(260px,1fr)_120px_90px_100px] items-center gap-4 px-5 py-3.5 text-xs transition hover:bg-surface-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink" title={node.name}>{node.name}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] font-medium text-delayed"><span className="h-1.5 w-1.5 rounded-full bg-delayed" />격차 {gap}%p</div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {node.owners.length ? node.owners.map(owner => <span key={`${owner.team}-${owner.kind}`} className="rounded-md bg-surface-2 px-1.5 py-1 text-[10px] font-semibold text-ink-muted">{owner.team}</span>) : <span className="text-ink-subtle">미지정</span>}
                    </div>
                    <time className="tabular-nums text-ink-muted" dateTime={node.plannedEnd ?? undefined}>{fmtDate(node.plannedEnd)}</time>
                    <div className="text-right tabular-nums"><span className="text-ink-muted">{node.plannedPct}%</span><span className="px-1 text-ink-subtle">/</span><strong className="text-delayed">{node.rolledActualPct}%</strong></div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
