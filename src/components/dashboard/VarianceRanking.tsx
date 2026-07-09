import { TrendingDown } from 'lucide-react'
import type { VarianceEntry } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { OwnerBadges, fmtDate } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { CountBadge, MiniEmpty } from './bits'

/** 마감 전인데 계획보다 뒤처진 작업 Top N — 기한 경과분은 DelayAging 전담(상호 배타). */
export async function VarianceRanking({ entries }: { entries: VarianceEntry[] }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  return (
    <SectionCard
      eyebrow="CATCH-UP" title={tr('dash.rank.title')} icon={TrendingDown}
      actions={<CountBadge n={entries.length} unit={tr('dash.unitCount')} tone="bg-pending-weak text-accent-warning" />}
    >
      {entries.length === 0 ? (
        <MiniEmpty text={tr('dash.rank.empty')} />
      ) : (
        <ul className="divide-y divide-line">
          {entries.map(({ item, gapPp }) => (
            <li key={item.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink" title={item.name}>{item.name}</div>
                <div className="mt-1"><OwnerBadges owners={item.owners} /></div>
              </div>
              <div className="hidden w-36 shrink-0 sm:block">
                <ProgressBar value={item.rolledActualPct} planned={item.plannedPct} height="h-1.5" />
              </div>
              <div className="w-24 shrink-0 text-right">
                <div className="tabular-nums text-xs text-ink-muted">{fmtDate(item.plannedEnd)}</div>
                <div className="mt-0.5 inline-flex rounded-md bg-pending-weak px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent-warning">
                  −{gapPp}%p
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
