import Link from 'next/link'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { delayAging, varianceRanking } from '@/lib/domain/dashboard'
import { collectLeaves } from '@/lib/domain/tree'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'

/** 실행 가능한 리스크 목록 — 요약 타일의 숫자를 실제 WBS 작업으로 연결한다. */
export function RiskWorklist({ items, projectId, today }: {
  items: ComputedItem[]; projectId: string; today: string
}) {
  const leaves = collectLeaves(items)
  const aging = delayAging(leaves, today, 5)
  const variance = varianceRanking(leaves, today, 5)
  const rows = aging.list.length ? aging.list : variance.map(v => ({ item: v.item, overdue: 0, gap: v.gapPp }))

  return (
    <SectionCard eyebrow="ACTION QUEUE" title="지금 확인할 작업" icon={AlertTriangle}
      actions={<span className="chip bg-delayed-weak text-delayed">지연 {aging.total} · 임박 {leaves.filter(l => l.status !== 'done' && l.plannedEnd && l.plannedEnd >= today).length}</span>}>
      {rows.length === 0 ? <p className="text-sm text-ink-muted">현재 즉시 조치가 필요한 작업이 없습니다.</p> : (
        <div className="space-y-2">
          {rows.map(({ item, overdue, gap }) => (
            <Link key={item.id} href={`/p/${projectId}/wbs?focus=${item.id}`} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:bg-surface-2">
              <CalendarClock className={`h-4 w-4 shrink-0 ${overdue ? 'text-delayed' : 'text-accent-warning'}`} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.name}</span>
              <span className="shrink-0 text-xs text-ink-muted">{overdue ? `${overdue}일 지연` : `계획 대비 ${Math.round(gap)}%p`}</span>
              {item.plannedEnd && <span className="shrink-0 text-xs text-ink-subtle">{fmtDate(item.plannedEnd)}</span>}
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
