import Link from 'next/link'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import type { ActionRow } from '@/lib/domain/attention'
import { SectionCard } from '@/components/ui/SectionCard'
import { OwnerBadges, fmtDate } from '@/components/wbs/shared'
import { CountBadge, MiniEmpty } from './primitives'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

export async function ActionCard({ rows, projectId }: { rows: ActionRow[]; projectId: string }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)
  const wbsHref = `/p/${projectId}/wbs`

  return (
    <SectionCard
      eyebrow="ACTION REQUIRED"
      title={tr('dash.action.title')}
      icon={AlertTriangle}
      fill
      bodyClassName="flex min-h-0 flex-col"
      actions={<CountBadge n={rows.length} unit={tr('dash.unitCount')} tone="bg-delayed-weak text-delayed" />}
    >
      {rows.length === 0 ? (
        <MiniEmpty text={tr('dash.action.empty')} />
      ) : (
        <>
          {/* 내부 스크롤. 부모가 overscroll-y-contain이므로 여기도 contain 해야 페이지를 끌고 가지 않는다. */}
          <ul className="-mr-2 min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain pr-2">
            {rows.map(row => {
              const badge = row.overdueDays > 0
                ? `${row.overdueDays}${tr('dash.action.overdueSuffix')}`
                : row.kind === 'delayed'
                  ? tr('dash.action.delayedTag')
                  : `D-${row.dday}`
              const urgent = row.kind === 'delayed'
              return (
                <li key={row.item.id}>
                  <Link href={wbsHref} className="flex items-center gap-2.5 py-2.5 transition hover:bg-surface-2/50">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${
                      urgent ? 'bg-delayed-weak text-delayed' : 'bg-pending-weak text-accent-warning'}`}>
                      {badge}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink" title={row.item.name}>
                        {row.item.name}
                      </span>
                      <span className="mt-0.5 block truncate tabular-nums text-[10px] text-ink-subtle">
                        {row.item.plannedEnd ? fmtDate(row.item.plannedEnd) : '—'}
                        {row.gapPp > 0 && ` · ${tr('dash.action.gapLabel')} ${row.gapPp}%p`}
                      </span>
                    </span>
                    <OwnerBadges owners={row.item.owners} />
                  </Link>
                </li>
              )
            })}
          </ul>
          <Link href={wbsHref}
            className="mt-2 flex shrink-0 items-center justify-center gap-1 border-t border-dashed border-line pt-2 text-[11px] font-semibold text-ink-muted transition hover:text-brand">
            {tr('dash.action.totalPrefix')}{rows.length}{tr('dash.unitCount')} · {tr('dash.action.viewAll')}
            <ChevronRight className="h-3 w-3" />
          </Link>
        </>
      )}
    </SectionCard>
  )
}
