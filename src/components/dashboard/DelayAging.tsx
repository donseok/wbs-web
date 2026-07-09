import { AlertTriangle } from 'lucide-react'
import type { AgingModel } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { OwnerBadges, fmtDate } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { CountBadge, MiniEmpty, Stat } from './bits'

/** 기한(plannedEnd) 경과 미완료 작업 — 경과일 버킷 + Top 리스트(기존 ATTENTION 흡수). */
export async function DelayAging({ aging }: { aging: AgingModel }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  return (
    <SectionCard
      eyebrow="OVERDUE AGING" title={tr('dash.aging.title')} icon={AlertTriangle}
      actions={<CountBadge n={aging.total} unit={tr('dash.unitCount')} tone="bg-delayed-weak text-delayed" />}
    >
      {aging.total === 0 ? (
        <MiniEmpty text={tr('dash.aging.empty')} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={tr('dash.aging.b1')} value={`${aging.d1_7}${tr('dash.unitCount')}`} />
            <Stat label={tr('dash.aging.b2')} value={`${aging.d8_14}${tr('dash.unitCount')}`}
              tone={aging.d8_14 > 0 ? 'text-accent-warning' : undefined} />
            <Stat label={tr('dash.aging.b3')} value={`${aging.d15plus}${tr('dash.unitCount')}`}
              tone={aging.d15plus > 0 ? 'text-delayed' : undefined} />
          </div>
          <ul className="divide-y divide-line">
            {aging.list.map(({ item, overdue }) => (
              <li key={item.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink" title={item.name}>{item.name}</div>
                  <div className="mt-1"><OwnerBadges owners={item.owners} /></div>
                </div>
                <div className="hidden w-36 shrink-0 sm:block">
                  <div className="flex items-center gap-2">
                    <div className="flex-1"><ProgressBar value={item.rolledActualPct} planned={item.plannedPct} height="h-1.5" tone="bg-delayed" /></div>
                    <span className="shrink-0 tabular-nums text-[11px] font-semibold text-delayed">{item.rolledActualPct}%</span>
                  </div>
                </div>
                <div className="w-24 shrink-0 text-right">
                  <div className="tabular-nums text-xs text-ink-muted">{fmtDate(item.plannedEnd)}</div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-delayed">
                    <span className="h-1.5 w-1.5 rounded-full bg-delayed" />{overdue}{tr('dash.overdueSuffix')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  )
}
